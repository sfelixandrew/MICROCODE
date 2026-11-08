import { DeviceIdentity } from './device';
import { MemoryRegion } from './memory';
import { ExtractionProgress, ExtractionResult } from './extraction';

export type DriverConnectionState = 
  | 'disconnected'
  | 'probing'
  | 'connected'
  | 'reading'
  | 'error';

export type DriverEvent = 
  | { type: 'state_change'; state: DriverConnectionState }
  | { type: 'log'; message: string; level: 'info' | 'warn' | 'error' }
  | { type: 'progress'; progress: ExtractionProgress };

export interface IDeviceDriver {
  readonly id: string;
  readonly displayName: string;
  readonly connectionState: DriverConnectionState;

  connect(portHint?: unknown): Promise<DeviceIdentity>;
  detectCapacity(): Promise<number>;
  getMemoryMap(): Promise<MemoryRegion[]>;
  readRegion(
    startAddress: number,
    sizeBytes: number,
    onProgress?: (progress: ExtractionProgress) => void
  ): Promise<Uint8Array>;
  resetToNormalBoot(): Promise<void>;
  disconnect(): Promise<void>;
}

