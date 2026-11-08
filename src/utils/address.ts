/**
 * Address arithmetic and byte formatting utilities.
 */

export function formatHexAddress(address: number, padLength: number = 8): string {
  if (!Number.isSafeInteger(address) || address < 0) {
    return '0x' + '0'.repeat(padLength);
  }
  return '0x' + address.toString(16).toUpperCase().padStart(padLength, '0');
}

export function formatByteSize(bytes: number): string {
  if (!Number.isSafeInteger(bytes) || bytes < 0) return '0 B';
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    return `${Number.isInteger(mb) ? mb : mb.toFixed(2)} MB (${bytes.toLocaleString('en-US')} bytes)`;
  }
  if (bytes >= 1024) {
    const kb = bytes / 1024;
    return `${Number.isInteger(kb) ? kb : kb.toFixed(2)} KiB (${bytes.toLocaleString('en-US')} bytes)`;
  }
  return `${bytes} bytes`;
}

export interface ChunkSlice {
  offset: number;
  length: number;
}

export function calculateChunkSlices(totalBytes: number, chunkSize: number = 65536): ChunkSlice[] {
  if (totalBytes <= 0 || chunkSize <= 0) return [];
  const slices: ChunkSlice[] = [];
  for (let offset = 0; offset < totalBytes; offset += chunkSize) {
    const length = Math.min(chunkSize, totalBytes - offset);
    slices.push({ offset, length });
  }
  return slices;
}

export function isAddressWithinBounds(address: number, base: number, size: number): boolean {
  return address >= base && address < base + size;
}

