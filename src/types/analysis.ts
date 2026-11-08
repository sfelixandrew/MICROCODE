import { AddressRange } from './memory';

export interface PartitionEntry {
  magic: number;             // Should be 0xAA50 for ESP-IDF
  type: number;              // 0x00 = App, 0x01 = Data
  typeLabel: string;
  subtype: number;
  subtypeLabel: string;
  offset: number;
  size: number;
  label: string;
  flags: number;
  isEncrypted: boolean;
}

export interface EspSegment {
  loadAddress: number;
  dataLength: number;
  segmentIndex: number;
}

export interface EspAppHeader {
  magic: number;             // 0xE9
  segmentCount: number;
  spiMode: string;
  spiSpeed: string;
  spiSize: string;
  entryPoint: number;
  segments: EspSegment[];
  hasSha256Digest: boolean;
  sha256DigestHex?: string;
}

export interface DisassemblyInstruction {
  address: number;
  rawBytesHex: string;
  mnemonic: string;
  operands: string;
  comment?: string;
  isJumpTarget?: boolean;
}

export interface PseudocodeBlock {
  blockId: string;
  range: AddressRange;
  functionName?: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  confidenceReason: string;
  syntheticCode: string;
  inferredRegisters: string[];
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  category: 'DEVICE' | 'EXTRACTION' | 'INTEGRITY' | 'PARSER' | 'SECURITY';
  message: string;
  details?: Record<string, unknown>;
}

