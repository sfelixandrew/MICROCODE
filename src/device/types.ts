/**
 * Device Communication Framework Type Definitions
 * MICROCODE INSPECTOR — STAGE 3
 */

export type ConnectionState = 
  | 'disconnected'
  | 'requesting_permission'
  | 'connecting'
  | 'connected'
  | 'identifying'
  | 'reading'
  | 'disconnecting'
  | 'error';

export type DeviceErrorCode =
  | 'UNSUPPORTED_BROWSER'
  | 'PERMISSION_DENIED'
  | 'PORT_BUSY'
  | 'DEVICE_NOT_FOUND'
  | 'ALREADY_CONNECTED'
  | 'NOT_CONNECTED'
  | 'CONNECTION_FAILED'
  | 'IDENTIFICATION_FAILED'
  | 'READ_FAILED'
  | 'TIMEOUT'
  | 'OPERATION_CANCELLED'
  | 'COMPANION_UNAVAILABLE'
  | 'AVRDUDE_NOT_FOUND'
  | 'BAD_SIGNATURE'
  | 'LOCK_PROTECTION_BLOCKED'
  | 'UNSUPPORTED_BOOTLOADER'
  | 'INTEGRITY_MISMATCH'
  | 'UNKNOWN_ERROR';

export interface DeviceError extends Error {
  readonly code: DeviceErrorCode;
  readonly originalError?: unknown;
  readonly timestamp: string;
}

export type TargetArchitecture =
  | 'xtensa-lx6'
  | 'xtensa-lx7'
  | 'riscv32'
  | 'avr8'
  | 'unknown';

export interface FlashInfo {
  readonly totalBytes: number | null;
  readonly label: string;
  readonly isEncrypted: boolean;
  readonly rawFlashId?: number;
  readonly isSimulated: boolean;
}

export interface DeviceIdentity {
  readonly family: 'ESP32' | 'AVR_ATMEGA';
  readonly model: string;
  readonly architecture: TargetArchitecture;
  readonly flashInfo: FlashInfo;
  readonly macAddress?: string;
  readonly siliconRevision?: string;
  readonly crystalFreqMHz?: number;
  readonly lockBitsHex?: string;
  readonly signatureHex?: string;
  readonly isSimulated: boolean;
}

export interface MemoryReadRequest {
  readonly startAddress: number;
  readonly lengthBytes: number;
  readonly abortSignal?: AbortSignal;
}

export interface MemoryReadProgress {
  readonly currentAddress: number;
  readonly startAddress: number;
  readonly totalBytes: number;
  readonly bytesRead: number;
  readonly percentage: number;
}

export interface MemoryReadResult {
  readonly startAddress: number;
  readonly bytesRead: number;
  readonly rawBytes: Uint8Array;
  readonly isSimulated: boolean;
  readonly elapsedMs: number;
}

export interface DisconnectResult {
  readonly success: boolean;
  readonly message: string;
  readonly cleanedUp: boolean;
}

export interface DeviceConnection {
  readonly connectionId: string;
  readonly portName?: string;
  readonly baudRate: number;
  readonly connectedAtIso: string;
  readonly isExclusiveLocked: boolean;
}

export type StateChangeCallback = (state: ConnectionState, previousState: ConnectionState) => void;
export type ErrorCallback = (error: DeviceError) => void;

export interface DeviceAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly state: ConnectionState;
  readonly connection: DeviceConnection | null;
  readonly identity: DeviceIdentity | null;

  onStateChange(callback: StateChangeCallback): () => void;
  onError(callback: ErrorCallback): () => void;

  requestPortAndConnect(): Promise<DeviceConnection>;
  identifyDevice(): Promise<DeviceIdentity>;
  readMemory(request: MemoryReadRequest, onProgress?: (progress: MemoryReadProgress) => void): Promise<MemoryReadResult>;
  disconnect(): Promise<DisconnectResult>;
  cancelOperation(): Promise<void>;
}

