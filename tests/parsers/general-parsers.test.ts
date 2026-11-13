import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SignatureDetector } from '../../src/parsers/general/signatureDetector.ts';
import { StringExtractor } from '../../src/parsers/general/stringExtractor.ts';
import { EntropyAnalyzer } from '../../src/parsers/general/entropyAnalyzer.ts';

describe('Stage 7: General Parsers (Signatures, Strings & Entropy)', () => {
  describe('SignatureDetector', () => {
    test('detects Intel HEX ASCII stream signature', () => {
      const hexData = new TextEncoder().encode(':040000000C94340028\n:00000001FF\n');
      const sigs = SignatureDetector.detectSignatures(hexData);
      assert.ok(sigs.some((s) => s.format === 'intel_hex'));
    });

    test('detects ELF executable header signature', () => {
      const elfData = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x01, 0x01, 0x01, 0x00]);
      const sigs = SignatureDetector.detectSignatures(elfData);
      assert.ok(sigs.some((s) => s.format === 'elf'));
    });

    test('detects ESP image header and partition table magic at standard offsets', () => {
      const buf = new Uint8Array(0x10000);
      // Put ESP image at 0x1000
      buf[0x1000] = 0xe9;
      buf[0x1001] = 0x03; // 3 segments
      // Put Partition Table at 0x8000
      buf[0x8000] = 0xaa;
      buf[0x8001] = 0x50;

      const sigs = SignatureDetector.detectSignatures(buf);
      assert.ok(sigs.some((s) => s.format === 'esp_image' && s.offset === 0x1000));
      assert.ok(sigs.some((s) => s.format === 'esp_partition_table' && s.offset === 0x8000));
    });

    test('detects AVR JMP reset vector', () => {
      const avrBuf = new Uint8Array([0x0c, 0x94, 0x34, 0x00]);
      const sigs = SignatureDetector.detectSignatures(avrBuf);
      assert.ok(sigs.some((s) => s.name.includes('AVR Reset Vector')));
    });
  });

  describe('StringExtractor', () => {
    test('extracts printable ASCII and UTF-8 strings with offsets and encodings', () => {
      const buf = new Uint8Array(256);
      buf.fill(0x00);

      // Embed ASCII string at offset 16: "MicroCode_Inspector"
      const asciiBytes = new TextEncoder().encode('MicroCode_Inspector');
      buf.set(asciiBytes, 16);

      // Embed UTF-8 string at offset 64: "ESP32_µC_Firmware"
      const utf8Bytes = new TextEncoder().encode('ESP32_µC_Firmware');
      buf.set(utf8Bytes, 64);

      const strings = StringExtractor.extractStrings(buf, { minLength: 4 });

      assert.ok(strings.length >= 2);

      const s1 = strings.find((s) => s.value === 'MicroCode_Inspector');
      assert.ok(s1);
      assert.equal(s1.offset, 16);
      assert.equal(s1.encoding, 'ASCII');

      const s2 = strings.find((s) => s.value === 'ESP32_µC_Firmware');
      assert.ok(s2);
      assert.equal(s2.offset, 64);
      assert.equal(s2.encoding, 'UTF-8');
    });

    test('ignores noise shorter than minLength', () => {
      const buf = new Uint8Array([0x00, 0x41, 0x42, 0x00]); // "AB" (length 2)
      const strings = StringExtractor.extractStrings(buf, { minLength: 4 });
      assert.equal(strings.length, 0);
    });
  });

  describe('EntropyAnalyzer', () => {
    test('calculates near-zero entropy for erased padding', () => {
      const erased = new Uint8Array(1024);
      erased.fill(0xff);

      const report = EntropyAnalyzer.analyzeBuffer(erased);
      assert.equal(report.overallEntropy, 0.0);
      assert.equal(report.chunks[0].classification, 'padding_erased');
      assert.ok(report.heuristicNotice.includes('statistical heuristic only'));
    });

    test('calculates moderate entropy for code / text', () => {
      const text = new TextEncoder().encode('The quick brown fox jumps over the lazy dog. '.repeat(20));
      const report = EntropyAnalyzer.analyzeBuffer(text);

      assert.ok(report.overallEntropy >= 3.5 && report.overallEntropy <= 5.5);
      assert.equal(report.chunks[0].classification, 'plaintext');
    });

    test('calculates high entropy for pseudo-random / encrypted buffer', () => {
      const randomBuf = new Uint8Array(2048);
      // Use crypto random values
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        crypto.getRandomValues(randomBuf);
      } else {
        for (let i = 0; i < randomBuf.length; i++) randomBuf[i] = (i * 1664525 + 1013904223) & 0xff;
      }

      const report = EntropyAnalyzer.analyzeBuffer(randomBuf);
      assert.ok(report.overallEntropy >= 7.2);
      assert.equal(report.chunks[0].classification, 'compressed_or_encrypted');
    });
  });
});
