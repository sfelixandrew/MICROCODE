/**
 * Unit Tests for ATmega328P / AVR 8-bit Disassembler
 * MICROCODE INSPECTOR — STAGE 8
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { AvrDisassemblerAdapter } from '../../src/disassembly/adapters/AvrDisassemblerAdapter.ts';

test('AvrDisassemblerAdapter metadata and limitations', () => {
  const adapter = new AvrDisassemblerAdapter();
  assert.equal(adapter.architecture, 'avr8');
  assert.equal(adapter.isSupported, true);
  assert.ok(adapter.backendName.includes('AVR Decoder'));
  assert.ok(adapter.backendVersion.includes('DS40002198'));

  const limitations = adapter.getLimitations();
  assert.ok(limitations.length >= 3);
  assert.ok(limitations.some((l) => l.includes('Assembly is ground truth')));
});

test('AvrDisassemblerAdapter decodes NOP, RET, RETI, SLEEP, WDR', async () => {
  const adapter = new AvrDisassemblerAdapter();
  // NOP: 0x0000
  // RET: 0x9508
  // RETI: 0x9518
  // SLEEP: 0x9588
  // WDR: 0x95A8
  // In little-endian:
  // 0x00, 0x00, 0x08, 0x95, 0x18, 0x95, 0x88, 0x95, 0xA8, 0x95
  const bytes = new Uint8Array([
    0x00, 0x00, // nop
    0x08, 0x95, // ret
    0x18, 0x95, // reti
    0x88, 0x95, // sleep
    0xa8, 0x95, // wdr
  ]);

  const result = await adapter.disassemble({
    data: bytes,
    baseAddress: 0x0000,
    architecture: 'avr8',
  });

  assert.equal(result.success, true);
  assert.equal(result.totalInstructions, 5);
  assert.equal(result.undecodableCount, 0);

  assert.equal(result.instructions[0].mnemonic, 'nop');
  assert.equal(result.instructions[0].address, 0x0000);

  assert.equal(result.instructions[1].mnemonic, 'ret');
  assert.equal(result.instructions[1].isReturn, true);

  assert.equal(result.instructions[2].mnemonic, 'reti');
  assert.equal(result.instructions[2].isReturn, true);

  assert.equal(result.instructions[3].mnemonic, 'sleep');
  assert.equal(result.instructions[4].mnemonic, 'wdr');
});

test('AvrDisassemblerAdapter decodes RJMP and RCALL with relative target address', async () => {
  const adapter = new AvrDisassemblerAdapter();
  // RJMP +2 (PC+1+2 = PC+3, word address 0+1+2 = 3 => byte address 6)
  // RJMP opcode: 1100 kkkk kkkk kkkk -> 0xC002 -> bytes: 0x02, 0xC0
  // RCALL +4 -> 0xD004 -> bytes: 0x04, 0xD0
  const bytes = new Uint8Array([
    0x02, 0xc0, // rjmp .+4 bytes (target word 3 = byte 0x0006)
    0x00, 0x00, // nop
    0x00, 0x00, // nop
    0x00, 0x00, // target instruction
    0x04, 0xd0, // rcall
  ]);

  const result = await adapter.disassemble({
    data: bytes,
    baseAddress: 0x0000,
    architecture: 'avr8',
  });

  assert.equal(result.success, true);
  const rjmp = result.instructions[0];
  assert.equal(rjmp.mnemonic, 'rjmp');
  assert.equal(rjmp.jumpTargetAddress, 0x0006);
  assert.equal(rjmp.isBranch, true);

  // Check target instruction is flagged as jump target
  const targetInst = result.instructions.find((i) => i.address === 0x0006);
  assert.ok(targetInst);
  assert.equal(targetInst.isJumpTarget, true);
});

test('AvrDisassemblerAdapter decodes LDI and OUT with hardware register annotation', async () => {
  const adapter = new AvrDisassemblerAdapter();
  // LDI r16, 0x5F -> 0xE50F -> bytes: 0x0F, 0xE5
  // OUT 0x05, r16 -> 0xB905 -> bytes: 0x05, 0xB9
  // IN r16, 0x03 -> 0xB103 -> bytes: 0x03, 0xB1
  const bytes = new Uint8Array([
    0x0f, 0xe5, // ldi r16, 0x5F
    0x05, 0xb9, // out 0x05, r16 (PORTB)
    0x03, 0xb1, // in r16, 0x03 (PINB)
  ]);

  const result = await adapter.disassemble({
    data: bytes,
    baseAddress: 0x0000,
    architecture: 'avr8',
  });

  assert.equal(result.success, true);
  assert.equal(result.totalInstructions, 3);

  const ldi = result.instructions[0];
  assert.equal(ldi.mnemonic, 'ldi');
  assert.equal(ldi.operands, 'r16, 0x5F');

  const out = result.instructions[1];
  assert.equal(out.mnemonic, 'out');
  assert.ok(out.operands.includes('0x05'));
  assert.ok(out.operands.includes('r16'));
  assert.equal(out.comment, 'write to PORTB');

  const inInst = result.instructions[2];
  assert.equal(inInst.mnemonic, 'in');
  assert.equal(inInst.comment, 'read PINB');
});

test('AvrDisassemblerAdapter decodes 32-bit instructions (JMP, CALL, LDS, STS)', async () => {
  const adapter = new AvrDisassemblerAdapter();
  // JMP 0x0034 (word 0x001A) -> 1001 010k kkkk 110k, kkkk kkkk kkkk kkkk
  // 0x940c, 0x001a -> bytes: 0x0C, 0x94, 0x1A, 0x00
  // CALL 0x0040 (word 0x0020) -> 0x940e, 0x0020 -> bytes: 0x0E, 0x94, 0x20, 0x00
  // LDS r16, 0x0100 -> 0x9100, 0x0100 -> bytes: 0x00, 0x91, 0x00, 0x01
  // STS 0x0100, r16 -> 0x9300, 0x0100 -> bytes: 0x00, 0x93, 0x00, 0x01
  const bytes = new Uint8Array([
    0x0c, 0x94, 0x1a, 0x00, // jmp 0x0034
    0x0e, 0x94, 0x20, 0x00, // call 0x0040
    0x00, 0x91, 0x00, 0x01, // lds r16, 0x0100
    0x00, 0x93, 0x00, 0x01, // sts 0x0100, r16
  ]);

  const result = await adapter.disassemble({
    data: bytes,
    baseAddress: 0x0000,
    architecture: 'avr8',
  });

  assert.equal(result.success, true);
  assert.equal(result.totalInstructions, 4);

  const jmp = result.instructions[0];
  assert.equal(jmp.mnemonic, 'jmp');
  assert.equal(jmp.jumpTargetAddress, 0x0034);
  assert.equal(jmp.rawBytesHex, '0C 94 1A 00');

  const call = result.instructions[1];
  assert.equal(call.mnemonic, 'call');
  assert.equal(call.jumpTargetAddress, 0x0040);
  assert.equal(call.isCall, true);

  const lds = result.instructions[2];
  assert.equal(lds.mnemonic, 'lds');
  assert.equal(lds.operands, 'r16, 0x0100');

  const sts = result.instructions[3];
  assert.equal(sts.mnemonic, 'sts');
  assert.equal(sts.operands, '0x0100, r16');
});

test('AvrDisassemblerAdapter decodes branch instructions (BREQ, BRNE, etc.)', async () => {
  const adapter = new AvrDisassemblerAdapter();
  // BREQ +2 words (PC+1+2) -> 1111 00kk kkkk k001 -> 0xF011 -> bytes: 0x11, 0xF0
  // BRNE -1 word -> 0xF7F1 -> bytes: 0xF1, 0xF7
  const bytes = new Uint8Array([
    0x11, 0xf0, // breq
    0x00, 0x00, // nop
  ]);

  const result = await adapter.disassemble({
    data: bytes,
    baseAddress: 0x0000,
    architecture: 'avr8',
  });

  assert.equal(result.success, true);
  const breq = result.instructions[0];
  assert.equal(breq.mnemonic, 'breq');
  assert.equal(breq.isBranch, true);
  assert.ok(breq.jumpTargetAddress !== undefined);
});

test('AvrDisassemblerAdapter handles undecodable opcodes and unwritten flash padding (0xFF)', async () => {
  const adapter = new AvrDisassemblerAdapter();
  // 0xFFFF is unprogrammed flash cell
  const bytes = new Uint8Array([
    0xff, 0xff, // erased cell
    0xfe, 0xff, // invalid opcode
  ]);

  const result = await adapter.disassemble({
    data: bytes,
    baseAddress: 0x0000,
    architecture: 'avr8',
  });

  assert.equal(result.success, true);
  assert.equal(result.totalInstructions, 2);
  assert.equal(result.undecodableCount, 2);

  const erased = result.instructions[0];
  assert.equal(erased.mnemonic, '.word');
  assert.equal(erased.isDecodable, false);
  assert.ok(erased.comment?.includes('unprogrammed Flash'));
});
