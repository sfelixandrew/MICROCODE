/**
 * Firmware Parser & Memory Map Type Definitions
 * MICROCODE INSPECTOR — STAGE 7
 *
 * All parsers operate 100% offline on saved firmware buffers / files.
 * Zero dependency on live hardware or USB serial drivers.
 */

import type { TargetArchitecture } from '../device/types.ts';
import type { MemoryRegionType } from '../types/memory.ts';

export type ConfidenceLevel = 'verified' | 'high' | 'medium' | 'heuristic' | 'unknown';

export interface ParserWarning {
  code: string;
  message: string;
  offset?: number;
  severity: 'info' | 'warning' | 'error';
}

export interface ParsedRegion {
  id: string;
  name: string;
  type: MemoryRegionType;
  offset: number;
  length: number;
  endOffset: number; // offset + length
  confidence: ConfidenceLevel;
  confidenceReason: string;
  source: string; // e.g. 'esp_partition_table', 'esp_image_header', 'avr_vector_table', 'intel_hex'
  parserVersion: string;
  flags?: number;
  isEncrypted?: boolean;
  warnings: string[];
  metadata?: Record<string, unknown>;
}

export type DetectedFormat =
  | 'esp_image'
  | 'esp_partition_table'
  | 'intel_hex'
  | 'raw_binary'
  | 'elf'
  | 'unknown';

export interface FileSignature {
  format: DetectedFormat;
  name: string;
  magicBytesHex: string;
  offset: number;
  description: string;
  confidence: ConfidenceLevel;
}

export interface ExtractedString {
  offset: number;
  length: number;
  value: string;
  encoding: 'ASCII' | 'UTF-8';
}

export interface EntropyChunk {
  offset: number;
  length: number;
  entropy: number; // 0.0 to 8.0
  classification: 'padding_erased' | 'low_density' | 'plaintext' | 'compressed_or_encrypted';
}

export interface OverlapRecord {
  regionA: string;
  regionB: string;
  start: number;
  end: number;
  length: number;
}

export interface UnmappedRange {
  offset: number;
  length: number;
  reason: string;
}

export interface MemoryMapReport {
  targetArchitecture: TargetArchitecture | 'unknown';
  detectedFormat: DetectedFormat;
  totalSize: number;
  signatures: FileSignature[];
  regions: ParsedRegion[];
  unmappedRanges: UnmappedRange[];
  overlaps: OverlapRecord[];
  warnings: ParserWarning[];
  strings: ExtractedString[];
  entropySummary: {
    overallEntropy: number;
    chunks: EntropyChunk[];
    heuristicNotice: string;
  };
  generatedAtIso: string;
  parserEngineVersion: string;
}
