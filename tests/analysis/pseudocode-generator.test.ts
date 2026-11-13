/**
 * Unit Tests for Pseudocode Generator
 * MICROCODE INSPECTOR
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { FunctionBoundaryDetector } from '../../src/analysis/functions/FunctionBoundaryDetector.ts';
import { PseudocodeGenerator } from '../../src/analysis/pseudocode/PseudocodeGenerator.ts';
import type { DisassemblyInstruction } from '../../src/disassembly/types.ts';

test('PseudocodeGenerator satisfies all non-negotiable transparency and labeling rules', () => {
  const instructions: DisassemblyInstruction[] = [
    { address: 0x0034, rawBytesHex: '0F E5', mnemonic: 'ldi', operands: 'r16, 0x5F', isDecodable: true },
    { address: 0x0036, rawBytesHex: '05 B9', mnemonic: 'out', operands: '0x05, r16', comment: 'PORTB', isDecodable: true },
    { address: 0x0038, rawBytesHex: 'AC 9A', mnemonic: 'sbi', operands: '0x05, 5', comment: 'set bit 5 in PORTB', isDecodable: true },
    { address: 0x003A, rawBytesHex: '08 95', mnemonic: 'ret', operands: '', isReturn: true, isDecodable: true },
  ];

  const functions = FunctionBoundaryDetector.detectFunctions(instructions, 'avr8');
  assert.ok(functions.length >= 1);

  const block = PseudocodeGenerator.generateBlock(functions[0], 'avr8');

  // Rule 1: Non-negotiable label
  assert.ok(
    block.label === 'approximate reconstruction' || block.label === 'inferred pseudocode'
  );
  assert.ok(block.pseudocodeText.includes('[APPROXIMATE RECONSTRUCTION / INFERRED PSEUDOCODE]'));

  // Rule 2: Synthetic naming (func_00001234, var_r16)
  assert.equal(block.functionName, 'func_000034');
  assert.ok(block.pseudocodeText.includes('void func_000034(void)'));
  assert.ok(block.pseudocodeText.includes('var_r16'));

  // Rule 3: Links back to assembly addresses
  assert.ok(block.pseudocodeText.includes('/* [0x000034] */'));
  assert.ok(block.pseudocodeText.includes('/* [0x000036] */'));
  assert.ok(block.traceMappings.some((m) => m.address === 0x0034));

  // Rule 4: Explicit missing information disclosure
  assert.ok(block.missingInformation.length >= 3);
  assert.ok(block.missingInformation.some((m) => m.includes('permanently lost')));

  // Rule 5: NO claim of exact original .ino source code
  assert.ok(block.pseudocodeText.includes('NOT the original .ino source'));
  assert.ok(!block.pseudocodeText.includes('Recovered original source code'));
});

test('PseudocodeGenerator preserves unknown and undecodable instruction segments', () => {
  const instructions: DisassemblyInstruction[] = [
    { address: 0x0060, rawBytesHex: '00 00', mnemonic: 'nop', operands: '', isDecodable: true },
    { address: 0x0062, rawBytesHex: 'FF FF', mnemonic: '.word', operands: '0xFFFF', comment: 'Erased Flash (0xFFFF)', isDecodable: false },
    { address: 0x0064, rawBytesHex: '08 95', mnemonic: 'ret', operands: '', isReturn: true, isDecodable: true },
  ];

  const functions = FunctionBoundaryDetector.detectFunctions(instructions, 'avr8');
  assert.ok(functions.length >= 1);

  const block = PseudocodeGenerator.generateBlock(functions[0], 'avr8');

  // Undecodable bytes must remain unknown
  assert.ok(block.pseudocodeText.includes('UNKNOWN / UNDECODABLE BYTES: .word 0xFFFF'));
  const undecodableMapping = block.traceMappings.find((m) => m.address === 0x0062);
  assert.ok(undecodableMapping);
  assert.ok(undecodableMapping.confirmedFact.includes('Undecodable opcode'));
});

