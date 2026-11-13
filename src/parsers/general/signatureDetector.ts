/**
 * Multi-Format Binary & File Signature Detector
 * MICROCODE INSPECTOR — STAGE 7
 *
 * Detects embedded microcontroller firmware signatures and container formats
 * across Flash dumps, application binaries, and container files.
 */

import type { FileSignature, DetectedFormat } from '../types.ts';

export class SignatureDetector {
  static readonly PARSER_VERSION = '1.0.0';

  /**
   * Scans a binary buffer for known embedded firmware signatures.
   */
  static detectSignatures(data: Uint8Array): FileSignature[] {
    const signatures: FileSignature[] = [];
    const len = data.length;
    if (len === 0) return signatures;

    // 1. Check for Intel HEX format (ASCII file starting with ':')
    if (data[0] === 0x3a) {
      // Check first few lines for valid HEX pattern
      const sample = new TextDecoder('ascii', { fatal: false }).decode(data.subarray(0, Math.min(256, len)));
      if (/^:[0-9A-Fa-f]{10,}/m.test(sample)) {
        signatures.push({
          format: 'intel_hex',
          name: 'Intel HEX Container',
          magicBytesHex: '3A',
          offset: 0,
          description: 'ASCII-encoded Intel HEX record stream with line checksums.',
          confidence: 'verified',
        });
      }
    }

    // 2. Check for ELF Executable header (0x7F 'E' 'L' 'F')
    if (len >= 4 && data[0] === 0x7f && data[1] === 0x45 && data[2] === 0x4c && data[3] === 0x46) {
      signatures.push({
        format: 'elf',
        name: 'ELF Binary Image',
        magicBytesHex: '7F 45 4C 46',
        offset: 0,
        description: 'Standard Executable and Linkable Format (ELF) with debugging/symbol metadata.',
        confidence: 'verified',
      });
    }

    // 3. Scan for ESP-IDF Partition Table Magic (0xAA50 / bytes 0x50 0xAA little-endian)
    const partitionCandidateOffsets = [0x8000, 0x9000];
    for (const off of partitionCandidateOffsets) {
      if (len >= off + 2 && data[off] === 0xaa && data[off + 1] === 0x50) {
        signatures.push({
          format: 'esp_partition_table',
          name: 'ESP-IDF Partition Table',
          magicBytesHex: 'AA 50',
          offset: off,
          description: `Standard ESP-IDF partition table structure located at documented offset 0x${off.toString(16).toUpperCase()}.`,
          confidence: 'verified',
        });
      }
    }

    // 4. Scan for ESP Application Image Magic (0xE9)
    // Common offsets: 0x0000 (app dump / C3 bootloader), 0x1000 (classic bootloader), 0x10000 (factory app), 0x20000
    const espAppCandidateOffsets = [0x0000, 0x1000, 0x10000, 0x20000];
    for (const off of espAppCandidateOffsets) {
      if (len >= off + 4 && data[off] === 0xe9) {
        const segCount = data[off + 1];
        // Heuristic check: reasonable segment count (1..16)
        if (segCount >= 1 && segCount <= 16) {
          signatures.push({
            format: 'esp_image',
            name: off === 0x1000 ? 'ESP32 2nd Stage Bootloader' : 'ESP32 Application Image',
            magicBytesHex: 'E9',
            offset: off,
            description: `ESP image format v1 header with ${segCount} segments at offset 0x${off.toString(16).toUpperCase()}.`,
            confidence: 'verified',
          });
        }
      }
    }

    // 5. Check for ATmega328P / AVR Reset Vector
    // In AVR, vector 0 is Reset Vector at 0x0000:
    // Instruction is either `jmp addr` (0x0C 0x94 followed by 2 bytes target address)
    // or `rjmp addr` (0xCxxx in little endian: low byte, high byte 0xCx)
    if (len >= 4 && data[0] === 0x0c && data[1] === 0x94) {
      const targetAddr = data[2] | (data[3] << 8);
      signatures.push({
        format: 'raw_binary',
        name: 'AVR Reset Vector (JMP)',
        magicBytesHex: `0C 94 ${data[2].toString(16).padStart(2, '0')} ${data[3].toString(16).padStart(2, '0')}`,
        offset: 0,
        description: `ATmega interrupt vector 0: JMP 0x${targetAddr.toString(16).toUpperCase().padStart(4, '0')}`,
        confidence: 'high',
      });
    } else if (len >= 2 && (data[1] & 0xf0) === 0xc0) {
      signatures.push({
        format: 'raw_binary',
        name: 'AVR Reset Vector (RJMP)',
        magicBytesHex: `${data[0].toString(16).padStart(2, '0')} ${data[1].toString(16).padStart(2, '0')}`,
        offset: 0,
        description: 'ATmega interrupt vector 0: RJMP relative branch instruction.',
        confidence: 'medium',
      });
    }

    // 6. Check for completely erased Flash
    if (len >= 32) {
      let isAllErased = true;
      for (let i = 0; i < Math.min(len, 1024); i++) {
        if (data[i] !== 0xff) {
          isAllErased = false;
          break;
        }
      }
      if (isAllErased) {
        signatures.push({
          format: 'raw_binary',
          name: 'Unprogrammed Flash (0xFF)',
          magicBytesHex: 'FF FF FF FF',
          offset: 0,
          description: 'Initial region contains exclusively unprogrammed erased Flash bits (0xFF).',
          confidence: 'high',
        });
      }
    }

    return signatures;
  }
}
