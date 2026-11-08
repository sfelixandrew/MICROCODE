import type { DeviceError as IDeviceError, DeviceErrorCode } from './types.ts';

export class DeviceError extends Error implements IDeviceError {
  readonly code: DeviceErrorCode;
  readonly originalError?: unknown;
  readonly timestamp: string;

  constructor(code: DeviceErrorCode, message: string, originalError?: unknown) {
    super(message);
    this.name = 'DeviceError';
    this.code = code;
    this.originalError = originalError;
    this.timestamp = new Date().toISOString();

    // Preserve prototype chain
    Object.setPrototypeOf(this, DeviceError.prototype);
  }

  static isDeviceError(err: unknown): err is DeviceError {
    return err instanceof Error && 'code' in err && 'timestamp' in err;
  }
}
