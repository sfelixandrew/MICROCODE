import { describe, it } from 'node:test';
import assert from 'node:assert';
import { computeSha256 } from '../../src/utils/crypto.ts';

describe('Cryptographic Hashing Utility (SHA-256)', () => {
  it('computes correct SHA-256 for empty buffer', async () => {
    const data = new Uint8Array(0);
    const hash = await computeSha256(data);
    assert.strictEqual(hash, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('computes correct SHA-256 for standard ASCII vector "hello world"', async () => {
    const data = new TextEncoder().encode('hello world');
    const hash = await computeSha256(data);
    assert.strictEqual(hash, 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
  });

  it('computes deterministic SHA-256 for binary patterns', async () => {
    const data1 = new Uint8Array([0xAA, 0x50, 0x01, 0x02]);
    const data2 = new Uint8Array([0xAA, 0x50, 0x01, 0x02]);
    const hash1 = await computeSha256(data1);
    const hash2 = await computeSha256(data2);
    assert.strictEqual(hash1, hash2);
    assert.strictEqual(hash1.length, 64);
  });
});
