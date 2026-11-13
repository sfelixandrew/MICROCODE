/**
 * Unit Tests for ESP32 / Xtensa LX6 Disassembler
 * MICROCODE INSPECTOR — STAGE 8
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  XtensaDisassemblerAdapter,
  type XtensaToolRunner,
} from '../../src/disassembly/adapters/XtensaDisassemblerAdapter.ts';

test('XtensaDisassemblerAdapter without runner marks itself unsupported and provides guidance', async () => {
  const adapter = new XtensaDisassemblerAdapter(null);

  assert.equal(adapter.architecture, 'xtensa-lx6');
  assert.equal(adapter.isSupported, false);
  assert.ok(adapter.backendName.includes('Missing'));

  const limitations = adapter.getLimitations();
  assert.ok(limitations.length >= 3);
  assert.ok(limitations.some((l) => l.includes('L32R')));
  assert.ok(limitations.some((l) => l.includes('Raw Flash dumps')));

  const result = await adapter.disassemble({
    data: new Uint8Array([0x00, 0x41, 0x36]),
    baseAddress: 0x40080000,
    architecture: 'xtensa-lx6',
  });

  assert.equal(result.success, false);
  assert.equal(result.confidence, 'unsupported');
  assert.equal(result.totalInstructions, 0);
  assert.ok(result.errors.length > 0);
  assert.ok(
    result.errors.some((e) =>
      e.includes('xtensa-esp32-elf-objdump -b binary -m xtensa -D --adjust-vma=0x40080000')
    )
  );
  assert.ok(result.addressBasisExplanation.includes('IRAM'));
});

test('XtensaDisassemblerAdapter with mock tool runner decodes simulated objdump output', async () => {
  const mockRunner: XtensaToolRunner = {
    async runObjdump(binaryData: Uint8Array, baseAddress: number) {
      const simulatedOutput = `
Disassembly of section .data:

40080000 <.data>:
40080000:\tf06d      \tret.n
40080002:\t004136    \tentry\ta1, 32
40080005:\tfffd81    \tl32r\ta8, 40080368 <.literal+0x4>
40080008:\t000880    \tcallx8\ta8
4008000b:\tffff      \t.byte 0xff, 0xff
`;
      return { stdout: simulatedOutput, stderr: '', exitCode: 0 };
    },
  };

  const adapter = new XtensaDisassemblerAdapter(mockRunner);
  assert.equal(adapter.isSupported, true);

  const result = await adapter.disassemble({
    data: new Uint8Array(16),
    baseAddress: 0x40080000,
    architecture: 'xtensa-lx6',
  });

  assert.equal(result.success, true);
  assert.equal(result.confidence, 'verified');
  assert.equal(result.totalInstructions, 5);
  assert.equal(result.undecodableCount, 1);

  // Instruction 0: ret.n
  assert.equal(result.instructions[0].address, 0x40080000);
  assert.equal(result.instructions[0].mnemonic, 'ret.n');
  assert.equal(result.instructions[0].isReturn, true);

  // Instruction 1: entry
  assert.equal(result.instructions[1].address, 0x40080002);
  assert.equal(result.instructions[1].mnemonic, 'entry');
  assert.equal(result.instructions[1].operands, 'a1, 32');

  // Instruction 2: l32r with literal comment
  assert.equal(result.instructions[2].address, 0x40080005);
  assert.equal(result.instructions[2].mnemonic, 'l32r');
  assert.equal(result.instructions[2].comment, '<.literal+0x4>');

  // Instruction 3: callx8
  assert.equal(result.instructions[3].address, 0x40080008);
  assert.equal(result.instructions[3].mnemonic, 'callx8');
  assert.equal(result.instructions[3].isCall, true);

  // Instruction 4: .byte (undecodable)
  assert.equal(result.instructions[4].address, 0x4008000b);
  assert.equal(result.instructions[4].mnemonic, '.byte');
  assert.equal(result.instructions[4].isDecodable, false);
});

test('XtensaDisassemblerAdapter handles tool runner error gracefully', async () => {
  const failingRunner: XtensaToolRunner = {
    async runObjdump() {
      return { stdout: '', stderr: 'xtensa-esp32-elf-objdump: bad architecture', exitCode: 1 };
    },
  };

  const adapter = new XtensaDisassemblerAdapter(failingRunner);
  const result = await adapter.disassemble({
    data: new Uint8Array(4),
    baseAddress: 0x40080000,
    architecture: 'xtensa-lx6',
  });

  assert.equal(result.success, false);
  assert.equal(result.confidence, 'unsupported');
  assert.ok(result.errors.some((e) => e.includes('bad architecture')));
});

