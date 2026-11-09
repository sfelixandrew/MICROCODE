import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Esp32FlashExtractor } from '../../src/extraction/esp32/Esp32FlashExtractor.ts';
import type { ExtractionPlan } from '../../src/extraction/esp32/Esp32FlashExtractor.ts';
import {
  calculateShannonEntropy,
  classifyFirmwareContent,
} from '../../src/extraction/analysis/contentClassifier.ts';
import { computeSha256 } from '../../src/utils/crypto.ts';
import { DeviceError } from '../../src/device/DeviceError.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Stage 5: ESP32 Read-Only Flash Extraction', () => {
  describe('Plan Calculation & Bounds Validation', () => {
    it('calculates chunk boundary and offset calculations accurately', () => {
      const plan = Esp32FlashExtractor.calculatePlan(0x0, 131072, 4194304, 65536);
      assert.strictEqual(plan.startAddress, 0);
      assert.strictEqual(plan.totalBytes, 131072);
      assert.strictEqual(plan.chunkSize, 65536);
      assert.strictEqual(plan.totalChunks, 2);
      assert.strictEqual(plan.endAddress, 131072);
    });

    it('handles non-chunk-aligned sizes without truncation', () => {
      const plan = Esp32FlashExtractor.calculatePlan(0x1000, 100000, 4194304, 65536);
      assert.strictEqual(plan.startAddress, 0x1000);
      assert.strictEqual(plan.totalBytes, 100000);
      assert.strictEqual(plan.totalChunks, 2);
      assert.strictEqual(plan.endAddress, 0x1000 + 100000);
    });

    it('rejects zero-length requests', () => {
      assert.throws(
        () => Esp32FlashExtractor.calculatePlan(0, 0, 4194304),
        (err: any) => err instanceof DeviceError && err.code === 'READ_FAILED'
      );
    });

    it('rejects negative start addresses', () => {
      assert.throws(
        () => Esp32FlashExtractor.calculatePlan(-1, 4096, 4194304),
        (err: any) => err instanceof DeviceError && err.code === 'READ_FAILED'
      );
    });

    it('rejects out-of-range requests exceeding detected Flash capacity', () => {
      assert.throws(
        () => Esp32FlashExtractor.calculatePlan(0x0, 5000000, 4194304),
        (err: any) => {
          assert(err instanceof DeviceError);
          assert.strictEqual(err.code, 'READ_FAILED');
          assert.ok(err.message.includes('exceeds detected Flash capacity'));
          return true;
        }
      );
    });
  });

  describe('Test Slice Execution', () => {
    it('reads a 4 KiB test slice, computes SHA-256, and validates response length', async () => {
      const slicePattern = new Uint8Array(4096);
      slicePattern[0] = 0xE9; // Simulated ESP image magic
      slicePattern.fill(0x42, 1);

      const mockLoader = {
        readFlash: async (addr: number, size: number) => {
          assert.strictEqual(addr, 0x1000);
          assert.strictEqual(size, 4096);
          return slicePattern;
        },
      };

      const outcome = await Esp32FlashExtractor.executeTestSlice(mockLoader, 0x1000, 4096);
      assert.strictEqual(outcome.status, 'completed');
      assert.strictEqual(outcome.bytesRead, 4096);
      assert.strictEqual(outcome.startAddress, 0x1000);
      assert.strictEqual(outcome.rawBytes.length, 4096);
      assert.strictEqual(outcome.sha256Hash.length, 64);
      assert.strictEqual(outcome.isVerifiedExact, true);
    });

    it('rejects incomplete test slice response', async () => {
      const mockLoader = {
        readFlash: async () => new Uint8Array(1024), // Truncated response
      };

      await assert.rejects(
        async () => Esp32FlashExtractor.executeTestSlice(mockLoader, 0x1000, 4096),
        (err: any) => err instanceof DeviceError && err.code === 'READ_FAILED'
      );
    });
  });

  describe('Full Extraction, Progress & Error Recovery', () => {
    it('completes full extraction across multiple chunks maintaining exact byte offsets', async () => {
      const totalBytes = 131072; // 2 chunks of 64 KiB
      const plan = Esp32FlashExtractor.calculatePlan(0x0, totalBytes, 4194304, 65536);

      const mockLoader = {
        readFlash: async (offset: number, size: number) => {
          const chunk = new Uint8Array(size);
          // Distinct byte pattern per offset
          chunk.fill(offset === 0 ? 0xAA : 0xBB);
          return chunk;
        },
      };

      const progressHistory: number[] = [];
      const outcome = await Esp32FlashExtractor.executeExtraction(mockLoader, plan, {
        onProgress: (p) => progressHistory.push(p.percentage),
      });

      assert.strictEqual(outcome.status, 'completed');
      assert.strictEqual(outcome.bytesRead, totalBytes);
      assert.strictEqual(outcome.rawBytes.length, totalBytes);
      // Validate offset placement
      assert.strictEqual(outcome.rawBytes[0], 0xAA);
      assert.strictEqual(outcome.rawBytes[65535], 0xAA);
      assert.strictEqual(outcome.rawBytes[65536], 0xBB);
      assert.strictEqual(outcome.rawBytes[131071], 0xBB);
      assert.strictEqual(outcome.isVerifiedExact, true);
      assert.strictEqual(progressHistory[progressHistory.length - 1], 100);
    });

    it('preserves partial dump and records partial status when a chunk fails mid-way', async () => {
      const totalBytes = 196608; // 3 chunks of 64 KiB
      const plan = Esp32FlashExtractor.calculatePlan(0x0, totalBytes, 4194304, 65536);

      let chunkCount = 0;
      const mockLoader = {
        readFlash: async (_offset: number, size: number) => {
          chunkCount++;
          if (chunkCount === 2) {
            throw new Error('UART FIFO overflow / timeout');
          }
          return new Uint8Array(size).fill(0x55);
        },
      };

      const outcome = await Esp32FlashExtractor.executeExtraction(mockLoader, plan);

      assert.strictEqual(outcome.status, 'partial');
      assert.strictEqual(outcome.bytesRead, 65536); // Chunk 1 preserved
      assert.strictEqual(outcome.rawBytes.length, 65536);
      assert.ok(outcome.errorMessage?.includes('failed: UART FIFO overflow'));
      assert.strictEqual(outcome.isVerifiedExact, false);
      assert.strictEqual(outcome.sha256Hash.length, 64);
    });

    it('supports user cancellation via AbortSignal without discarding captured bytes', async () => {
      const totalBytes = 262144; // 4 chunks of 64 KiB
      const plan = Esp32FlashExtractor.calculatePlan(0x0, totalBytes, 4194304, 65536);
      const controller = new AbortController();

      let calls = 0;
      const mockLoader = {
        readFlash: async (_offset: number, size: number) => {
          calls++;
          if (calls === 2) {
            controller.abort(); // Cancel during 2nd chunk
          }
          return new Uint8Array(size).fill(0x77);
        },
      };

      const outcome = await Esp32FlashExtractor.executeExtraction(mockLoader, plan, {
        abortSignal: controller.signal,
      });

      assert.strictEqual(outcome.status, 'cancelled');
      assert.strictEqual(outcome.bytesRead, 131072); // 2 chunks captured before abort check
      assert.strictEqual(outcome.rawBytes.length, 131072);
      assert.ok(outcome.errorMessage?.includes('cancelled by user'));
      assert.strictEqual(outcome.sha256Hash.length, 64);
    });

    it('verifies exported bytes exactly match in-memory captured bytes', async () => {
      const testBuffer = new Uint8Array([0x10, 0x20, 0x30, 0x40, 0x50]);
      const memoryHash = await computeSha256(testBuffer);

      // Create cloned copy (simulating download blob)
      const exportedCopy = new Uint8Array(testBuffer.buffer.slice(0));
      const exportedHash = await computeSha256(exportedCopy);

      assert.strictEqual(memoryHash, exportedHash);
      assert.strictEqual(testBuffer.length, exportedCopy.length);
    });
  });

  describe('Content Readability & Encryption Classification', () => {
    it('classifies plaintext firmware with valid bootloader magic as readable', () => {
      const buf = new Uint8Array(8192);
      buf[0x1000] = 0xE9; // ESP Image Magic
      buf.fill(0x33, 0x1001, 0x2000);

      const classification = classifyFirmwareContent(buf, 0x0, 0);
      assert.strictEqual(classification.status, 'readable');
      assert.strictEqual(classification.hasValidAppHeader, true);
    });

    it('classifies high-entropy random buffer without headers as likely_encrypted', () => {
      const highEntropyBuf = new Uint8Array(8192);
      // Fill with cryptographically random bytes (Shannon entropy ~7.99)
      crypto.getRandomValues(highEntropyBuf);

      const entropy = calculateShannonEntropy(highEntropyBuf);
      assert.ok(entropy > 7.90, `Entropy should be high: ${entropy}`);

      const classification = classifyFirmwareContent(highEntropyBuf, 0x0, 1);
      assert.strictEqual(classification.status, 'likely_encrypted');
    });

    it('identifies predominantly erased Flash padding', () => {
      const erasedBuf = new Uint8Array(8192).fill(0xFF);
      const classification = classifyFirmwareContent(erasedBuf, 0x0, 0);
      assert.strictEqual(classification.status, 'readable');
      assert.ok(classification.explanation.includes('0xFF padding'));
    });
  });

  describe('Static Security Check: Extraction Engine is Strictly Read-Only', () => {
    it('asserts extraction modules import and call zero write or erase APIs', () => {
      const extractionDir = path.resolve(__dirname, '../../src/extraction');
      const files: string[] = [];

      function walk(dir: string) {
        for (const file of fs.readdirSync(dir)) {
          const fp = path.join(dir, file);
          if (fs.statSync(fp).isDirectory()) walk(fp);
          else if (fp.endsWith('.ts')) files.push(fp);
        }
      }
      walk(extractionDir);

      assert.ok(files.length > 0);
      for (const f of files) {
        const code = fs.readFileSync(f, 'utf-8');
        assert.strictEqual(/\.writeFlash\s*\(/.test(code), false, `writeFlash call in ${f}`);
        assert.strictEqual(/\.eraseFlash\s*\(/.test(code), false, `eraseFlash call in ${f}`);
        assert.strictEqual(/\.eraseRegion\s*\(/.test(code), false, `eraseRegion call in ${f}`);
      }
    });
  });
});
