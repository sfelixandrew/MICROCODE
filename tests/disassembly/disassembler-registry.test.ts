/**
 * Unit Tests for Disassembler Architecture Registry
 * MICROCODE INSPECTOR — STAGE 8
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { DisassemblerRegistry } from '../../src/disassembly/DisassemblerRegistry.ts';
import { AvrDisassemblerAdapter } from '../../src/disassembly/adapters/AvrDisassemblerAdapter.ts';
import { XtensaDisassemblerAdapter } from '../../src/disassembly/adapters/XtensaDisassemblerAdapter.ts';
import { UnsupportedArchAdapter } from '../../src/disassembly/adapters/UnsupportedArchAdapter.ts';

test('DisassemblerRegistry returns AVR adapter for avr8', () => {
  const registry = new DisassemblerRegistry();
  const adapter = registry.getAdapter('avr8');

  assert.ok(adapter instanceof AvrDisassemblerAdapter);
  assert.equal(adapter.architecture, 'avr8');
  assert.equal(adapter.isSupported, true);
});

test('DisassemblerRegistry returns Xtensa adapter for xtensa-lx6', () => {
  const registry = new DisassemblerRegistry();
  const adapter = registry.getAdapter('xtensa-lx6');

  assert.ok(adapter instanceof XtensaDisassemblerAdapter);
  assert.equal(adapter.architecture, 'xtensa-lx6');
});

test('DisassemblerRegistry returns UnsupportedArchAdapter for xtensa-lx7 and riscv32', async () => {
  const registry = new DisassemblerRegistry();

  const lx7Adapter = registry.getAdapter('xtensa-lx7');
  assert.ok(lx7Adapter instanceof UnsupportedArchAdapter);
  assert.equal(lx7Adapter.isSupported, false);
  const lx7Result = await lx7Adapter.disassemble({
    data: new Uint8Array(4),
    baseAddress: 0x42000000,
    architecture: 'xtensa-lx7',
  });
  assert.equal(lx7Result.confidence, 'unsupported');
  assert.ok(lx7Result.errors.some((e) => e.includes('xtensa-esp32s3-elf-objdump')));

  const riscvAdapter = registry.getAdapter('riscv32');
  assert.ok(riscvAdapter instanceof UnsupportedArchAdapter);
  assert.equal(riscvAdapter.isSupported, false);
  const riscvResult = await riscvAdapter.disassemble({
    data: new Uint8Array(4),
    baseAddress: 0x42000000,
    architecture: 'riscv32',
  });
  assert.equal(riscvResult.confidence, 'unsupported');
  assert.ok(riscvResult.errors.some((e) => e.includes('riscv32-esp-elf-objdump')));
});

test('DisassemblerRegistry lists supported and recognized architectures', () => {
  const registry = new DisassemblerRegistry();
  const list = registry.getSupportedArchitectures();

  assert.ok(list.length >= 4);
  const avr = list.find((a) => a.architecture === 'avr8');
  assert.ok(avr);
  assert.equal(avr.isSupported, true);

  const lx7 = list.find((a) => a.architecture === 'xtensa-lx7');
  assert.ok(lx7);
  assert.equal(lx7.isSupported, false);
});

