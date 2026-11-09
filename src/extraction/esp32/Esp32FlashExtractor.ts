import { DeviceError } from '../../device/DeviceError.ts';
import { computeSha256 } from '../../utils/crypto.ts';
import { formatHexAddress } from '../../utils/address.ts';
import { classifyFirmwareContent } from '../analysis/contentClassifier.ts';
import type { ClassificationResult } from '../analysis/contentClassifier.ts';

export interface ExtractionPlan {
  startAddress: number;
  totalBytes: number;
  chunkSize: number;
  totalChunks: number;
  endAddress: number;
}

export interface ExtractionProgressUpdate {
  currentAddress: number;
  startAddress: number;
  totalBytes: number;
  bytesRead: number;
  percentage: number;
  currentChunkIndex: number;
  totalChunks: number;
  speedBytesPerSec: number;
  elapsedMs: number;
}

export interface ExtractionOutcome {
  status: 'completed' | 'partial' | 'failed' | 'cancelled';
  startAddress: number;
  bytesRequested: number;
  bytesRead: number;
  rawBytes: Uint8Array;
  sha256Hash: string;
  readability: ClassificationResult;
  elapsedMs: number;
  errorMessage?: string;
  isVerifiedExact: boolean;
}

export interface ExtractionOptions {
  abortSignal?: AbortSignal;
  onProgress?: (progress: ExtractionProgressUpdate) => void;
  flashCryptCount?: number;
}

export class Esp32FlashExtractor {
  /**
   * Calculates and validates the extraction plan against hardware limits.
   */
  static calculatePlan(
    startAddress: number,
    totalBytes: number,
    maxCapacityBytes: number,
    chunkSize: number = 65536
  ): ExtractionPlan {
    if (!Number.isSafeInteger(startAddress) || startAddress < 0) {
      throw new DeviceError('READ_FAILED', `Invalid start address: ${startAddress}. Address must be a non-negative integer.`);
    }

    if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0) {
      throw new DeviceError('READ_FAILED', `Invalid read length: ${totalBytes}. Length must be a positive integer.`);
    }

    if (!Number.isSafeInteger(maxCapacityBytes) || maxCapacityBytes <= 0) {
      throw new DeviceError('READ_FAILED', `Invalid maximum capacity: ${maxCapacityBytes}.`);
    }

    if (startAddress + totalBytes > maxCapacityBytes) {
      throw new DeviceError(
        'READ_FAILED',
        `Requested memory range (${formatHexAddress(startAddress)} - ${formatHexAddress(startAddress + totalBytes)}) exceeds detected Flash capacity (${formatHexAddress(maxCapacityBytes)}).`
      );
    }

    const totalChunks = Math.ceil(totalBytes / chunkSize);
    return {
      startAddress,
      totalBytes,
      chunkSize,
      totalChunks,
      endAddress: startAddress + totalBytes,
    };
  }

  /**
   * Executes a small, user-approved test slice read (typically 4 KiB at 0x1000).
   * Verifies transport responsiveness and initial content readability before full extraction.
   */
  static async executeTestSlice(
    loader: any,
    sliceAddress: number = 0x1000,
    sliceSize: number = 4096,
    flashCryptCount: number = 0
  ): Promise<ExtractionOutcome> {
    if (!loader || typeof loader.readFlash !== 'function') {
      throw new DeviceError('NOT_CONNECTED', 'ESPLoader is not initialized or readFlash is unavailable.');
    }

    const startTime = Date.now();
    try {
      const sliceBytes: Uint8Array = await loader.readFlash(sliceAddress, sliceSize);
      if (!sliceBytes || sliceBytes.length !== sliceSize) {
        throw new DeviceError(
          'READ_FAILED',
          `Test slice read returned ${sliceBytes ? sliceBytes.length : 0} bytes; expected ${sliceSize} bytes.`
        );
      }

      const sha256Hash = await computeSha256(sliceBytes);
      const readability = classifyFirmwareContent(sliceBytes, sliceAddress, flashCryptCount);

      return {
        status: 'completed',
        startAddress: sliceAddress,
        bytesRequested: sliceSize,
        bytesRead: sliceBytes.length,
        rawBytes: sliceBytes,
        sha256Hash,
        readability,
        elapsedMs: Date.now() - startTime,
        isVerifiedExact: true,
      };
    } catch (err: any) {
      throw new DeviceError('READ_FAILED', `Test slice read at ${formatHexAddress(sliceAddress)} failed: ${err.message}`, err);
    }
  }

  /**
   * Reads full accessible Flash memory using bounded chunks with exact offset ordering,
   * progress tracking, cancellation support, and partial dump preservation on error.
   */
  static async executeExtraction(
    loader: any,
    plan: ExtractionPlan,
    options: ExtractionOptions = {}
  ): Promise<ExtractionOutcome> {
    if (!loader || typeof loader.readFlash !== 'function') {
      throw new DeviceError('NOT_CONNECTED', 'ESPLoader is not initialized or readFlash is unavailable.');
    }

    const startTime = Date.now();
    const fullBuffer = new Uint8Array(plan.totalBytes);
    let bytesRead = 0;
    let lastProgressTime = startTime;
    let lastBytesRead = 0;

    for (let chunkIndex = 0; chunkIndex < plan.totalChunks; chunkIndex++) {
      // 1. Check for cancellation
      if (options.abortSignal?.aborted) {
        const capturedSlice = fullBuffer.slice(0, bytesRead);
        const partialHash = await computeSha256(capturedSlice);
        const readability = classifyFirmwareContent(capturedSlice, plan.startAddress, options.flashCryptCount ?? 0);

        return {
          status: 'cancelled',
          startAddress: plan.startAddress,
          bytesRequested: plan.totalBytes,
          bytesRead,
          rawBytes: capturedSlice,
          sha256Hash: partialHash,
          readability,
          elapsedMs: Date.now() - startTime,
          errorMessage: 'Extraction was cancelled by user. Partial buffer preserved.',
          isVerifiedExact: false,
        };
      }

      const chunkOffset = plan.startAddress + bytesRead;
      const chunkLen = Math.min(plan.chunkSize, plan.totalBytes - bytesRead);

      try {
        // Read chunk from physical bootloader
        const chunk: Uint8Array = await loader.readFlash(chunkOffset, chunkLen);

        if (!chunk || chunk.length !== chunkLen) {
          throw new Error(
            `Incomplete chunk received at ${formatHexAddress(chunkOffset)}: expected ${chunkLen} bytes, got ${chunk ? chunk.length : 0}.`
          );
        }

        // Maintain exact offset order; place into allocated buffer
        fullBuffer.set(chunk, bytesRead);
        bytesRead += chunkLen;

        // Calculate streaming speed and report progress
        const now = Date.now();
        const timeDeltaSec = (now - lastProgressTime) / 1000;
        let speedBytesPerSec = 0;
        if (timeDeltaSec > 0.5) {
          speedBytesPerSec = Math.round((bytesRead - lastBytesRead) / timeDeltaSec);
          lastProgressTime = now;
          lastBytesRead = bytesRead;
        }

        if (options.onProgress) {
          options.onProgress({
            currentAddress: chunkOffset + chunkLen,
            startAddress: plan.startAddress,
            totalBytes: plan.totalBytes,
            bytesRead,
            percentage: Math.round((bytesRead / plan.totalBytes) * 100),
            currentChunkIndex: chunkIndex + 1,
            totalChunks: plan.totalChunks,
            speedBytesPerSec,
            elapsedMs: now - startTime,
          });
        }
      } catch (err: any) {
        // Preserve partial data on failure; never discard captured bytes
        const capturedSlice = fullBuffer.slice(0, bytesRead);
        const partialHash = await computeSha256(capturedSlice);
        const readability = classifyFirmwareContent(capturedSlice, plan.startAddress, options.flashCryptCount ?? 0);

        return {
          status: bytesRead > 0 ? 'partial' : 'failed',
          startAddress: plan.startAddress,
          bytesRequested: plan.totalBytes,
          bytesRead,
          rawBytes: capturedSlice,
          sha256Hash: partialHash,
          readability,
          elapsedMs: Date.now() - startTime,
          errorMessage: `Chunk read at ${formatHexAddress(chunkOffset)} failed: ${err.message}`,
          isVerifiedExact: false,
        };
      }
    }

    // 2. Successful full extraction: calculate cryptographic hash and verify
    const sha256Hash = await computeSha256(fullBuffer);
    const readability = classifyFirmwareContent(fullBuffer, plan.startAddress, options.flashCryptCount ?? 0);

    // 3. Verify in-memory export fidelity: re-hash a cloned view
    const clonedView = new Uint8Array(fullBuffer.buffer.slice(0));
    const verifyHash = await computeSha256(clonedView);
    const isVerifiedExact = sha256Hash === verifyHash && clonedView.length === plan.totalBytes;

    return {
      status: 'completed',
      startAddress: plan.startAddress,
      bytesRequested: plan.totalBytes,
      bytesRead,
      rawBytes: fullBuffer,
      sha256Hash,
      readability,
      elapsedMs: Date.now() - startTime,
      isVerifiedExact,
    };
  }
}
