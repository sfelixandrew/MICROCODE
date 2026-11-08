/**
 * Core device identification domain models for MICROCODE INSPECTOR.
 */

export type TargetChipFamily = 'ESP32' | 'AVR_ATMEGA';

export type ChipArchitecture = 
  | 'xtensa-lx6'   // Classic ESP32
  | 'xtensa-lx7'   // ESP32-S3
  | 'riscv32'     // ESP32-C3, ESP32-C6
  | 'avr8'        // ATmega328P
  | 'unknown';

export interface SecurityFeatures {
  flashEncryption: 'disabled' | 'enabled' | 'unknown';
  secureBoot: 'disabled' | 'enabled' | 'unknown';
  flashCryptCount?: number;
  secureDownloadMode?: boolean;
  lockBitsHex?: string;
  signatureBytesHex?: string;
}

export interface DeviceIdentity {
  family: TargetChipFamily;
  model: string;                      // e.g. "ESP32 (revision v3.0)", "ATmega328P"
  architecture: ChipArchitecture;
  macAddress?: string;
  crystalFreqMHz?: number;
  chipRevision?: string;
  detectedFlashBytes: number | null;  // null if detection failed or unsupported
  flashCapacityLabel: string;         // e.g. "4 MB (detected)", "Unknown (manual selection required)"
  securityFeatures: SecurityFeatures;
  rawChipId?: number;
}

