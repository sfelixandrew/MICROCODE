/**
 * Unit Tests for Peripheral Access Inferrer
 * MICROCODE INSPECTOR
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { PeripheralAccessInferrer } from '../../src/analysis/patterns/PeripheralAccessInferrer.ts';
import type { DisassemblyInstruction } from '../../src/disassembly/types.ts';

test('PeripheralAccessInferrer detects I/O register writes and separates facts from inferences', () => {
  const instructions: DisassemblyInstruction[] = [
    { address: 0x0010, rawBytesHex: '05 B9', mnemonic: 'out', operands: '0x05, r16', comment: 'PORTB', isDecodable: true },
    { address: 0x0012, rawBytesHex: '03 B1', mnemonic: 'in', operands: 'r16, 0x03', comment: 'PINB', isDecodable: true },
    { address: 0x0014, rawBytesHex: 'AC 9A', mnemonic: 'sbi', operands: '0x05, 5', comment: 'set bit 5 in PORTB', isDecodable: true },
    { address: 0x0016, rawBytesHex: 'AC 98', mnemonic: 'cbi', operands: '0x05, 5', comment: 'clear bit 5 in PORTB', isDecodable: true },
    { address: 0x0018, rawBytesHex: 'CE B9', mnemonic: 'out', operands: '0x2E, r16', comment: 'UDR0', isDecodable: true },
  ];

  const accesses = PeripheralAccessInferrer.inferAccesses(instructions, 'avr8');

  assert.equal(accesses.length, 5);

  // Access 0: PORTB write
  assert.equal(accesses[0].registerName, 'PORTB');
  assert.equal(accesses[0].accessType, 'write');
  assert.ok(accesses[0].confirmedFact.includes('writes to I/O register 0x05'));
  assert.ok(accesses[0].inferredMeaning.includes('Sets digital output states on Port B'));

  // Access 1: PINB read
  assert.equal(accesses[1].registerName, 'PINB');
  assert.equal(accesses[1].accessType, 'read');

  // Access 2: SBI PORTB, 5 (Uno LED ON)
  assert.equal(accesses[2].registerName, 'PORTB');
  assert.equal(accesses[2].bitIndex, 5);
  assert.equal(accesses[2].accessType, 'modify_bit_set');
  assert.ok(accesses[2].inferredMeaning.includes('LED_BUILTIN') || accesses[2].inferredMeaning.includes('onboard LED'));

  // Access 3: CBI PORTB, 5 (Uno LED OFF)
  assert.equal(accesses[3].registerName, 'PORTB');
  assert.equal(accesses[3].bitIndex, 5);
  assert.equal(accesses[3].accessType, 'modify_bit_clear');
  assert.ok(accesses[3].inferredMeaning.includes('turns OFF') || accesses[3].inferredMeaning.includes('LOW'));

  // Access 4: UDR0 Serial write
  assert.equal(accesses[4].registerName, 'UDR0');
  assert.equal(accesses[4].accessType, 'write');
  assert.ok(accesses[4].inferredMeaning.includes('Serial'));
});
