/**
 * Architecture-Specific Disassembly Types & Interfaces
 * MICROCODE INSPECTOR — STAGE 8
 *
 * Enforces modular architecture adapters. Generic monolithic disassemblers are prohibited.
 * Every output strictly records architecture, backend tool/version, load-address basis, and limitations.
 */

import type { TargetArchitecture } from '../device/types.ts';

export interface DisassemblyInstruction {
  address: number; // Absolute Flash / Memory address (byte address)
  wordAddress?: number; // Word address (e.g. PC for AVR)
  rawBytesHex: string; // Hex representation of opcode bytes
  mnemonic: string; // e.g. 'rjmp', 'ldi', 'out', 'jmp', '.word', '.byte'
  operands: string; // e.g. 'r16, 0x5F', '0x0034'
  comment?: string; // e.g. 'PORTB', 'target: 0x0068', 'UNDECODABLE'
  isJumpTarget?: boolean;
  isBranch?: boolean;
  isReturn?: boolean;
  isCall?: boolean;
  jumpTargetAddress?: number;
  isDecodable: boolean;
}

export interface DisassemblyRequest {
  data: Uint8Array;
  baseAddress: number; // Address basis (e.g. 0x0000 for AVR, 0x40080000 for IRAM)
  architecture: TargetArchitecture;
  offset?: number; // Byte offset into data to start disassembling
  length?: number; // Number of bytes to disassemble
  mcuModel?: string; // e.g. 'ATmega328P', 'ESP32'
}

export interface DisassemblyResult {
  success: boolean;
  architecture: TargetArchitecture;
  backendName: string;
  backendVersion: string;
  baseAddress: number;
  totalInstructions: number;
  undecodableCount: number;
  instructions: DisassemblyInstruction[];
  confidence: 'verified' | 'high' | 'medium' | 'heuristic' | 'unsupported';
  confidenceReason: string;
  addressBasisExplanation: string;
  limitations: string[];
  warnings: string[];
  errors: string[];
}

export interface ArchitectureDisassembler {
  readonly architecture: TargetArchitecture;
  readonly displayName: string;
  readonly isSupported: boolean;
  readonly backendName: string;
  readonly backendVersion: string;

  getLimitations(): string[];
  disassemble(request: DisassemblyRequest): Promise<DisassemblyResult>;
}

