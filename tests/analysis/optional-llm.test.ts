/**
 * Unit Tests for Optional LLM Logic Explainer
 * MICROCODE INSPECTOR
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { FunctionBoundaryDetector } from '../../src/analysis/functions/FunctionBoundaryDetector.ts';
import { OptionalLlmExplainer } from '../../src/analysis/llm/OptionalLlmExplainer.ts';
import type { DisassemblyInstruction } from '../../src/disassembly/types.ts';

test('OptionalLlmExplainer requires explicit opt-in and defaults to disabled', async () => {
  const instructions: DisassemblyInstruction[] = [
    { address: 0x0000, rawBytesHex: '08 95', mnemonic: 'ret', operands: '', isReturn: true, isDecodable: true },
  ];
  const functions = FunctionBoundaryDetector.detectFunctions(instructions, 'avr8');

  // Attempt without opt-in
  const result = await OptionalLlmExplainer.explain(functions[0], {
    optInConfirmed: false,
    mode: 'local_only',
  });

  assert.equal(result.isOptedIn, false);
  assert.ok(result.warning?.includes('opted in'));
  assert.equal(result.isHypothesis, true);
});

test('OptionalLlmExplainer redacts secrets and passwords before transmission', () => {
  const dirtyText = 'wifi_password="superSecretPassword123" and api_key: "ak_live_998877665544332211" Bearer mySecretToken1234567890';
  const { redactedText, redactionCount } = OptionalLlmExplainer.redactCredentials(dirtyText);

  assert.ok(redactionCount >= 2);
  assert.ok(!redactedText.includes('superSecretPassword123'));
  assert.ok(!redactedText.includes('ak_live_998877665544332211'));
  assert.ok(!redactedText.includes('mySecretToken1234567890'));
  assert.ok(redactedText.includes('[REDACTED_CREDENTIAL]'));
});

test('OptionalLlmExplainer local mode generates hypothesis without network calls', async () => {
  const instructions: DisassemblyInstruction[] = [
    { address: 0x0020, rawBytesHex: '05 B9', mnemonic: 'out', operands: '0x05, r16', comment: 'PORTB', isDecodable: true },
    { address: 0x0022, rawBytesHex: '08 95', mnemonic: 'ret', operands: '', isReturn: true, isDecodable: true },
  ];
  const functions = FunctionBoundaryDetector.detectFunctions(instructions, 'avr8');

  const result = await OptionalLlmExplainer.explain(functions[0], {
    optInConfirmed: true,
    mode: 'local_only',
  });

  assert.equal(result.isOptedIn, true);
  assert.ok(result.provider.includes('Local-Only'));
  assert.equal(result.isHypothesis, true);
  assert.ok(result.explanationText.includes('Reconstructed Logic Hypothesis'));
  assert.ok(result.hypothesisNotice.includes('UNVERIFIED AI HYPOTHESIS'));
});

