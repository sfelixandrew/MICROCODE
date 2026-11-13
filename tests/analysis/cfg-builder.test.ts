/**
 * Unit Tests for Control-Flow Graph & Basic Block Builder
 * MICROCODE INSPECTOR
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlFlowGraphBuilder } from '../../src/analysis/cfg/ControlFlowGraphBuilder.ts';
import type { DisassemblyInstruction } from '../../src/disassembly/types.ts';

test('ControlFlowGraphBuilder partitions linear instructions into basic blocks', () => {
  const instructions: DisassemblyInstruction[] = [
    { address: 0x0000, rawBytesHex: '0C 94 1A 00', mnemonic: 'jmp', operands: '0x0034', isBranch: true, jumpTargetAddress: 0x0034, isDecodable: true },
    { address: 0x0004, rawBytesHex: '00 00', mnemonic: 'nop', operands: '', isDecodable: true },
    { address: 0x0006, rawBytesHex: '08 95', mnemonic: 'ret', operands: '', isReturn: true, isDecodable: true },
    // Block starting at 0x0034
    { address: 0x0034, rawBytesHex: '0F E5', mnemonic: 'ldi', operands: 'r16, 0x5F', isJumpTarget: true, isDecodable: true },
    { address: 0x0036, rawBytesHex: '05 B9', mnemonic: 'out', operands: '0x05, r16', comment: 'PORTB', isDecodable: true },
    { address: 0x0038, rawBytesHex: '08 95', mnemonic: 'ret', operands: '', isReturn: true, isDecodable: true },
  ];

  const cfg = ControlFlowGraphBuilder.buildGraph(instructions, 0x0000);

  assert.equal(cfg.entryAddress, 0x0000);
  assert.ok(cfg.blocks.length >= 3);

  // Block 1: 0x0000
  const b0 = cfg.blocks.find((b) => b.startAddress === 0x0000);
  assert.ok(b0);
  assert.equal(b0.isEntryBlock, true);
  assert.equal(b0.terminatorType, 'jump_unconditional');
  assert.equal(b0.successorAddresses[0], 0x0034);

  // Target block: 0x0034
  const bTarget = cfg.blocks.find((b) => b.startAddress === 0x0034);
  assert.ok(bTarget);
  assert.equal(bTarget.terminatorType, 'return');
  assert.equal(bTarget.isExitBlock, true);
  assert.ok(bTarget.predecessorAddresses.includes(0x0000));
});

test('ControlFlowGraphBuilder handles conditional branches with true and false edges', () => {
  const instructions: DisassemblyInstruction[] = [
    { address: 0x0010, rawBytesHex: '11 F0', mnemonic: 'breq', operands: '.+4', isBranch: true, jumpTargetAddress: 0x0016, isDecodable: true },
    { address: 0x0012, rawBytesHex: '00 00', mnemonic: 'nop', operands: '', isDecodable: true },
    { address: 0x0014, rawBytesHex: '08 95', mnemonic: 'ret', operands: '', isReturn: true, isDecodable: true },
    { address: 0x0016, rawBytesHex: '08 95', mnemonic: 'ret', operands: '', isReturn: true, isJumpTarget: true, isDecodable: true },
  ];

  const cfg = ControlFlowGraphBuilder.buildGraph(instructions, 0x0010);

  const branchBlock = cfg.blocks.find((b) => b.startAddress === 0x0010);
  assert.ok(branchBlock);
  assert.equal(branchBlock.terminatorType, 'branch_conditional');
  assert.equal(branchBlock.branchCondition, 'breq');

  // Should have true edge to 0x0016 and false edge to 0x0012
  const trueEdge = cfg.edges.find((e) => e.type === 'conditional_true');
  const falseEdge = cfg.edges.find((e) => e.type === 'conditional_false');

  assert.ok(trueEdge);
  assert.equal(trueEdge.toAddress, 0x0016);
  assert.ok(falseEdge);
  assert.equal(falseEdge.toAddress, 0x0012);
});

test('ControlFlowGraphBuilder detects loops and cycles', () => {
  const instructions: DisassemblyInstruction[] = [
    { address: 0x0020, rawBytesHex: '00 00', mnemonic: 'nop', operands: '', isJumpTarget: true, isDecodable: true },
    { address: 0x0022, rawBytesHex: 'FE CF', mnemonic: 'rjmp', operands: '.-2', isBranch: true, jumpTargetAddress: 0x0020, isDecodable: true },
  ];

  const cfg = ControlFlowGraphBuilder.buildGraph(instructions, 0x0020);
  assert.equal(cfg.hasCycles, true);

  const loopEdge = cfg.edges.find((e) => e.toAddress <= e.fromAddress);
  assert.ok(loopEdge);
  assert.equal(loopEdge.toAddress, 0x0020);
});
