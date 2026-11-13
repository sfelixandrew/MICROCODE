/**
 * Intel HEX Parser & Record Validator
 * MICROCODE INSPECTOR — STAGE 7
 *
 * Implements strict offline parsing and validation of Intel HEX records,
 * verifying 2's complement checksums, segment addressing, and gaps.
 */

import type { ParserWarning } from '../types.ts';

export interface HexRecordSegment {
  baseAddress: number;
  data: Uint8Array;
  length: number;
}

export interface IntelHexParseResult {
  valid: boolean;
  totalDataBytes: number;
  minAddress: number;
  maxAddress: number;
  segments: HexRecordSegment[];
  hasEofRecord: boolean;
  lineCount: number;
  warnings: ParserWarning[];
}

export class IntelHexParser {
  static readonly PARSER_VERSION = '1.0.0';

  /**
   * Parses an Intel HEX string into validated memory segments.
   */
  static parse(hexText: string): IntelHexParseResult {
    const warnings: ParserWarning[] = [];
    const segments: HexRecordSegment[] = [];

    let upperAddress = 0;
    let hasEofRecord = false;
    let minAddress = Number.MAX_SAFE_INTEGER;
    let maxAddress = 0;
    let totalDataBytes = 0;

    // Temporary map for contiguous address collation
    const byteMap = new Map<number, number>();

    const lines = hexText.split(/\r?\n/);
    let lineNum = 0;

    for (const rawLine of lines) {
      lineNum++;
      const line = rawLine.trim();
      if (!line) continue;

      if (!line.startsWith(':')) {
        warnings.push({
          code: 'MALFORMED_LINE',
          message: `Line ${lineNum}: Missing leading colon ':' in Intel HEX record.`,
          offset: lineNum,
          severity: 'error',
        });
        continue;
      }

      if (hasEofRecord) {
        warnings.push({
          code: 'DATA_AFTER_EOF',
          message: `Line ${lineNum}: Record found after End of File (01) record.`,
          offset: lineNum,
          severity: 'warning',
        });
      }

      const hexChars = line.slice(1);
      if (hexChars.length < 10 || hexChars.length % 2 !== 0) {
        warnings.push({
          code: 'MALFORMED_RECORD_LENGTH',
          message: `Line ${lineNum}: Invalid record length (${hexChars.length} hex characters).`,
          offset: lineNum,
          severity: 'error',
        });
        continue;
      }

      // Convert hex characters to bytes
      const bytes = new Uint8Array(hexChars.length / 2);
      let parseError = false;
      for (let i = 0; i < bytes.length; i++) {
        const val = parseInt(hexChars.slice(i * 2, i * 2 + 2), 16);
        if (Number.isNaN(val)) {
          warnings.push({
            code: 'NON_HEX_CHARACTERS',
            message: `Line ${lineNum}: Non-hexadecimal characters detected.`,
            offset: lineNum,
            severity: 'error',
          });
          parseError = true;
          break;
        }
        bytes[i] = val;
      }
      if (parseError) continue;

      const byteCount = bytes[0];
      const recordAddr = (bytes[1] << 8) | bytes[2];
      const recordType = bytes[3];
      const data = bytes.subarray(4, 4 + byteCount);
      const checksum = bytes[4 + byteCount];

      if (bytes.length !== 5 + byteCount) {
        warnings.push({
          code: 'RECORD_LENGTH_MISMATCH',
          message: `Line ${lineNum}: Declared byte count ${byteCount} does not match record size.`,
          offset: lineNum,
          severity: 'error',
        });
        continue;
      }

      // Validate 2's complement checksum: (sum of all bytes in line) & 0xFF == 0
      let sum = 0;
      for (let i = 0; i < bytes.length; i++) {
        sum = (sum + bytes[i]) & 0xff;
      }
      if (sum !== 0) {
        warnings.push({
          code: 'HEX_CHECKSUM_ERROR',
          message: `Line ${lineNum}: 2's complement checksum mismatch (calculated sum 0x${sum.toString(16)} != 0).`,
          offset: lineNum,
          severity: 'error',
        });
        continue;
      }

      if (recordType === 0x00) {
        // Data record
        const absAddr = upperAddress + recordAddr;
        for (let i = 0; i < byteCount; i++) {
          const addr = absAddr + i;
          if (byteMap.has(addr)) {
            warnings.push({
              code: 'OVERLAPPING_HEX_DATA',
              message: `Line ${lineNum}: Multiple data records target address 0x${addr.toString(16).toUpperCase()}.`,
              offset: addr,
              severity: 'warning',
            });
          }
          byteMap.set(addr, data[i]);
          minAddress = Math.min(minAddress, addr);
          maxAddress = Math.max(maxAddress, addr);
        }
        totalDataBytes += byteCount;
      } else if (recordType === 0x01) {
        // End of File record
        hasEofRecord = true;
        if (byteCount !== 0) {
          warnings.push({
            code: 'NON_EMPTY_EOF',
            message: `Line ${lineNum}: EOF record contains non-zero byte count (${byteCount}).`,
            offset: lineNum,
            severity: 'warning',
          });
        }
      } else if (recordType === 0x02) {
        // Extended Segment Address: upper 16 bits shifted left by 4
        if (byteCount !== 2) {
          warnings.push({
            code: 'INVALID_SEGMENT_ADDR',
            message: `Line ${lineNum}: Extended Segment Address record requires 2 data bytes.`,
            offset: lineNum,
            severity: 'error',
          });
        } else {
          upperAddress = ((data[0] << 8) | data[1]) << 4;
        }
      } else if (recordType === 0x04) {
        // Extended Linear Address: upper 16 bits shifted left by 16
        if (byteCount !== 2) {
          warnings.push({
            code: 'INVALID_LINEAR_ADDR',
            message: `Line ${lineNum}: Extended Linear Address record requires 2 data bytes.`,
            offset: lineNum,
            severity: 'error',
          });
        } else {
          upperAddress = ((data[0] << 8) | data[1]) << 16;
        }
      } else {
        warnings.push({
          code: 'UNHANDLED_RECORD_TYPE',
          message: `Line ${lineNum}: Unhandled or non-standard Intel HEX record type 0x${recordType.toString(16)}.`,
          offset: lineNum,
          severity: 'info',
        });
      }
    }

    if (!hasEofRecord && totalDataBytes > 0) {
      warnings.push({
        code: 'MISSING_EOF_RECORD',
        message: 'Intel HEX stream ended without an End of File (:00000001FF) record.',
        severity: 'warning',
      });
    }

    // Collate sorted contiguous segments from byteMap
    if (byteMap.size > 0) {
      const sortedAddresses = Array.from(byteMap.keys()).sort((a, b) => a - b);
      let segStart = sortedAddresses[0];
      let segBytes: number[] = [byteMap.get(segStart)!];

      for (let i = 1; i < sortedAddresses.length; i++) {
        const addr = sortedAddresses[i];
        const prev = sortedAddresses[i - 1];
        if (addr === prev + 1) {
          segBytes.push(byteMap.get(addr)!);
        } else {
          // Gap detected
          segments.push({
            baseAddress: segStart,
            data: new Uint8Array(segBytes),
            length: segBytes.length,
          });
          segStart = addr;
          segBytes = [byteMap.get(addr)!];
        }
      }

      segments.push({
        baseAddress: segStart,
        data: new Uint8Array(segBytes),
        length: segBytes.length,
      });
    }

    return {
      valid: warnings.every((w) => w.severity !== 'error'),
      totalDataBytes,
      minAddress: minAddress === Number.MAX_SAFE_INTEGER ? 0 : minAddress,
      maxAddress,
      segments,
      hasEofRecord,
      lineCount: lineNum,
      warnings,
    };
  }

  /**
   * Reconstitutes contiguous fixed-size binary memory buffer (e.g. 32 KiB for ATmega328P).
   * Unwritten gaps are explicitly filled with `paddingByte` (default 0xFF).
   */
  static toBinaryBuffer(
    parseResult: IntelHexParseResult,
    totalSize: number,
    paddingByte: number = 0xff,
  ): Uint8Array {
    const buffer = new Uint8Array(totalSize);
    buffer.fill(paddingByte);

    for (const seg of parseResult.segments) {
      for (let i = 0; i < seg.length; i++) {
        const target = seg.baseAddress + i;
        if (target < totalSize) {
          buffer[target] = seg.data[i];
        }
      }
    }

    return buffer;
  }
}

