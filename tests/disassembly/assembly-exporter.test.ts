/**
 * Unit Tests for Assembly Exporter
 * MICROCODE INSPECTOR — STAGE 8
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { formatAssemblyListing } from '../../src/disassembly/exporters/assemblyExporter.ts';
import type { DisassemblyResult } from '../../src/disassembly/types.ts';

test('formatAssemblyListing produces complete formatted header with provenance and limitations', () => {
  const mockResult: DisassemblyResult = {
    success: true,
    architecture: 'avr8',
    backendName: 'Microcode Inspector Native AVR Decoder',
    backendVersion: '1.0.0',
    baseAddress: 0x0000,
    totalInstructions: 2,
    undecodableCount: 0,
    confidence: 'verified',
    confidenceReason: 'Decoded instruction opcodes directly from AVR ISA.',
    addressBasisExplanation: 'Flash word-address aligned.',
    limitations: [
      'Original comments and C variable names are permanently lost in compilation.',
      'Assembly is the ground truth.',
    ],
    warnings: ['Bootloader boundary heuristic.'],
    errors: [],
    instructions: [
      {
        address: 0x0000,
        wordAddress: 0x0000,
        rawBytesHex: '0C 94 1A 00',
        mnemonic: 'jmp',
        operands: '0x0034',
        comment: 'jump target: 0x0034',
        isBranch: true,
        jumpTargetAddress: 0x0034,
        isDecodable: true,
      },
      {
        address: 0x0034,
        wordAddress: 0x001a,
        rawBytesHex: '08 95',
        mnemonic: 'ret',
        operands: '',
        isReturn: true,
        isJumpTarget: true,
        isDecodable: true,
      },
    ],
  };

  const output = formatAssemblyListing(mockResult, {
    sourceFileName: 'blink.hex',
    mcuModel: 'ATmega328P',
    sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  });

  assert.ok(output.includes('MICROCODE INSPECTOR — DISASSEMBLY LISTING'));
  assert.ok(output.includes('blink.hex'));
  assert.ok(output.includes('ATmega328P'));
  assert.ok(output.includes('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'));
  assert.ok(output.includes('Target Architecture: avr8'));
  assert.ok(output.includes('Disassembly Confidence: VERIFIED'));
  assert.ok(output.includes('Original comments and C variable names are permanently lost'));
  assert.ok(output.includes('Bootloader boundary heuristic'));

  // Instruction formatting
  assert.ok(output.includes('0x000000'));
  assert.ok(output.includes('0C 94 1A 00'));
  assert.ok(output.includes('jmp'));
  assert.ok(output.includes('0x0034'));
  assert.ok(output.includes('->ret')); // Jump target indicator
  assert.ok(output.includes('--- END OF DISASSEMBLY ---'));
});

test('formatAssemblyListing handles empty/unsupported results with error notices', () => {
  const unsupportedResult: DisassemblyResult = {
    success: false,
    architecture: 'xtensa-lx7',
    backendName: 'Unsupported',
    backendVersion: 'N/A',
    baseAddress: 0x42000000,
    totalInstructions: 0,
    undecodableCount: 0,
    confidence: 'unsupported',
    confidenceReason: 'No backend available.',
    addressBasisExplanation: 'None',
    limitations: ['Toolchain required'],
    warnings: [],
    errors: ['Toolchain xtensa-esp32s3-elf-objdump required.'],
    instructions: [],
  };

  const output = formatAssemblyListing(unsupportedResult);
  assert.ok(output.includes('Disassembly Confidence: UNSUPPORTED'));
  assert.ok(output.includes('# Toolchain xtensa-esp32s3-elf-objdump required.'));
  assert.ok(output.includes('No decoded instructions available'));
});
