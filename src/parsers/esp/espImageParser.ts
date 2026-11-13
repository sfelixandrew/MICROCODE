/**
 * ESP32 / ESP-IDF Application Image & Bootloader Header Parser
 * MICROCODE INSPECTOR — STAGE 7
 *
 * Implements strict offline parsing and validation of ESP image format v1
 * and extended chip headers per Espressif specification.
 */

import type { ParserWarning } from '../types.ts';

export interface EspImageSegment {
  segmentIndex: number;
  loadAddress: number;
  dataLength: number;
  fileOffset: number;
}

export interface EspImageParseResult {
  valid: boolean;
  magic: number;
  segmentCount: number;
  entryPoint: number;
  chipId: number;
  chipName: string;
  spiMode: string;
  spiSpeed: string;
  flashSize: string;
  segments: EspImageSegment[];
  totalImageLength: number;
  checksumRead: number | null;
  checksumCalculated: number | null;
  checksumValid: boolean | null;
  hasAppendedHash: boolean;
  sha256DigestHex: string | null;
  warnings: ParserWarning[];
}

export class EspImageParser {
  static readonly PARSER_VERSION = '1.0.0';
  static readonly ESP_IMAGE_MAGIC = 0xe9;

  private static readonly CHIP_ID_MAP: Record<number, string> = {
    0x0000: 'ESP32 (Classic Xtensa LX6)',
    0x0002: 'ESP32-S2 (Xtensa LX7)',
    0x0005: 'ESP32-C3 (RISC-V 32-bit)',
    0x0009: 'ESP32-S3 (Xtensa LX7)',
    0x000c: 'ESP32-C2 (RISC-V 32-bit)',
    0x000d: 'ESP32-C6 (RISC-V 32-bit)',
    0x0010: 'ESP32-H2 (RISC-V 32-bit)',
    0x0012: 'ESP32-P4 (RISC-V 32-bit)',
  };

  private static readonly SPI_MODE_MAP: Record<number, string> = {
    0: 'QIO (Quad I/O)',
    1: 'QOUT (Quad Output)',
    2: 'DIO (Dual I/O)',
    3: 'DOUT (Dual Output)',
    4: 'FAST_READ',
    5: 'SLOW_READ',
  };

  private static readonly SPI_SPEED_MAP: Record<number, string> = {
    0: '40 MHz',
    1: '26 MHz',
    2: '20 MHz',
    15: '80 MHz',
  };

  private static readonly FLASH_SIZE_MAP: Record<number, string> = {
    0: '1 MB',
    1: '2 MB',
    2: '4 MB',
    3: '8 MB',
    4: '16 MB',
    5: '32 MB',
    6: '64 MB',
    7: '128 MB',
  };

  /**
   * Parses an ESP image beginning at `startOffset` in `data`.
   */
  static parseImage(data: Uint8Array, startOffset: number = 0): EspImageParseResult {
    const warnings: ParserWarning[] = [];
    const availableLen = data.length - startOffset;

    if (startOffset < 0 || startOffset >= data.length || availableLen < 24) {
      warnings.push({
        code: 'IMAGE_TRUNCATED',
        message: `Buffer too short for ESP image header: ${availableLen} bytes available (minimum 24 required).`,
        offset: startOffset,
        severity: 'error',
      });
      return this.makeFailedResult(warnings, startOffset);
    }

    const view = new DataView(data.buffer, data.byteOffset + startOffset, availableLen);
    const magic = view.getUint8(0);

    if (magic !== this.ESP_IMAGE_MAGIC) {
      warnings.push({
        code: 'INVALID_MAGIC',
        message: `Expected ESP image magic 0xE9, found 0x${magic.toString(16).toUpperCase().padStart(2, '0')}.`,
        offset: startOffset,
        severity: 'error',
      });
      return this.makeFailedResult(warnings, startOffset, magic);
    }

    const segmentCount = view.getUint8(1);
    const spiModeCode = view.getUint8(2);
    const spiSpeedSizeByte = view.getUint8(3);
    const spiSpeedCode = spiSpeedSizeByte & 0x0f;
    const flashSizeCode = (spiSpeedSizeByte >> 4) & 0x0f;
    const entryPoint = view.getUint32(4, true);

    const wpPin = view.getUint8(8);
    const chipId = view.getUint16(12, true);
    const minChipRev = view.getUint8(14);

    const chipName = this.CHIP_ID_MAP[chipId] || `Unknown ESP Chip (ID: 0x${chipId.toString(16).padStart(4, '0')})`;
    const spiMode = this.SPI_MODE_MAP[spiModeCode] || `Unknown (${spiModeCode})`;
    const spiSpeed = this.SPI_SPEED_MAP[spiSpeedCode] || `Unknown (${spiSpeedCode})`;
    const flashSize = this.FLASH_SIZE_MAP[flashSizeCode] || `Unknown (${flashSizeCode})`;

    if (segmentCount === 0 || segmentCount > 16) {
      warnings.push({
        code: 'UNUSUAL_SEGMENT_COUNT',
        message: `Unusual segment count: ${segmentCount} (standard ESP images have 1..16 segments).`,
        offset: startOffset + 1,
        severity: segmentCount === 0 ? 'error' : 'warning',
      });
    }

    // Parse Segments
    let currentOffset = 24;
    const segments: EspImageSegment[] = [];
    let calculatedChecksum = 0xef;

    for (let i = 0; i < segmentCount; i++) {
      if (currentOffset + 8 > availableLen) {
        warnings.push({
          code: 'SEGMENT_HEADER_TRUNCATED',
          message: `Truncated segment ${i} header at image relative offset +${currentOffset}.`,
          offset: startOffset + currentOffset,
          severity: 'error',
        });
        break;
      }

      const loadAddress = view.getUint32(currentOffset, true);
      const dataLength = view.getUint32(currentOffset + 4, true);
      currentOffset += 8;

      if (currentOffset + dataLength > availableLen) {
        warnings.push({
          code: 'SEGMENT_DATA_TRUNCATED',
          message: `Segment ${i} data truncated: requires ${dataLength} bytes, only ${availableLen - currentOffset} available.`,
          offset: startOffset + currentOffset,
          severity: 'error',
        });
        segments.push({
          segmentIndex: i,
          loadAddress,
          dataLength,
          fileOffset: startOffset + currentOffset,
        });
        currentOffset = availableLen;
        break;
      }

      // Checksum is calculated by XORing all bytes across all segments
      const segBytes = data.subarray(startOffset + currentOffset, startOffset + currentOffset + dataLength);
      for (let b = 0; b < segBytes.length; b++) {
        calculatedChecksum ^= segBytes[b];
      }

      segments.push({
        segmentIndex: i,
        loadAddress,
        dataLength,
        fileOffset: startOffset + currentOffset,
      });

      currentOffset += dataLength;
    }

    // 16-byte alignment padding after all segments
    const padLen = (16 - (currentOffset % 16)) % 16;
    currentOffset += padLen;

    let checksumRead: number | null = null;
    let checksumValid: boolean | null = null;

    if (currentOffset < availableLen) {
      checksumRead = view.getUint8(currentOffset);
      checksumValid = checksumRead === calculatedChecksum;
      currentOffset += 1;

      if (!checksumValid) {
        warnings.push({
          code: 'CHECKSUM_MISMATCH',
          message: `Image checksum mismatch: read 0x${checksumRead.toString(16).padStart(2, '0')}, calculated 0x${calculatedChecksum.toString(16).padStart(2, '0')}.`,
          offset: startOffset + currentOffset - 1,
          severity: 'warning',
        });
      }
    } else {
      warnings.push({
        code: 'CHECKSUM_MISSING',
        message: 'Image buffer ended before checksum byte.',
        offset: startOffset + currentOffset,
        severity: 'info',
      });
    }

    // Check for optional appended 32-byte SHA-256 digest
    let hasAppendedHash = false;
    let sha256DigestHex: string | null = null;

    if (currentOffset + 32 <= availableLen) {
      const hashBytes = data.subarray(startOffset + currentOffset, startOffset + currentOffset + 32);
      // Verify not all 0xFF or 0x00
      const isDummy = hashBytes.every((b) => b === 0xff) || hashBytes.every((b) => b === 0x00);
      if (!isDummy) {
        hasAppendedHash = true;
        sha256DigestHex = Array.from(hashBytes)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        currentOffset += 32;
      }
    }

    return {
      valid: warnings.every((w) => w.severity !== 'error'),
      magic,
      segmentCount,
      entryPoint,
      chipId,
      chipName,
      spiMode,
      spiSpeed,
      flashSize,
      segments,
      totalImageLength: currentOffset,
      checksumRead,
      checksumCalculated: calculatedChecksum,
      checksumValid,
      hasAppendedHash,
      sha256DigestHex,
      warnings,
    };
  }

  private static makeFailedResult(
    warnings: ParserWarning[],
    offset: number,
    magic: number = 0,
  ): EspImageParseResult {
    return {
      valid: false,
      magic,
      segmentCount: 0,
      entryPoint: 0,
      chipId: 0,
      chipName: 'Unknown',
      spiMode: 'Unknown',
      spiSpeed: 'Unknown',
      flashSize: 'Unknown',
      segments: [],
      totalImageLength: 0,
      checksumRead: null,
      checksumCalculated: null,
      checksumValid: null,
      hasAppendedHash: false,
      sha256DigestHex: null,
      warnings,
    };
  }
}

