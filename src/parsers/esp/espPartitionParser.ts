/**
 * ESP-IDF Partition Table Parser
 * MICROCODE INSPECTOR — STAGE 7
 *
 * Implements strict offline parsing and validation of ESP-IDF partition tables,
 * MD5 integrity verification, subtype mapping, and overlap/out-of-bounds detection.
 */

import type { ParsedRegion, ParserWarning, OverlapRecord } from '../types.ts';
import type { MemoryRegionType } from '../../types/memory.ts';
import { computeMd5Sync } from '../../utils/crypto.ts';

export interface EspPartitionEntry {
  magic: number; // 0x50AA
  type: number;
  typeLabel: string;
  subtype: number;
  subtypeLabel: string;
  offset: number;
  size: number;
  endOffset: number;
  label: string;
  flags: number;
  isEncrypted: boolean;
  isValid: boolean;
}

export interface EspPartitionTableResult {
  valid: boolean;
  tableOffset: number;
  tableLength: number;
  entries: EspPartitionEntry[];
  hasMd5Record: boolean;
  md5Valid: boolean | null;
  md5ExpectedHex: string | null;
  md5CalculatedHex: string | null;
  overlaps: OverlapRecord[];
  warnings: ParserWarning[];
}

export class EspPartitionParser {
  static readonly PARSER_VERSION = '1.0.0';
  static readonly ENTRY_SIZE = 32;

  // APP Subtypes (type = 0x00)
  private static readonly APP_SUBTYPES: Record<number, string> = {
    0x00: 'factory',
    0x10: 'ota_0',
    0x11: 'ota_1',
    0x12: 'ota_2',
    0x13: 'ota_3',
    0x14: 'ota_4',
    0x15: 'ota_5',
    0x16: 'ota_6',
    0x17: 'ota_7',
    0x18: 'ota_8',
    0x19: 'ota_9',
    0x1a: 'ota_10',
    0x1b: 'ota_11',
    0x1c: 'ota_12',
    0x1d: 'ota_13',
    0x1e: 'ota_14',
    0x1f: 'ota_15',
    0x20: 'test',
  };

  // DATA Subtypes (type = 0x01)
  private static readonly DATA_SUBTYPES: Record<number, string> = {
    0x00: 'ota',
    0x01: 'phy',
    0x02: 'nvs',
    0x03: 'coredump',
    0x04: 'nvs_keys',
    0x05: 'efuse',
    0x80: 'esphttpd',
    0x81: 'fat',
    0x82: 'spiffs',
    0x83: 'littlefs',
  };

  /**
   * Locates and parses an ESP-IDF partition table in a firmware dump.
   * Checks offset 0x8000 (standard), 0x9000 (legacy), or specific provided offset.
   */
  static parsePartitionTable(
    data: Uint8Array,
    preferredOffset?: number,
    flashCapacity?: number,
  ): EspPartitionTableResult | null {
    const candidateOffsets =
      preferredOffset !== undefined ? [preferredOffset] : [0x8000, 0x9000];

    for (const offset of candidateOffsets) {
      if (offset + this.ENTRY_SIZE <= data.length) {
        // Check magic bytes 0xAA 0x50 (little-endian 0x50AA)
        if (data[offset] === 0xaa && data[offset + 1] === 0x50) {
          return this.parseAtOffset(data, offset, flashCapacity);
        }
      }
    }

    return null;
  }

  /**
   * Parses partition table at an explicit offset.
   */
  static parseAtOffset(
    data: Uint8Array,
    tableOffset: number,
    flashCapacity?: number,
  ): EspPartitionTableResult {
    const warnings: ParserWarning[] = [];
    const entries: EspPartitionEntry[] = [];
    const overlaps: OverlapRecord[] = [];

    const available = data.length - tableOffset;
    const view = new DataView(data.buffer, data.byteOffset + tableOffset, available);

    let currentRel = 0;
    let hasMd5Record = false;
    let md5ExpectedHex: string | null = null;
    let md5CalculatedHex: string | null = null;
    let md5Valid: boolean | null = null;

    const precedingDataForMd5: Uint8Array[] = [];

    while (currentRel + this.ENTRY_SIZE <= available) {
      const magicLow = view.getUint8(currentRel);
      const magicHigh = view.getUint8(currentRel + 1);

      // Check for End of Table (all 0xFF or all 0x00)
      if (
        (magicLow === 0xff && magicHigh === 0xff) ||
        (magicLow === 0x00 && magicHigh === 0x00)
      ) {
        break;
      }

      // Check for MD5 checksum record (magic 0xEB 0xEB)
      if (magicLow === 0xeb && magicHigh === 0xeb) {
        hasMd5Record = true;
        // The 16-byte MD5 digest is stored at offset 16..31 of this 32-byte record
        const md5Bytes = data.subarray(
          tableOffset + currentRel + 16,
          tableOffset + currentRel + 32,
        );
        md5ExpectedHex = Array.from(md5Bytes)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');

        // Calculate MD5 of all preceding partition entries
        const concatenatedPreceding = new Uint8Array(currentRel);
        concatenatedPreceding.set(data.subarray(tableOffset, tableOffset + currentRel));
        md5CalculatedHex = computeMd5Sync(concatenatedPreceding);
        md5Valid = md5ExpectedHex.toLowerCase() === md5CalculatedHex.toLowerCase();

        if (!md5Valid) {
          warnings.push({
            code: 'MD5_CHECKSUM_MISMATCH',
            message: `Partition table MD5 mismatch: expected ${md5ExpectedHex}, calculated ${md5CalculatedHex}. Table may be corrupted.`,
            offset: tableOffset + currentRel,
            severity: 'error',
          });
        }

        currentRel += this.ENTRY_SIZE;
        break;
      }

      // Validate standard partition entry magic: 0xAA 0x50
      if (magicLow !== 0xaa || magicHigh !== 0x50) {
        warnings.push({
          code: 'INVALID_PARTITION_MAGIC',
          message: `Unexpected partition record magic 0x${magicLow.toString(16)} 0x${magicHigh.toString(16)} at offset 0x${(tableOffset + currentRel).toString(16)}.`,
          offset: tableOffset + currentRel,
          severity: 'warning',
        });
        currentRel += this.ENTRY_SIZE;
        continue;
      }

      const pType = view.getUint8(currentRel + 2);
      const pSubtype = view.getUint8(currentRel + 3);
      const pOffset = view.getUint32(currentRel + 4, true);
      const pSize = view.getUint32(currentRel + 8, true);

      // Label is a 16-byte null-terminated string
      const labelBytes = data.subarray(
        tableOffset + currentRel + 12,
        tableOffset + currentRel + 28,
      );
      let nullIdx = labelBytes.indexOf(0);
      if (nullIdx === -1) nullIdx = 16;
      const label = new TextDecoder('utf-8', { fatal: false })
        .decode(labelBytes.subarray(0, nullIdx))
        .trim();

      const pFlags = view.getUint32(currentRel + 28, true);
      const isEncrypted = (pFlags & 0x01) !== 0;

      // Subtype label resolution
      let typeLabel = 'unknown';
      let subtypeLabel = `0x${pSubtype.toString(16).padStart(2, '0')}`;

      if (pType === 0x00) {
        typeLabel = 'app';
        subtypeLabel = this.APP_SUBTYPES[pSubtype] || `app_${subtypeLabel}`;
      } else if (pType === 0x01) {
        typeLabel = 'data';
        subtypeLabel = this.DATA_SUBTYPES[pSubtype] || `data_${subtypeLabel}`;
      } else {
        typeLabel = `custom_0x${pType.toString(16)}`;
      }

      // Check alignment and bounds
      let isValid = true;
      if (pOffset % 0x1000 !== 0) {
        warnings.push({
          code: 'UNALIGNED_PARTITION',
          message: `Partition '${label}' offset 0x${pOffset.toString(16)} is not aligned to 4 KiB flash sector.`,
          offset: tableOffset + currentRel,
          severity: 'warning',
        });
      }

      if (flashCapacity && pOffset + pSize > flashCapacity) {
        isValid = false;
        warnings.push({
          code: 'OUT_OF_BOUNDS_PARTITION',
          message: `Partition '${label}' (0x${pOffset.toString(16)}..0x${(pOffset + pSize).toString(16)}) exceeds flash capacity of ${flashCapacity} bytes.`,
          offset: tableOffset + currentRel,
          severity: 'error',
        });
      }

      const entry: EspPartitionEntry = {
        magic: 0x50aa,
        type: pType,
        typeLabel,
        subtype: pSubtype,
        subtypeLabel,
        offset: pOffset,
        size: pSize,
        endOffset: pOffset + pSize,
        label: label || `unnamed_${entries.length}`,
        flags: pFlags,
        isEncrypted,
        isValid,
      };

      entries.push(entry);
      currentRel += this.ENTRY_SIZE;
    }

    // Detect Overlaps among valid partitions
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i];
        const b = entries[j];
        const start = Math.max(a.offset, b.offset);
        const end = Math.min(a.endOffset, b.endOffset);
        if (start < end) {
          const overlapLen = end - start;
          overlaps.push({
            regionA: a.label,
            regionB: b.label,
            start,
            end,
            length: overlapLen,
          });
          warnings.push({
            code: 'PARTITION_OVERLAP',
            message: `Partition overlap detected between '${a.label}' and '${b.label}' [0x${start.toString(16)}..0x${end.toString(16)}] (${overlapLen} bytes).`,
            offset: start,
            severity: 'error',
          });
        }
      }
    }

    return {
      valid: warnings.every((w) => w.severity !== 'error'),
      tableOffset,
      tableLength: currentRel,
      entries,
      hasMd5Record,
      md5Valid,
      md5ExpectedHex,
      md5CalculatedHex,
      overlaps,
      warnings,
    };
  }

  /**
   * Converts parsed partition entries into standardized `ParsedRegion` items.
   */
  static toParsedRegions(table: EspPartitionTableResult): ParsedRegion[] {
    const regions: ParsedRegion[] = [];

    // Add partition table itself as a verified region
    regions.push({
      id: `partition_table_${table.tableOffset}`,
      name: 'ESP-IDF Partition Table',
      type: 'partition_table',
      offset: table.tableOffset,
      length: 0xc00, // standard partition table reserved space is 0xC00 (3 KiB)
      endOffset: table.tableOffset + 0xc00,
      confidence: 'verified',
      confidenceReason: table.hasMd5Record && table.md5Valid
        ? 'Verified via ESP-IDF magic 0xAA50 and bit-exact MD5 checksum.'
        : 'Verified via ESP-IDF magic 0xAA50 header.',
      source: 'esp_partition_table',
      parserVersion: this.PARSER_VERSION,
      warnings: table.warnings.map((w) => w.message),
      metadata: {
        entryCount: table.entries.length,
        hasMd5: table.hasMd5Record,
        md5Valid: table.md5Valid,
      },
    });

    for (const p of table.entries) {
      let regionType: MemoryRegionType = 'unknown';

      if (p.type === 0x00) {
        regionType = p.subtypeLabel.startsWith('ota') ? 'app_ota' : 'app';
      } else if (p.type === 0x01) {
        if (p.subtypeLabel === 'nvs') regionType = 'data_nvs';
        else if (p.subtypeLabel === 'phy') regionType = 'data_phy';
        else if (p.subtypeLabel === 'spiffs') regionType = 'data_spiffs';
        else if (p.subtypeLabel === 'fat') regionType = 'data_fat';
        else regionType = 'unknown';
      }

      regions.push({
        id: `part_${p.label}_${p.offset}`,
        name: `${p.label} (${p.subtypeLabel})`,
        type: regionType,
        offset: p.offset,
        length: p.size,
        endOffset: p.endOffset,
        confidence: p.isValid ? 'verified' : 'medium',
        confidenceReason: `Declared in ESP-IDF partition table (type 0x${p.type.toString(16)}, subtype 0x${p.subtype.toString(16)}).`,
        source: 'esp_partition_table',
        parserVersion: this.PARSER_VERSION,
        flags: p.flags,
        isEncrypted: p.isEncrypted,
        warnings: [],
        metadata: {
          partitionLabel: p.label,
          type: p.typeLabel,
          subtype: p.subtypeLabel,
          encrypted: p.isEncrypted,
        },
      });
    }

    return regions;
  }
}

