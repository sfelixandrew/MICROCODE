import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EspImageParser } from '../../src/parsers/esp/espImageParser.ts';

// Helper to construct synthetic ESP images for fixture testing
function createSyntheticEspImage(options: {
  magic?: number;
  chipId?: number;
  segments?: Array<{ loadAddr: number; data: Uint8Array }>;
  tamperChecksum?: boolean;
  appendSha256?: Uint8Array;
}): Uint8Array {
  const magic = options.magic ?? 0xe9;
  const chipId = options.chipId ?? 0x0000; // Classic ESP32
  const segments = options.segments ?? [
    { loadAddr: 0x40080000, data: new Uint8Array([0x01, 0x02, 0x03, 0x04]) },
    { loadAddr: 0x3ffb0000, data: new Uint8Array([0x10, 0x20, 0x30, 0x40]) },
  ];

  let totalLen = 24; // Header
  for (const seg of segments) {
    totalLen += 8 + seg.data.length;
  }
  const padLen = (16 - (totalLen % 16)) % 16;
  totalLen += padLen + 1; // +1 checksum byte
  if (options.appendSha256) totalLen += 32;

  const buf = new Uint8Array(totalLen);
  const view = new DataView(buf.buffer);

  // Header
  view.setUint8(0, magic);
  view.setUint8(1, segments.length);
  view.setUint8(2, 0x02); // DIO
  view.setUint8(3, 0x20); // 40MHz, 4MB
  view.setUint32(4, 0x40080000, true); // Entry point
  view.setUint8(8, 0x00); // wp_pin
  view.setUint16(12, chipId, true); // chip_id

  // Segments
  let cur = 24;
  let chk = 0xef;

  for (const seg of segments) {
    view.setUint32(cur, seg.loadAddr, true);
    view.setUint32(cur + 4, seg.data.length, true);
    cur += 8;
    buf.set(seg.data, cur);
    for (let b = 0; b < seg.data.length; b++) {
      chk ^= seg.data[b];
    }
    cur += seg.data.length;
  }

  // Padding
  cur += padLen;

  // Checksum
  buf[cur] = options.tamperChecksum ? (chk ^ 0xff) : chk;
  cur += 1;

  // Optional SHA-256
  if (options.appendSha256) {
    buf.set(options.appendSha256, cur);
  }

  return buf;
}

describe('Stage 7: ESP Image Parser', () => {
  test('successfully parses valid ESP image format v1 header and segments', () => {
    const raw = createSyntheticEspImage({
      chipId: 0x0000,
      segments: [
        { loadAddr: 0x40080000, data: new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]) },
      ],
    });

    const res = EspImageParser.parseImage(raw, 0);

    assert.equal(res.valid, true);
    assert.equal(res.magic, 0xe9);
    assert.equal(res.segmentCount, 1);
    assert.equal(res.entryPoint, 0x40080000);
    assert.ok(res.chipName.includes('Classic Xtensa LX6'));
    assert.equal(res.spiMode, 'DIO (Dual I/O)');
    assert.equal(res.spiSpeed, '40 MHz');
    assert.equal(res.flashSize, '4 MB');
    assert.equal(res.segments.length, 1);
    assert.equal(res.segments[0].loadAddress, 0x40080000);
    assert.equal(res.segments[0].dataLength, 4);
    assert.equal(res.checksumValid, true);
  });

  test('maps chip ID to corresponding ESP family (S2, S3, C3, C6)', () => {
    const s2Image = createSyntheticEspImage({ chipId: 0x0002 });
    assert.ok(EspImageParser.parseImage(s2Image).chipName.includes('ESP32-S2'));

    const s3Image = createSyntheticEspImage({ chipId: 0x0009 });
    assert.ok(EspImageParser.parseImage(s3Image).chipName.includes('ESP32-S3'));

    const c3Image = createSyntheticEspImage({ chipId: 0x0005 });
    assert.ok(EspImageParser.parseImage(c3Image).chipName.includes('ESP32-C3'));

    const c6Image = createSyntheticEspImage({ chipId: 0x000d });
    assert.ok(EspImageParser.parseImage(c6Image).chipName.includes('ESP32-C6'));
  });

  test('detects and reports checksum mismatch', () => {
    const corruptedImage = createSyntheticEspImage({ tamperChecksum: true });
    const res = EspImageParser.parseImage(corruptedImage);

    assert.equal(res.checksumValid, false);
    assert.ok(res.warnings.some((w) => w.code === 'CHECKSUM_MISMATCH'));
  });

  test('parses optional appended SHA-256 digest', () => {
    const fakeSha = new Uint8Array(32);
    fakeSha.fill(0x42);

    const imageWithSha = createSyntheticEspImage({ appendSha256: fakeSha });
    const res = EspImageParser.parseImage(imageWithSha);

    assert.equal(res.hasAppendedHash, true);
    assert.equal(res.sha256DigestHex, '42'.repeat(32));
  });

  test('safely rejects truncated header (< 24 bytes)', () => {
    const truncated = new Uint8Array([0xe9, 0x01, 0x02, 0x20]);
    const res = EspImageParser.parseImage(truncated);

    assert.equal(res.valid, false);
    assert.ok(res.warnings.some((w) => w.code === 'IMAGE_TRUNCATED'));
  });

  test('safely rejects non-matching magic byte', () => {
    const badMagic = new Uint8Array(32);
    badMagic[0] = 0x55; // Not 0xE9
    const res = EspImageParser.parseImage(badMagic);

    assert.equal(res.valid, false);
    assert.ok(res.warnings.some((w) => w.code === 'INVALID_MAGIC'));
  });

  test('handles truncated segment data gracefully', () => {
    const raw = createSyntheticEspImage({});
    // Slice off middle of segment data
    const truncatedSeg = raw.subarray(0, 30);
    const res = EspImageParser.parseImage(truncatedSeg);

    assert.equal(res.valid, false);
    assert.ok(res.warnings.some((w) => w.code.includes('TRUNCATED')));
  });
});
