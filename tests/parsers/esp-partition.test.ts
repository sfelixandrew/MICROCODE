import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EspPartitionParser } from '../../src/parsers/esp/espPartitionParser.ts';
import type { EspPartitionEntry } from '../../src/parsers/esp/espPartitionParser.ts';
import { computeMd5Sync } from '../../src/utils/crypto.ts';

function createSyntheticPartitionEntry(options: {
  type: number;
  subtype: number;
  offset: number;
  size: number;
  label: string;
  flags?: number;
  magic?: number;
}): Uint8Array {
  const buf = new Uint8Array(32);
  const view = new DataView(buf.buffer);

  // Magic 0xAA 0x50 (little-endian 0x50AA)
  if (options.magic !== undefined) {
    view.setUint16(0, options.magic, true);
  } else {
    buf[0] = 0xaa;
    buf[1] = 0x50;
  }

  view.setUint8(2, options.type);
  view.setUint8(3, options.subtype);
  view.setUint32(4, options.offset, true);
  view.setUint32(8, options.size, true);

  const encoder = new TextEncoder();
  const labelBytes = encoder.encode(options.label);
  buf.set(labelBytes.subarray(0, 16), 12);

  view.setUint32(28, options.flags ?? 0, true);
  return buf;
}

function createSyntheticPartitionTable(options: {
  entries: Uint8Array[];
  includeMd5?: boolean;
  tamperMd5?: boolean;
  totalTableBytes?: number;
}): Uint8Array {
  const tableBytes = options.totalTableBytes ?? 0xc00;
  const buf = new Uint8Array(tableBytes);
  buf.fill(0xff);

  let cur = 0;
  for (const entry of options.entries) {
    buf.set(entry, cur);
    cur += 32;
  }

  if (options.includeMd5) {
    // Generate MD5 record (magic 0xEB 0xEB)
    const precedingData = buf.subarray(0, cur);
    const md5Hex = computeMd5Sync(precedingData);
    const md5Bytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
      md5Bytes[i] = parseInt(md5Hex.slice(i * 2, i * 2 + 2), 16);
      if (options.tamperMd5) md5Bytes[i] ^= 0xff;
    }

    const md5Record = new Uint8Array(32);
    md5Record[0] = 0xeb;
    md5Record[1] = 0xeb;
    md5Record.set(md5Bytes, 16);

    buf.set(md5Record, cur);
    cur += 32;
  }

  return buf;
}

describe('Stage 7: ESP Partition Table Parser', () => {
  test('successfully parses valid ESP-IDF partition table with MD5 validation', () => {
    const e1 = createSyntheticPartitionEntry({
      type: 0x01,
      subtype: 0x02,
      offset: 0x9000,
      size: 0x6000,
      label: 'nvs',
    });
    const e2 = createSyntheticPartitionEntry({
      type: 0x01,
      subtype: 0x01,
      offset: 0xf000,
      size: 0x1000,
      label: 'phy_init',
    });
    const e3 = createSyntheticPartitionEntry({
      type: 0x00,
      subtype: 0x00,
      offset: 0x10000,
      size: 0x100000,
      label: 'factory',
    });

    const tableBuf = createSyntheticPartitionTable({
      entries: [e1, e2, e3],
      includeMd5: true,
    });

    // Place at 0x8000 in simulated 4 MB Flash dump
    const flashDump = new Uint8Array(4 * 1024 * 1024);
    flashDump.set(tableBuf, 0x8000);

    const res = EspPartitionParser.parsePartitionTable(flashDump, 0x8000, 4 * 1024 * 1024);

    assert.ok(res);
    assert.equal(res.valid, true);
    assert.equal(res.entries.length, 3);
    assert.equal(res.hasMd5Record, true);
    assert.equal(res.md5Valid, true);
    assert.equal(res.overlaps.length, 0);

    // Verify first partition: nvs
    assert.equal(res.entries[0].label, 'nvs');
    assert.equal(res.entries[0].typeLabel, 'data');
    assert.equal(res.entries[0].subtypeLabel, 'nvs');
    assert.equal(res.entries[0].offset, 0x9000);
    assert.equal(res.entries[0].size, 0x6000);

    // Verify factory partition
    assert.equal(res.entries[2].label, 'factory');
    assert.equal(res.entries[2].typeLabel, 'app');
    assert.equal(res.entries[2].subtypeLabel, 'factory');
    assert.equal(res.entries[2].offset, 0x10000);
  });

  test('detects and reports MD5 checksum mismatch when table is tampered', () => {
    const e1 = createSyntheticPartitionEntry({
      type: 0x01,
      subtype: 0x02,
      offset: 0x9000,
      size: 0x6000,
      label: 'nvs',
    });

    const tableBuf = createSyntheticPartitionTable({
      entries: [e1],
      includeMd5: true,
      tamperMd5: true, // Invalidate MD5
    });

    const flashDump = new Uint8Array(0x10000);
    flashDump.set(tableBuf, 0x8000);

    const res = EspPartitionParser.parsePartitionTable(flashDump, 0x8000);

    assert.ok(res);
    assert.equal(res.valid, false);
    assert.equal(res.md5Valid, false);
    assert.ok(res.warnings.some((w) => w.code === 'MD5_CHECKSUM_MISMATCH'));
  });

  test('detects overlapping partitions', () => {
    // Partition A: 0x10000..0x30000 (128 KiB)
    const e1 = createSyntheticPartitionEntry({
      type: 0x00,
      subtype: 0x00,
      offset: 0x10000,
      size: 0x20000,
      label: 'factory',
    });
    // Partition B: 0x20000..0x40000 (overlaps by 64 KiB with A)
    const e2 = createSyntheticPartitionEntry({
      type: 0x00,
      subtype: 0x10,
      offset: 0x20000,
      size: 0x20000,
      label: 'ota_0',
    });

    const tableBuf = createSyntheticPartitionTable({ entries: [e1, e2] });
    const flashDump = new Uint8Array(0x10000);
    flashDump.set(tableBuf, 0x8000);

    const res = EspPartitionParser.parsePartitionTable(flashDump, 0x8000);

    assert.ok(res);
    assert.equal(res.overlaps.length, 1);
    assert.equal(res.overlaps[0].regionA, 'factory');
    assert.equal(res.overlaps[0].regionB, 'ota_0');
    assert.equal(res.overlaps[0].start, 0x20000);
    assert.equal(res.overlaps[0].end, 0x30000);
    assert.equal(res.overlaps[0].length, 0x10000);
    assert.ok(res.warnings.some((w) => w.code === 'PARTITION_OVERLAP'));
  });

  test('flags partition exceeding known flash capacity', () => {
    // Partition requesting 8 MB in a 4 MB Flash
    const oversized = createSyntheticPartitionEntry({
      type: 0x00,
      subtype: 0x00,
      offset: 0x100000,
      size: 0x800000, // 8 MB
      label: 'oversized',
    });

    const tableBuf = createSyntheticPartitionTable({ entries: [oversized] });
    const flashDump = new Uint8Array(0x10000);
    flashDump.set(tableBuf, 0x8000);

    const res = EspPartitionParser.parsePartitionTable(flashDump, 0x8000, 4 * 1024 * 1024);

    assert.ok(res);
    assert.ok(res.warnings.some((w) => w.code === 'OUT_OF_BOUNDS_PARTITION'));
    assert.equal(res.entries[0].isValid, false);
  });

  test('detects encrypted partition flag (bit 0)', () => {
    const encryptedEntry = createSyntheticPartitionEntry({
      type: 0x00,
      subtype: 0x00,
      offset: 0x10000,
      size: 0x10000,
      label: 'secure_app',
      flags: 0x00000001, // bit 0 set: encrypted
    });

    const tableBuf = createSyntheticPartitionTable({ entries: [encryptedEntry] });
    const flashDump = new Uint8Array(0x10000);
    flashDump.set(tableBuf, 0x8000);

    const res = EspPartitionParser.parsePartitionTable(flashDump, 0x8000);

    assert.ok(res);
    assert.equal(res.entries[0].isEncrypted, true);
  });

  test('returns null when partition table magic is absent', () => {
    const emptyBuf = new Uint8Array(0x10000);
    emptyBuf.fill(0xff);

    const res = EspPartitionParser.parsePartitionTable(emptyBuf);
    assert.equal(res, null);
  });
});
