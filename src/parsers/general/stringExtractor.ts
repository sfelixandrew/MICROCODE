/**
 * Printable String Extraction Engine
 * MICROCODE INSPECTOR — STAGE 7
 *
 * Extracts printable ASCII and UTF-8 string sequences from firmware binaries
 * with byte offsets, lengths, and encoding labels.
 */

import type { ExtractedString } from '../types.ts';

export interface StringExtractorOptions {
  minLength?: number;
  maxStrings?: number;
}

export class StringExtractor {
  static readonly PARSER_VERSION = '1.0.0';

  /**
   * Scans a binary buffer and extracts sequences of printable ASCII / UTF-8 characters.
   */
  static extractStrings(
    data: Uint8Array,
    options: StringExtractorOptions = {},
  ): ExtractedString[] {
    const minLength = options.minLength ?? 4;
    const maxStrings = options.maxStrings ?? 2000;
    const results: ExtractedString[] = [];

    const len = data.length;
    let currentStart = -1;
    let currentBytes: number[] = [];

    const isPrintableAscii = (b: number): boolean => {
      // 0x20..0x7E printable, plus \t (0x09), \n (0x0A), \r (0x0D)
      return (b >= 0x20 && b <= 0x7e) || b === 0x09 || b === 0x0a || b === 0x0d;
    };

    const flushCurrent = (endOffset: number) => {
      if (currentBytes.length >= minLength) {
        try {
          const u8 = new Uint8Array(currentBytes);
          const str = new TextDecoder('utf-8', { fatal: true }).decode(u8);
          // Check if it contains at least one non-whitespace character
          if (/\S/.test(str)) {
            // Determine encoding: if all bytes <= 0x7F, ASCII, otherwise UTF-8
            const isAscii = currentBytes.every((b) => b <= 0x7f);
            results.push({
              offset: currentStart,
              length: currentBytes.length,
              value: str,
              encoding: isAscii ? 'ASCII' : 'UTF-8',
            });
          }
        } catch {
          // If UTF-8 decoding fails, fallback to ASCII filter
          const asciiBytes = currentBytes.filter((b) => isPrintableAscii(b));
          if (asciiBytes.length >= minLength) {
            const str = String.fromCharCode(...asciiBytes);
            if (/\S/.test(str)) {
              results.push({
                offset: currentStart,
                length: asciiBytes.length,
                value: str,
                encoding: 'ASCII',
              });
            }
          }
        }
      }
      currentStart = -1;
      currentBytes = [];
    };

    for (let i = 0; i < len; i++) {
      if (results.length >= maxStrings) {
        break;
      }

      const byte = data[i];
      if (isPrintableAscii(byte) || (byte >= 0xc0 && byte <= 0xf4) || (byte >= 0x80 && byte <= 0xbf)) {
        if (currentStart === -1) {
          currentStart = i;
        }
        currentBytes.push(byte);
      } else {
        if (currentStart !== -1) {
          flushCurrent(i);
        }
      }
    }

    if (currentStart !== -1 && results.length < maxStrings) {
      flushCurrent(len);
    }

    return results;
  }
}
