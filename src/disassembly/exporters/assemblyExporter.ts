/**
 * Disassembly Listing Exporter
 * MICROCODE INSPECTOR — STAGE 8
 *
 * Exports verified disassembly results to standard formatted assembly (.asm / .txt) files.
 * Includes complete provenance metadata, confidence level, address basis, and technical limitations.
 */

import type { DisassemblyResult } from '../types.ts';
import { formatHexAddress } from '../../utils/address.ts';

export interface AssemblyExportOptions {
  sourceFileName?: string;
  mcuModel?: string;
  sha256?: string;
}

export function formatAssemblyListing(
  result: DisassemblyResult,
  options: AssemblyExportOptions = {}
): string {
  const lines: string[] = [];

  // Header Banner
  lines.push('; ==============================================================================');
  lines.push('; MICROCODE INSPECTOR — DISASSEMBLY LISTING');
  lines.push('; ==============================================================================');
  lines.push(`; Generated: ${new Date().toISOString()}`);
  if (options.sourceFileName) {
    lines.push(`; Source File: ${options.sourceFileName}`);
  }
  if (options.mcuModel) {
    lines.push(`; Microcontroller Target: ${options.mcuModel}`);
  }
  if (options.sha256) {
    lines.push(`; Firmware SHA-256: ${options.sha256}`);
  }
  lines.push(`; Target Architecture: ${result.architecture}`);
  lines.push(`; Disassembly Backend: ${result.backendName} (${result.backendVersion})`);
  lines.push(`; Address Basis: ${formatHexAddress(result.baseAddress, 8)} (${result.addressBasisExplanation})`);
  lines.push(`; Disassembly Confidence: ${result.confidence.toUpperCase()}`);
  lines.push(`; Confidence Reason: ${result.confidenceReason}`);
  lines.push(`; Total Decoded Instructions: ${result.totalInstructions}`);
  lines.push(`; Undecodable / Raw Words: ${result.undecodableCount}`);
  lines.push(';');
  lines.push('; TECHNICAL LIMITATIONS & REVERSE-ENGINEERING REALITIES:');
  for (const lim of result.limitations) {
    lines.push(`;   * ${lim}`);
  }

  if (result.warnings.length > 0) {
    lines.push(';');
    lines.push('; WARNINGS:');
    for (const w of result.warnings) {
      lines.push(`;   ! ${w}`);
    }
  }

  if (result.errors.length > 0) {
    lines.push(';');
    lines.push('; ERRORS:');
    for (const e of result.errors) {
      lines.push(`;   # ${e}`);
    }
  }

  lines.push('; ==============================================================================');
  lines.push('');

  if (result.instructions.length === 0) {
    lines.push('; (No decoded instructions available. Check errors or backend support above.)');
    return lines.join('\n');
  }

  // Column header
  lines.push('; Address     Hex Bytes    Mnemonic     Operands                      Comment');
  lines.push('; ----------  -----------  -----------  ----------------------------  -----------------');

  for (const inst of result.instructions) {
    const addrCol = formatHexAddress(inst.address, 6).padEnd(12, ' ');
    const hexCol = inst.rawBytesHex.padEnd(11, ' ');
    const targetTag = inst.isJumpTarget ? '->' : '  ';
    const mnemonicCol = (targetTag + inst.mnemonic).padEnd(13, ' ');
    const operandsCol = inst.operands.padEnd(28, ' ');
    const comment = inst.comment ? `; ${inst.comment}` : '';

    lines.push(`${addrCol}  ${hexCol}  ${mnemonicCol}  ${operandsCol}  ${comment}`.trimEnd());
  }

  lines.push('');
  lines.push('; --- END OF DISASSEMBLY ---');
  return lines.join('\n');
}

/**
 * Browser-friendly download trigger for assembly export
 */
export function downloadAssemblyListing(
  result: DisassemblyResult,
  filename: string,
  options: AssemblyExportOptions = {}
): void {
  const content = formatAssemblyListing(result, options);
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
