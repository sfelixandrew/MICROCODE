import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  formatHexAddress,
  formatByteSize,
  calculateChunkSlices,
  isAddressWithinBounds,
} from '../../src/utils/address.ts';

describe('Address Arithmetic & Formatting Utilities', () => {
  it('formats hex addresses with standard 8-character zero-padding', () => {
    assert.strictEqual(formatHexAddress(0), '0x00000000');
    assert.strictEqual(formatHexAddress(0x1000), '0x00001000');
    assert.strictEqual(formatHexAddress(0x40080698), '0x40080698');
    assert.strictEqual(formatHexAddress(0x400000), '0x00400000');
  });

  it('formats human-readable byte sizes accurately', () => {
    assert.strictEqual(formatByteSize(0), '0 bytes');
    assert.strictEqual(formatByteSize(512), '512 bytes');
    assert.strictEqual(formatByteSize(32768), '32 KiB (32,768 bytes)');
    assert.strictEqual(formatByteSize(4194304), '4 MB (4,194,304 bytes)');
  });

  it('calculates bounded chunk slices correctly', () => {
    const totalBytes = 131072; // 128 KiB
    const chunkSize = 65536;   // 64 KiB
    const slices = calculateChunkSlices(totalBytes, chunkSize);

    assert.strictEqual(slices.length, 2);
    assert.deepStrictEqual(slices[0], { offset: 0, length: 65536 });
    assert.deepStrictEqual(slices[1], { offset: 65536, length: 65536 });
  });

  it('handles odd total bytes for last chunk slice without overflow', () => {
    const totalBytes = 100000;
    const chunkSize = 65536;
    const slices = calculateChunkSlices(totalBytes, chunkSize);

    assert.strictEqual(slices.length, 2);
    assert.deepStrictEqual(slices[0], { offset: 0, length: 65536 });
    assert.deepStrictEqual(slices[1], { offset: 65536, length: 34464 });
    assert.strictEqual(slices[0].length + slices[1].length, totalBytes);
  });

  it('verifies address within bounds', () => {
    assert.strictEqual(isAddressWithinBounds(0x1000, 0x1000, 0x1000), true);
    assert.strictEqual(isAddressWithinBounds(0x1FFF, 0x1000, 0x1000), true);
    assert.strictEqual(isAddressWithinBounds(0x2000, 0x1000, 0x1000), false);
    assert.strictEqual(isAddressWithinBounds(0x0FFF, 0x1000, 0x1000), false);
  });
});
