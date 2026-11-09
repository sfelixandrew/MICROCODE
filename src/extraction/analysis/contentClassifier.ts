/**
 * Binary Content & Encryption Classifier
 * Evaluates whether captured firmware bytes are readable plaintext,
 * likely ciphertext / encrypted, partially readable, or undetermined.
 */

export type FirmwareReadabilityStatus = 
  | 'readable'
  | 'likely_encrypted'
  | 'partially_readable'
  | 'undetermined';

export interface ClassificationResult {
  status: FirmwareReadabilityStatus;
  entropy: number;
  hasValidAppHeader: boolean;
  hasValidPartitionTable: boolean;
  detectedSignatures: string[];
  explanation: string;
}

/**
 * Computes Shannon entropy (0.0 to 8.0 bits per byte).
 */
export function calculateShannonEntropy(data: Uint8Array): number {
  if (data.length === 0) return 0;

  const frequencies = new Uint32Array(256);
  for (let i = 0; i < data.length; i++) {
    frequencies[data[i]]++;
  }

  let entropy = 0;
  const len = data.length;
  for (let i = 0; i < 256; i++) {
    if (frequencies[i] > 0) {
      const p = frequencies[i] / len;
      entropy -= p * Math.log2(p);
    }
  }

  return entropy;
}

/**
 * Analyzes an ESP32 Flash buffer (or slice) to classify readability.
 * @param buffer Full or partial flash dump
 * @param startAddress Base memory address of the buffer
 */
export function classifyFirmwareContent(
  buffer: Uint8Array,
  startAddress: number = 0,
  flashCryptCount: number = 0
): ClassificationResult {
  if (buffer.length === 0) {
    return {
      status: 'undetermined',
      entropy: 0,
      hasValidAppHeader: false,
      hasValidPartitionTable: false,
      detectedSignatures: [],
      explanation: 'Buffer is empty.',
    };
  }

  const detectedSignatures: string[] = [];
  let hasValidAppHeader = false;
  let hasValidPartitionTable = false;

  // Check 1: ESP bootloader magic byte 0xE9 at offset 0x1000 (if contained in range)
  const bootloaderOffset = 0x1000 - startAddress;
  if (bootloaderOffset >= 0 && bootloaderOffset + 24 <= buffer.length) {
    if (buffer[bootloaderOffset] === 0xE9) {
      hasValidAppHeader = true;
      detectedSignatures.push('ESP_IMAGE_MAGIC (0xE9 at 0x1000)');
    }
  } else if (startAddress === 0 && buffer[0] === 0xE9) {
    hasValidAppHeader = true;
    detectedSignatures.push('ESP_IMAGE_MAGIC (0xE9 at 0x0000)');
  }

  // Check 2: ESP-IDF Partition table magic 0xAA50 at offset 0x8000
  const partitionOffset = 0x8000 - startAddress;
  if (partitionOffset >= 0 && partitionOffset + 32 <= buffer.length) {
    if (buffer[partitionOffset] === 0xAA && buffer[partitionOffset + 1] === 0x50) {
      hasValidPartitionTable = true;
      detectedSignatures.push('PARTITION_TABLE_MAGIC (0xAA50 at 0x8000)');
    }
  }

  // Calculate Shannon entropy over sample (first 64 KiB or entire buffer)
  const sampleLength = Math.min(buffer.length, 65536);
  const sample = buffer.subarray(0, sampleLength);
  const entropy = calculateShannonEntropy(sample);

  // Check 3: Erased/padding detection (0xFF fill)
  let ffCount = 0;
  for (let i = 0; i < sampleLength; i++) {
    if (sample[i] === 0xFF) ffCount++;
  }
  const isMostlyErased = ffCount / sampleLength > 0.90;

  if (isMostlyErased) {
    return {
      status: 'readable',
      entropy,
      hasValidAppHeader,
      hasValidPartitionTable,
      detectedSignatures,
      explanation: 'Region consists predominantly of unprogrammed/erased Flash memory (0xFF padding).',
    };
  }

  // Classification Logic:
  if (hasValidAppHeader || hasValidPartitionTable) {
    if (flashCryptCount > 0) {
      return {
        status: 'partially_readable',
        entropy,
        hasValidAppHeader,
        hasValidPartitionTable,
        detectedSignatures,
        explanation: 'Plaintext headers detected, but hardware Flash Encryption eFuses are set. Some partitions may be encrypted.',
      };
    }
    return {
      status: 'readable',
      entropy,
      hasValidAppHeader,
      hasValidPartitionTable,
      detectedSignatures,
      explanation: 'Standard ESP image and/or partition headers identified. Firmware is readable plaintext.',
    };
  }

  // If no standard headers found and entropy is extremely high (> 7.92), likely ciphertext
  if (entropy > 7.92 || flashCryptCount > 0) {
    return {
      status: 'likely_encrypted',
      entropy,
      hasValidAppHeader,
      hasValidPartitionTable,
      detectedSignatures,
      explanation: `High Shannon entropy (${entropy.toFixed(3)}/8.0) and missing ESP image headers indicate raw AES ciphertext. Flash Encryption is likely active.`,
    };
  }

  return {
    status: 'undetermined',
    entropy,
    hasValidAppHeader,
    hasValidPartitionTable,
    detectedSignatures,
    explanation: `Header signatures not detected; entropy is ${entropy.toFixed(3)}/8.0. Cannot definitively determine encryption status without partition analysis.`,
  };
}
