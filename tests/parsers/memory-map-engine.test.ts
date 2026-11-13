import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryMapEngine } from '../../src/parsers/memoryMapEngine.ts';
import { computeMd5Sync } from '../../src/utils/crypto.ts';

// Helper to create synthetic full ESP32 4 MB Flash dump
function createFullEsp32Dump(): Uint8Array {
  const dump = new Uint8Array(4 * 1024 * 1024);
  dump.fill(0xff);

  // 1. Bootloader at 0x1000
  dump[0x1000] = 0xe9; // Magic
  dump[0x1001] = 0x01; // 1 segment
  dump[0x1002] = 0x02; // DIO
  dump[0x1003] = 0x20; // 40MHz, 4MB
  const view = new DataView(dump.buffer);
  view.setUint32(0x1004, 0x40080000, true); // Entry point
  view.setUint16(0x100c, 0x0000, true); // ESP32 Classic
  // Segment 0
  view.setUint32(0x1018, 0x40080000, true);
  view.setUint32(0x101c, 64, true); // 64 bytes
  dump.fill(0x55, 0x1020, 0x1020 + 64);

  // 2. Partition Table at 0x8000
  // Entry 1: NVS (0x9000, 24 KiB)
  dump[0x8000] = 0xaa;
  dump[0x8001] = 0x50;
  dump[0x8002] = 0x01; // Data
  dump[0x8003] = 0x02; // NVS
  view.setUint32(0x8004, 0x9000, true);
  view.setUint32(0x8008, 0x6000, true);
  dump.fill(0, 0x800c, 0x801c);
  new TextEncoder().encodeInto('nvs', dump.subarray(0x800c, 0x801c));

  // Entry 2: Factory App (0x10000, 1 MB)
  dump[0x8020] = 0xaa;
  dump[0x8021] = 0x50;
  dump[0x8022] = 0x00; // App
  dump[0x8023] = 0x00; // Factory
  view.setUint32(0x8024, 0x10000, true);
  view.setUint32(0x8028, 0x100000, true);
  dump.fill(0, 0x802c, 0x803c);
  new TextEncoder().encodeInto('factory', dump.subarray(0x802c, 0x803c));

  // MD5 Checksum Record for Partition Table at 0x8040
  dump[0x8040] = 0xeb;
  dump[0x8041] = 0xeb;
  const tableData = dump.subarray(0x8000, 0x8040);
  const md5Hex = computeMd5Sync(tableData);
  for (let i = 0; i < 16; i++) {
    dump[0x8050 + i] = parseInt(md5Hex.slice(i * 2, i * 2 + 2), 16);
  }

  // 3. Factory App Header at 0x10000
  dump[0x10000] = 0xe9;
  dump[0x10001] = 0x01; // 1 segment
  dump[0x10002] = 0x02;
  dump[0x10003] = 0x20;
  view.setUint32(0x10004, 0x400d0000, true);
  view.setUint32(0x10018, 0x400d0000, true);
  view.setUint32(0x1001c, 128, true);
  dump.fill(0x33, 0x10020, 0x10020 + 128);

  // String inside app
  new TextEncoder().encodeInto('HTTP_SERVER_INIT_OK', dump.subarray(0x10100, 0x10120));

  return dump;
}

describe('Stage 7: Unified Memory Map Engine', () => {
  test('accurately parses full ESP32 Flash dump into verified topological memory map', () => {
    const dump = createFullEsp32Dump();
    const report = MemoryMapEngine.analyze(dump, { flashCapacityHint: 4 * 1024 * 1024 });

    assert.equal(report.targetArchitecture, 'xtensa-lx6');
    assert.equal(report.detectedFormat, 'esp_image');
    assert.equal(report.totalSize, 4 * 1024 * 1024);

    // Verified regions present
    const bootloader = report.regions.find((r) => r.type === 'bootloader');
    assert.ok(bootloader);
    assert.equal(bootloader.offset, 0x1000);
    assert.equal(bootloader.confidence, 'verified');

    const partTable = report.regions.find((r) => r.type === 'partition_table');
    assert.ok(partTable);
    assert.equal(partTable.offset, 0x8000);
    assert.equal(partTable.confidence, 'verified');

    const nvs = report.regions.find((r) => r.name.includes('nvs'));
    assert.ok(nvs);
    assert.equal(nvs.offset, 0x9000);
    assert.equal(nvs.length, 0x6000);

    const factory = report.regions.find((r) => r.name.includes('factory'));
    assert.ok(factory);
    assert.equal(factory.offset, 0x10000);
    assert.equal(factory.confidence, 'verified');
    assert.ok(factory.confidenceReason.includes('Verified valid app image header'));

    // Check string extraction
    const foundString = report.strings.find((s) => s.value.includes('HTTP_SERVER_INIT_OK'));
    assert.ok(foundString);

    // Unmapped ranges identified
    assert.ok(report.unmappedRanges.length > 0);
    assert.equal(report.unmappedRanges[0].offset, 0); // 0x0000 to 0x1000 unmapped
    assert.equal(report.unmappedRanges[0].length, 0x1000);
  });

  test('accurately parses Intel HEX for Arduino Uno R3', () => {
    const sampleHex =
      ':040000000C94340028\n' +
      ':02006800112263\n' +
      ':00000001FF\n';

    const report = MemoryMapEngine.analyze(sampleHex, {
      targetArchitectureHint: 'avr8',
    });

    assert.equal(report.targetArchitecture, 'avr8');
    assert.equal(report.detectedFormat, 'intel_hex');

    const vec = report.regions.find((r) => r.type === 'vector_table');
    assert.ok(vec);
    assert.equal(vec.offset, 0);
    assert.equal(vec.confidence, 'verified');

    const eeprom = report.regions.find((r) => r.type === 'eeprom');
    assert.ok(eeprom);
    assert.equal(eeprom.length, 1024);
  });

  test('enforces that unknown data stays Unknown and is never forced into a false classification', () => {
    // Generate buffer with arbitrary non-firmware data
    const arbitraryData = new Uint8Array(4096);
    for (let i = 0; i < arbitraryData.length; i++) {
      arbitraryData[i] = (i ^ 0xa5) & 0xff;
    }

    const report = MemoryMapEngine.analyze(arbitraryData);

    assert.equal(report.targetArchitecture, 'unknown');
    assert.equal(report.detectedFormat, 'raw_binary');
    assert.equal(report.regions.length, 1);
    assert.equal(report.regions[0].type, 'unknown');
    assert.equal(report.regions[0].confidence, 'unknown');
    assert.ok(report.regions[0].confidenceReason.includes('No recognized microcontroller'));
  });

  test('surfaces warnings and overlaps when malformed data is presented', () => {
    const corruptedDump = new Uint8Array(0x10000);
    // Malformed partition table entry at 0x8000
    corruptedDump[0x8000] = 0xaa;
    corruptedDump[0x8001] = 0x50;
    corruptedDump[0x8002] = 0x00;
    // Set unaligned offset (0x8123)
    const view = new DataView(corruptedDump.buffer);
    view.setUint32(0x8004, 0x8123, true);
    view.setUint32(0x8008, 0x1000, true);

    const report = MemoryMapEngine.analyze(corruptedDump, {
      preferredPartitionOffset: 0x8000,
    });

    assert.ok(report.warnings.some((w) => w.code === 'UNALIGNED_PARTITION'));
  });
});
