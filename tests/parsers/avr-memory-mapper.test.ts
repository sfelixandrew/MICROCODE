import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AvrMemoryMapper } from '../../src/parsers/avr/avrMemoryMapper.ts';

function createSyntheticUnoFlash(options: {
  appCodeLength?: number;
  bootloaderLength?: number;
}): Uint8Array {
  const flash = new Uint8Array(32768);
  flash.fill(0xff); // Default erased state

  // Vector 0: JMP 0x0068 (Reset vector)
  flash[0] = 0x0c;
  flash[1] = 0x94;
  flash[2] = 0x34; // 0x0034 in word address = 0x0068 in byte address
  flash[3] = 0x00;

  // Fill application code from 0x0068
  const appLen = options.appCodeLength ?? 1024;
  for (let i = 0; i < appLen; i++) {
    flash[0x0068 + i] = (i * 7) & 0xff;
  }

  // Fill Optiboot at 0x7E00
  const bootLen = options.bootloaderLength ?? 512;
  for (let i = 0; i < bootLen; i++) {
    flash[0x7e00 + i] = 0xcc;
  }

  return flash;
}

describe('Stage 7: ATmega328P Memory Mapper', () => {
  test('maps standard Arduino Uno Flash layout with vector table, app, and padding', () => {
    const flash = createSyntheticUnoFlash({ appCodeLength: 2048 });
    const result = AvrMemoryMapper.mapFlashImage(flash);

    assert.equal(result.flashSize, 32768);
    assert.equal(result.eepromSize, 1024);

    // Vector Table
    const vec = result.regions.find((r) => r.type === 'vector_table');
    assert.ok(vec);
    assert.equal(vec.offset, 0);
    assert.equal(vec.length, 104);
    assert.equal(vec.confidence, 'verified');

    // Application Firmware
    const app = result.regions.find((r) => r.type === 'app');
    assert.ok(app);
    assert.equal(app.offset, 104);
    assert.equal(app.endOffset, 104 + 2048);
    assert.equal(app.confidence, 'verified');

    // Unprogrammed Padding
    const pad = result.regions.find((r) => r.type === 'unprogrammed_padding');
    assert.ok(pad);
    assert.equal(pad.offset, 104 + 2048);
    assert.equal(pad.endOffset, 0x7e00);

    // Bootloader
    const boot = result.regions.find((r) => r.type === 'bootloader');
    assert.ok(boot);
    assert.equal(boot.offset, 0x7e00);
    assert.equal(boot.length, 512);
  });

  test('labels bootloader boundary as heuristic when fuses are absent', () => {
    const flash = createSyntheticUnoFlash({});
    const result = AvrMemoryMapper.mapFlashImage(flash); // No fuses provided

    assert.equal(result.bootloaderConfidence, 'heuristic');
    assert.ok(result.bootloaderReason.includes('Assumed standard Optiboot'));
    const bootRegion = result.regions.find((r) => r.type === 'bootloader');
    assert.equal(bootRegion?.confidence, 'heuristic');
  });

  test('labels bootloader boundary as verified when high fuse is provided', () => {
    const flash = createSyntheticUnoFlash({});

    // High fuse 0xDE: BOOTSZ = 0b11 -> 512 bytes at 0x7E00
    const res512 = AvrMemoryMapper.mapFlashImage(flash, { highFuse: 0xde });
    assert.equal(res512.bootloaderConfidence, 'verified');
    assert.equal(res512.bootloaderSize, 512);
    assert.equal(res512.bootloaderStart, 0x7e00);

    // High fuse 0xDC: BOOTSZ = 0b10 -> 1024 bytes at 0x7C00
    const res1024 = AvrMemoryMapper.mapFlashImage(flash, { highFuse: 0xdc });
    assert.equal(res1024.bootloaderConfidence, 'verified');
    assert.equal(res1024.bootloaderSize, 1024);
    assert.equal(res1024.bootloaderStart, 0x7c00);
  });

  test('isolates EEPROM as a distinct non-volatile memory region', () => {
    const flash = createSyntheticUnoFlash({});
    const result = AvrMemoryMapper.mapFlashImage(flash);

    assert.ok(result.eepromRegion);
    assert.equal(result.eepromRegion.type, 'eeprom');
    assert.equal(result.eepromRegion.length, 1024);
    assert.equal(result.eepromRegion.confidence, 'verified');
    // Ensure EEPROM is not conflated with Flash memory addresses in main regions list
    const eepromInRegions = result.regions.some((r) => r.type === 'eeprom');
    assert.equal(eepromInRegions, false, 'EEPROM must remain separate from Flash memory map');
  });
});
