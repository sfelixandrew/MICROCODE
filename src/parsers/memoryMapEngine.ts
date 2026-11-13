/**
 * Unified Memory Map Analysis Engine
 * MICROCODE INSPECTOR — STAGE 7
 *
 * Integrates ESP32, AVR, Intel HEX, and general binary analyzers into a repeatable,
 * offline memory map report. Preserves original flash addresses, detects overlaps,
 * computes entropy heuristics, and enforces: "Unknown data stays Unknown."
 */

import type {
  MemoryMapReport,
  ParsedRegion,
  ParserWarning,
  OverlapRecord,
  UnmappedRange,
  DetectedFormat,
} from './types.ts';
import type { TargetArchitecture } from '../device/types.ts';
import { SignatureDetector } from './general/signatureDetector.ts';
import { StringExtractor } from './general/stringExtractor.ts';
import { EntropyAnalyzer } from './general/entropyAnalyzer.ts';
import { EspImageParser } from './esp/espImageParser.ts';
import { EspPartitionParser } from './esp/espPartitionParser.ts';
import { IntelHexParser } from './avr/intelHexParser.ts';
import { AvrMemoryMapper } from './avr/avrMemoryMapper.ts';
import type { AvrFuseSettings } from './avr/avrMemoryMapper.ts';

export interface MemoryMapEngineOptions {
  targetArchitectureHint?: TargetArchitecture;
  flashCapacityHint?: number;
  fuses?: AvrFuseSettings;
  preferredPartitionOffset?: number;
}

export class MemoryMapEngine {
  static readonly ENGINE_VERSION = '1.0.0';

  /**
   * Generates a complete offline MemoryMapReport from a firmware binary or Intel HEX string.
   */
  static analyze(
    input: Uint8Array | string,
    options: MemoryMapEngineOptions = {},
  ): MemoryMapReport {
    let data: Uint8Array;
    let isHexInput = false;
    const warnings: ParserWarning[] = [];
    const overlaps: OverlapRecord[] = [];

    // 1. Process Intel HEX string or binary buffer
    if (typeof input === 'string') {
      isHexInput = true;
      const hexResult = IntelHexParser.parse(input);
      warnings.push(...hexResult.warnings);

      // Reconstitute 32 KiB binary for AVR if within 32 KiB range
      const totalSize = Math.max(32768, hexResult.maxAddress + 1);
      data = IntelHexParser.toBinaryBuffer(hexResult, totalSize, 0xff);
    } else {
      data = input;
      // Check if data starts with ':' (Intel HEX in Uint8Array)
      if (data.length > 0 && data[0] === 0x3a) {
        try {
          const text = new TextDecoder('ascii', { fatal: true }).decode(data);
          if (text.startsWith(':')) {
            isHexInput = true;
            const hexResult = IntelHexParser.parse(text);
            warnings.push(...hexResult.warnings);
            const totalSize = Math.max(32768, hexResult.maxAddress + 1);
            data = IntelHexParser.toBinaryBuffer(hexResult, totalSize, 0xff);
          }
        } catch {
          // Keep as raw binary
        }
      }
    }

    const totalSize = data.length;

    // 2. Detect Signatures
    const signatures = SignatureDetector.detectSignatures(data);

    // 3. String Extraction
    const strings = StringExtractor.extractStrings(data, { minLength: 4, maxStrings: 2000 });

    // 4. Entropy Analysis (Heuristic only)
    const entropySummary = EntropyAnalyzer.analyzeBuffer(data, 64);

    // 5. Determine Target Architecture & Format
    let detectedArch: TargetArchitecture | 'unknown' = options.targetArchitectureHint ?? 'unknown';
    let detectedFormat: DetectedFormat = isHexInput ? 'intel_hex' : 'raw_binary';

    const hasPartitionSig = signatures.some((s) => s.format === 'esp_partition_table');
    const hasEspImageSig = signatures.some((s) => s.format === 'esp_image');
    const hasAvrSig = signatures.some((s) => s.name.includes('AVR'));

    if (hasPartitionSig || hasEspImageSig) {
      detectedFormat = 'esp_image';
      if (detectedArch === 'unknown') {
        detectedArch = 'xtensa-lx6'; // Default ESP family until chipId verified
      }
    } else if (isHexInput || hasAvrSig) {
      detectedFormat = isHexInput ? 'intel_hex' : 'raw_binary';
      if (detectedArch === 'unknown') {
        detectedArch = 'avr8';
      }
    }

    const regions: ParsedRegion[] = [];

    // 6. Architectural Memory Mapping
    if (detectedArch.startsWith('xtensa') || detectedArch === 'riscv32' || hasPartitionSig || hasEspImageSig) {
      // --- ESP32 Processing ---
      // A. Bootloader Check at 0x1000 (classic) or 0x0000 (C3/S3)
      const bootloaderOffsets = [0x1000, 0x0000];
      for (const bOffset of bootloaderOffsets) {
        if (totalSize >= bOffset + 24 && data[bOffset] === 0xe9) {
          const img = EspImageParser.parseImage(data, bOffset);
          warnings.push(...img.warnings);
          if (img.valid) {
            if (img.chipName.includes('Xtensa LX7')) detectedArch = 'xtensa-lx7';
            else if (img.chipName.includes('RISC-V')) detectedArch = 'riscv32';
            else if (img.chipName.includes('Classic')) detectedArch = 'xtensa-lx6';

            regions.push({
              id: `esp_bootloader_${bOffset}`,
              name: bOffset === 0x1000 ? 'ESP32 2nd Stage Bootloader' : 'ROM/Bootloader Image',
              type: 'bootloader',
              offset: bOffset,
              length: img.totalImageLength,
              endOffset: bOffset + img.totalImageLength,
              confidence: 'verified',
              confidenceReason: `Verified ESP image format v1 header with ${img.segmentCount} segments (${img.chipName}).`,
              source: 'esp_image_header',
              parserVersion: this.ENGINE_VERSION,
              warnings: img.warnings.map((w) => w.message),
              metadata: {
                entryPoint: img.entryPoint,
                spiMode: img.spiMode,
                spiSpeed: img.spiSpeed,
                flashSize: img.flashSize,
                segments: img.segments,
              },
            });
            break;
          }
        }
      }

      // B. Partition Table Check
      const partTable = EspPartitionParser.parsePartitionTable(
        data,
        options.preferredPartitionOffset,
        options.flashCapacityHint ?? totalSize,
      );

      if (partTable) {
        warnings.push(...partTable.warnings);
        overlaps.push(...partTable.overlaps);
        const partRegions = EspPartitionParser.toParsedRegions(partTable);
        regions.push(...partRegions);

        // C. Check Application Partitions for ESP App Image Headers
        for (const entry of partTable.entries) {
          if (entry.type === 0x00 && totalSize >= entry.offset + 24) {
            if (data[entry.offset] === 0xe9) {
              const appImg = EspImageParser.parseImage(data, entry.offset);
              warnings.push(...appImg.warnings);
              if (appImg.valid) {
                // Update partition region metadata with app details
                const matchingPart = regions.find((r) => r.offset === entry.offset);
                if (matchingPart) {
                  matchingPart.confidence = 'verified';
                  matchingPart.confidenceReason += ` Verified valid app image header (Entry: 0x${appImg.entryPoint.toString(16).toUpperCase()}).`;
                  matchingPart.metadata = {
                    ...matchingPart.metadata,
                    entryPoint: appImg.entryPoint,
                    segmentCount: appImg.segmentCount,
                    appSegments: appImg.segments,
                    sha256Digest: appImg.sha256DigestHex,
                  };
                }
              }
            }
          }
        }
      } else {
        warnings.push({
          code: 'NO_PARTITION_TABLE',
          message: 'No ESP-IDF partition table found at standard offsets (0x8000 / 0x9000).',
          severity: 'info',
        });
      }
    } else if (detectedArch === 'avr8' || isHexInput || hasAvrSig) {
      // --- ATmega328P / AVR Processing ---
      const avrResult = AvrMemoryMapper.mapFlashImage(data, options.fuses);
      warnings.push(...avrResult.warnings);
      regions.push(...avrResult.regions);

      // Keep EEPROM as a separate memory region in report metadata
      regions.push(avrResult.eepromRegion);
    } else {
      // --- Completely Unknown Target ---
      // Rule: Unknown data stays Unknown. Never force a classification.
      regions.push({
        id: 'unclassified_binary_dump',
        name: 'Unclassified Binary Memory',
        type: 'unknown',
        offset: 0,
        length: totalSize,
        endOffset: totalSize,
        confidence: 'unknown',
        confidenceReason: 'No recognized microcontroller partition tables or bootloader headers detected.',
        source: 'unclassified_scan',
        parserVersion: this.ENGINE_VERSION,
        warnings: ['Binary format unrecognized. Preserving as raw unclassified memory.'],
      });
    }

    // 7. Sort regions and calculate Unmapped Ranges & Overlaps
    const flashRegions = regions.filter((r) => r.type !== 'eeprom');
    flashRegions.sort((a, b) => a.offset - b.offset);

    const unmappedRanges: UnmappedRange[] = [];
    let currentCoverage = 0;

    for (const r of flashRegions) {
      if (r.offset > currentCoverage) {
        const gapLen = r.offset - currentCoverage;
        unmappedRanges.push({
          offset: currentCoverage,
          length: gapLen,
          reason: 'Unmapped address space between verified regions (Unknown data stays Unknown).',
        });
      }
      currentCoverage = Math.max(currentCoverage, r.endOffset);
    }

    if (currentCoverage < totalSize) {
      unmappedRanges.push({
        offset: currentCoverage,
        length: totalSize - currentCoverage,
        reason: 'Trailing unmapped address space beyond last recognized region.',
      });
    }

    return {
      targetArchitecture: detectedArch,
      detectedFormat,
      totalSize,
      signatures,
      regions,
      unmappedRanges,
      overlaps,
      warnings,
      strings,
      entropySummary,
      generatedAtIso: new Date().toISOString(),
      parserEngineVersion: this.ENGINE_VERSION,
    };
  }
}
