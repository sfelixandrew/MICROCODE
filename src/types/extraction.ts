/**
 * Extraction status, progress, and verifiable dump models.
 */

export type ExtractionStatus = 
  | 'idle'
  | 'connecting'
  | 'detecting'
  | 'extracting'
  | 'verifying'
  | 'completed'
  | 'partial'
  | 'unsupported'
  | 'protected'
  | 'encrypted'
  | 'failed';

export interface ExtractionProgress {
  currentAddress: number;
  startAddress: number;
  totalBytes: number;
  bytesRead: number;
  percentage: number;
  currentRegionName?: string;
  speedBytesPerSec?: number;
}

export interface VerifiableDump {
  dumpId: string;
  timestampIso: string;
  targetFamily: string;
  targetModel: string;
  architecture: string;
  byteCount: number;
  sha256Hash: string;
  rawBytes: Uint8Array;
  isSimulatedMock: boolean;
  notes?: string;
}

export interface ExtractionResult {
  status: ExtractionStatus;
  dump: VerifiableDump | null;
  errorMessage?: string;
  warningMessage?: string;
  elapsedMs: number;
}

