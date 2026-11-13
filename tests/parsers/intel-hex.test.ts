import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { IntelHexParser } from '../../src/parsers/avr/intelHexParser.ts';

describe('Stage 7: Intel HEX Parser', () => {
  test('successfully parses valid Intel HEX with data and EOF records', () => {
    // 4 bytes at 0x0000: 0C 94 34 00 (sum=0xD8, 2s comp=0x28)
    // EOF record: :00000001FF
    const sampleHex =
      ':040000000C94340028\n' +
      ':00000001FF\n';

    const res = IntelHexParser.parse(sampleHex);

    assert.equal(res.valid, true);
    assert.equal(res.totalDataBytes, 4);
    assert.equal(res.minAddress, 0);
    assert.equal(res.maxAddress, 3);
    assert.equal(res.hasEofRecord, true);
    assert.equal(res.segments.length, 1);
    assert.equal(res.segments[0].baseAddress, 0);
    assert.equal(res.segments[0].length, 4);
    assert.equal(res.segments[0].data[0], 0x0c);
    assert.equal(res.segments[0].data[1], 0x94);
    assert.equal(res.segments[0].data[2], 0x34);
    assert.equal(res.segments[0].data[3], 0x00);
  });

  test('collates non-contiguous address gaps into distinct segments', () => {
    // Segment 1 at 0x0000 (4 bytes)
    // Segment 2 at 0x0100 (2 bytes: 0xAA 0xBB -> sum=0x02+0x01+0x00+0x00+0xAA+0xBB = 0x168 -> 2s comp=0x98)
    const gappedHex =
      ':040000000C94340028\n' +
      ':02010000AABB98\n' +
      ':00000001FF\n';

    const res = IntelHexParser.parse(gappedHex);

    assert.equal(res.valid, true);
    assert.equal(res.segments.length, 2);
    assert.equal(res.segments[0].baseAddress, 0x0000);
    assert.equal(res.segments[0].length, 4);
    assert.equal(res.segments[1].baseAddress, 0x0100);
    assert.equal(res.segments[1].length, 2);
    assert.equal(res.segments[1].data[0], 0xaa);
    assert.equal(res.segments[1].data[1], 0xbb);
  });

  test('handles Extended Linear Address (04) record', () => {
    // Set upper address to 0x00010000 (:020000040001F9)
    // Data at offset 0x0010 (address 0x00010010, 2 bytes 0x11 0x22: sum=0x02+0x00+0x10+0x00+0x11+0x22 = 0x45 -> 2s comp=0xBB)
    const extendedHex =
      ':020000040001F9\n' +
      ':020010001122BB\n' +
      ':00000001FF\n';

    const res = IntelHexParser.parse(extendedHex);

    assert.equal(res.valid, true);
    assert.equal(res.segments.length, 1);
    assert.equal(res.segments[0].baseAddress, 0x00010010);
    assert.equal(res.segments[0].length, 2);
    assert.equal(res.segments[0].data[0], 0x11);
    assert.equal(res.segments[0].data[1], 0x22);
  });

  test('detects line checksum errors', () => {
    // Bad checksum on line 1: 0x99 instead of 0x28
    const corruptedHex =
      ':040000000C94340099\n' +
      ':00000001FF\n';

    const res = IntelHexParser.parse(corruptedHex);

    assert.equal(res.valid, false);
    assert.ok(res.warnings.some((w) => w.code === 'HEX_CHECKSUM_ERROR'));
  });

  test('reports error on missing colon', () => {
    const invalidLine = '040000000C94340028\n:00000001FF\n';
    const res = IntelHexParser.parse(invalidLine);

    assert.equal(res.valid, false);
    assert.ok(res.warnings.some((w) => w.code === 'MALFORMED_LINE'));
  });

  test('reconstitutes dense 32 KiB binary buffer with unprogrammed padding', () => {
    const sampleHex =
      ':040000000C94340028\n' +
      ':00000001FF\n';

    const parseRes = IntelHexParser.parse(sampleHex);
    const bin = IntelHexParser.toBinaryBuffer(parseRes, 32768, 0xff);

    assert.equal(bin.length, 32768);
    assert.equal(bin[0], 0x0c);
    assert.equal(bin[1], 0x94);
    assert.equal(bin[2], 0x34);
    assert.equal(bin[3], 0x00);
    // Trailing unwritten gap must be 0xFF
    assert.equal(bin[4], 0xff);
    assert.equal(bin[32767], 0xff);
  });
});
