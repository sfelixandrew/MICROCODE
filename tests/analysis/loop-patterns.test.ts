/**
 * Unit Tests for Loop Pattern Detector
 * MICROCODE INSPECTOR
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlFlowGraphBuilder } from '../../src/analysis/cfg/ControlFlowGraphBuilder.ts';
import { LoopPatternDetector } from '../../src/analysis/patterns/LoopPatternDetector.ts';
import type { DisassemblyInstruction } from '../../src/disassembly/types.ts';

test('LoopPatternDetector identifies infinite loops', () => {
  const instructions: DisassemblyInstruction[] = [
    { address: 0x0100, rawBytesHex: '00 00', mnemonic: 'nop', operands: '', isJumpTarget: true, isDecodable: true },
    { address: 0x0102, rawBytesHex: 'FE CF', mnemonic: 'rjmp', operands: '.-2', isBranch: true, jumpTargetAddress: 0x0100, isDecodable: true },
  ];

  const cfg = ControlFlowGraphBuilder.buildGraph(instructions, 0x0100);
  const loops = LoopPatternDetector.detectLoops(cfg);

  assert.equal(loops.length, 1);
  assert.equal(loops[0].kind, 'infinite_loop');
  assert.equal(loops[0].headerAddress, 0x0100);
  assert.equal(loops[0].confidence, 'high');
});

test('LoopPatternDetector identifies counted loops with counter variables', () => {
  const instructions: DisassemblyInstruction[] = [
    { address: 0x0200, rawBytesHex: '8A E0', mnemonic: 'ldi', operands: 'r24, 0x0A', isDecodable: true },
    // Loop header
    { address: 0x0202, rawBytesHex: '00 00', mnemonic: 'nop', operands: '', isJumpTarget: true, isDecodable: true },
    { address: 0x0204, rawBytesHex: '8A 95', mnemonic: 'dec', operands: 'r24', isDecodable: true },
    { address: 0x0206, rawBytesHex: 'E9 F7', mnemonic: 'brne', operands: '.-6', isBranch: true, jumpTargetAddress: 0x0202, isDecodable: true },
    { address: 0x0208, rawBytesHex: '08 95', mnemonic: 'ret', operands: '', isReturn: true, isDecodable: true },
  ];

  const cfg = ControlFlowGraphBuilder.buildGraph(instructions, 0x0200);
  const loops = LoopPatternDetector.detectLoops(cfg);

  assert.equal(loops.length, 1);
  assert.equal(loops[0].kind, 'counted_loop');
  assert.equal(loops[0].headerAddress, 0x0202);
  assert.equal(loops[0].approximateIterationVariable, 'r24');
  assert.equal(loops[0].confidence, 'high');
});
