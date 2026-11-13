/**
 * Windowed Shannon Entropy Analysis Engine
 * MICROCODE INSPECTOR — STAGE 7
 *
 * Computes statistical byte entropy (0.0 to 8.0 bits/byte) across firmware regions.
 * Strictly labeled as a heuristic indicator for encryption / compression / padding.
 */

import type { EntropyChunk } from '../types.ts';

export interface EntropyReport {
  overallEntropy: number;
  chunks: EntropyChunk[];
  heuristicNotice: string;
}

export class EntropyAnalyzer {
  static readonly PARSER_VERSION = '1.0.0';

  static readonly HEURISTIC_NOTICE =
    'Entropy analysis is a statistical heuristic only. High entropy indicates compression, encryption, ' +
    'or high-density packed data; it does not constitute mathematical proof of encryption.';

  /**
   * Calculates Shannon entropy of a byte buffer in bits per byte (0.0 to 8.0).
   */
  static calculateShannonEntropy(data: Uint8Array): number {
    const len = data.length;
    if (len === 0) return 0.0;

    const counts = new Uint32Array(256);
    for (let i = 0; i < len; i++) {
      counts[data[i]]++;
    }

    let entropy = 0;
    for (let i = 0; i < 256; i++) {
      if (counts[i] > 0) {
        const p = counts[i] / len;
        entropy -= p * Math.log2(p);
      }
    }

    return Math.min(8.0, Math.max(0.0, entropy));
  }

  /**
   * Classifies an entropy score into standard statistical categories.
   */
  static classifyEntropy(entropy: number): EntropyChunk['classification'] {
    if (entropy <= 0.2) {
      return 'padding_erased';
    }
    if (entropy <= 2.5) {
      return 'low_density';
    }
    if (entropy <= 7.1) {
      return 'plaintext';
    }
    return 'compressed_or_encrypted';
  }

  /**
   * Generates a windowed entropy profile across a binary buffer.
   * Dynamically sizes window size based on buffer length.
   */
  static analyzeBuffer(data: Uint8Array, maxChunks: number = 64): EntropyReport {
    const len = data.length;
    if (len === 0) {
      return {
        overallEntropy: 0.0,
        chunks: [],
        heuristicNotice: this.HEURISTIC_NOTICE,
      };
    }

    const overall = this.calculateShannonEntropy(data);

    // Calculate window size (at least 256 bytes)
    const chunkSize = Math.max(256, Math.floor(len / maxChunks));
    const chunks: EntropyChunk[] = [];

    for (let offset = 0; offset < len; offset += chunkSize) {
      const currentLen = Math.min(chunkSize, len - offset);
      const slice = data.subarray(offset, offset + currentLen);
      const e = this.calculateShannonEntropy(slice);

      chunks.push({
        offset,
        length: currentLen,
        entropy: Number(e.toFixed(3)),
        classification: this.classifyEntropy(e),
      });
    }

    return {
      overallEntropy: Number(overall.toFixed(3)),
      chunks,
      heuristicNotice: this.HEURISTIC_NOTICE,
    };
  }
}

