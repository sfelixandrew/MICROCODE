/**
 * Unit Tests for Function Boundary Detector
 * MICROCODE INSPECTOR
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { FunctionBoundaryDetector } from '../../src/analysis/functions/FunctionBoundaryDetector.ts';
import type { DisassemblyInstruction } from '../../src/disassembly/types.ts';

test('FunctionBoundaryDetector detects entry points, assigns synthetic names, and computes confidence', () => {
  const instructions: DisassemblyInstruction[] = [
    // Reset Vector routine at 0x0000
    { address: 0x0000, rawBytesHex: '0C 94 1A 00', mnemonic: 'jmp', operands: '0x0034', isBranch: true, jumpTargetAddress: 0x0034, isDecodable: true },
    // Routine 1 at 0x0004
    { address: 0x0004, rawBytesHex: '0E 94 20 00', mnemonic: 'call', operands: '0x0040', isCall: true, jumpTargetAddress: 0x0040, isDecodable: true },
    { address: 0x0008, rawBytesHex: '08 95', mnemonic: 'ret', operands: '', isReturn: true, isDecodable: true },
    // Routine 2 at 0x0034 (Target of Reset Vector)
    { address: 0x0034, rawBytesHex: '0F E5', mnemonic: 'ldi', operands: 'r16, 0x5F', isJumpTarget: true, isDecodable: true },
    { address: 0x0036, rawBytesHex: '05 B9', mnemonic: 'out', operands: '0x05, r16', comment: 'PORTB', isDecodable: true },
    { address: 0x0038, rawBytesHex: '08 95', mnemonic: 'ret', operands: '', isReturn: true, isDecodable: true },
    // Routine 3 at 0x0040 (Target of CALL at 0x0004)
    { address: 0x0040, rawBytesHex: '00 00', mnemonic: 'nop', operands: '', isJumpTarget: true, isDecodable: true },
    { address: 0x0042, rawBytesHex: '08 95', mnemonic: 'ret', operands: '', isReturn: true, isDecodable: true },
  ];

  const functions = FunctionBoundaryDetector.detectFunctions(instructions, 'avr8');

  assert.ok(functions.length >= 3);

  // Check function names are strictly synthetic
  for (const fn of functions) {
    assert.match(fn.name, /^func_[0-9a-fA-F]{6,8}$/);
  }

  // Check Reset function (func_000000)
  const fnReset = functions.find((f) => f.entryAddress === 0x0000);
  assert.ok(fnReset);
  assert.equal(fnReset.name, 'func_000000');
  assert.ok(fnReset.confidenceScore >= 0.8);

  // Check Function at 0x0040 (called by 0x0004)
  const fnCalled = functions.find((f) => f.entryAddress === 0x0040);
  assert.ok(fnCalled);
  assert.equal(fnCalled.name, 'func_000040');
  assert.ok(fnCalled.callers.includes(0x0004));
  assert.ok(fnCalled.confidenceReasons.some((r) => r.includes('call instruction')));
});

test('FunctionBoundaryDetector flags undecodable ranges and adjusts confidence', () => {
  const instructions: DisassemblyInstruction[] = [
    { address: 0x0050, rawBytesHex: '00 00', mnemonic: 'nop', operands: '', isDecodable: true },
    { address: 0x0052, rawBytesHex: 'FF FF', mnemonic: '.word', operands: '0xFFFF', comment: 'Erased Flash', isDecodable: false },
    { address: 0x0054, rawBytesHex: '08 95', mnemonic: 'ret', operands: '', isReturn: true, isDecodable: true },
  ];

  const functions = FunctionBoundaryDetector.detectFunctions(instructions, 'avr8');
  assert.ok(functions.length >= 1);

  const fn = functions[0];
  assert.equal(fn.undecodableInstructionCount, 1);
  assert.ok(fn.confidenceReasons.some((r) => r.includes('undecodable')));
});
