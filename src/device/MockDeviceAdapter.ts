import type {
  DeviceAdapter,
  DeviceConnection,
  DeviceIdentity,
  MemoryReadRequest,
  MemoryReadProgress,
  MemoryReadResult,
  DisconnectResult,
  ConnectionState,
  StateChangeCallback,
  ErrorCallback,
} from './types.ts';
import { ConnectionStateMachine } from './ConnectionStateMachine.ts';
import { DeviceError } from './DeviceError.ts';

export interface MockAdapterOptions {
  shouldDenyPermission?: boolean;
  shouldFailPortBusy?: boolean;
  shouldFailIdentification?: boolean;
  shouldFailRead?: boolean;
  mockIdentity?: DeviceIdentity;
  latencyMs?: number;
}

export class MockDeviceAdapter implements DeviceAdapter {
  readonly id: string = 'mock-adapter';
  readonly displayName: string = 'Mock Hardware Test Adapter';

  private readonly _stateMachine = new ConnectionStateMachine();
  private readonly _errorListeners = new Set<ErrorCallback>();
  private _connection: DeviceConnection | null = null;
  private _identity: DeviceIdentity | null = null;
  private _activeAbortController: AbortController | null = null;

  private readonly options: MockAdapterOptions;

  constructor(options: MockAdapterOptions = {}) {
    this.options = options;
  }

  get state(): ConnectionState {
    return this._stateMachine.state;
  }

  get connection(): DeviceConnection | null {
    return this._connection;
  }

  get identity(): DeviceIdentity | null {
    return this._identity;
  }

  onStateChange(callback: StateChangeCallback): () => void {
    return this._stateMachine.subscribe(callback);
  }

  onError(callback: ErrorCallback): () => void {
    this._errorListeners.add(callback);
    return () => {
      this._errorListeners.delete(callback);
    };
  }

  private emitError(error: DeviceError): void {
    this._stateMachine.transitionTo('error');
    for (const listener of this._errorListeners) {
      try {
        listener(error);
      } catch (err) {
        console.error('Error in error listener:', err);
      }
    }
  }

  async requestPortAndConnect(): Promise<DeviceConnection> {
    if (this.state !== 'disconnected') {
      throw new DeviceError('ALREADY_CONNECTED', `Cannot connect: adapter is already in state '${this.state}'.`);
    }

    // Step 1: Request permission (simulate port picker dialog)
    this._stateMachine.transitionTo('requesting_permission');
    await this.delay(this.options.latencyMs ?? 50);

    if (this.options.shouldDenyPermission) {
      const err = new DeviceError('PERMISSION_DENIED', 'User dismissed serial port selection dialog.');
      this.emitError(err);
      throw err;
    }

    // Step 2: Connecting
    this._stateMachine.transitionTo('connecting');
    await this.delay(this.options.latencyMs ?? 50);

    if (this.options.shouldFailPortBusy) {
      const err = new DeviceError('PORT_BUSY', 'Serial port is already in use by another application.');
      this.emitError(err);
      throw err;
    }

    this._connection = {
      connectionId: `conn-mock-${Date.now()}`,
      portName: 'MOCK_COM_PORT',
      baudRate: 115200,
      connectedAtIso: new Date().toISOString(),
      isExclusiveLocked: true,
    };

    this._stateMachine.transitionTo('connected');
    return this._connection;
  }

  async identifyDevice(): Promise<DeviceIdentity> {
    if (this.state !== 'connected') {
      throw new DeviceError('NOT_CONNECTED', `Cannot identify: adapter is not connected (state is '${this.state}').`);
    }

    this._stateMachine.transitionTo('identifying');
    await this.delay(this.options.latencyMs ?? 50);

    if (this.options.shouldFailIdentification) {
      const err = new DeviceError('IDENTIFICATION_FAILED', 'Could not establish synchronization with device ROM.');
      this.emitError(err);
      throw err;
    }

    this._identity = this.options.mockIdentity ?? {
      family: 'ESP32',
      model: 'ESP32 (revision v3.0) [MOCK TEST HARNESS]',
      architecture: 'xtensa-lx6',
      flashInfo: {
        totalBytes: 4194304,
        label: '4 MB (4,194,304 bytes) [SIMULATED]',
        isEncrypted: false,
        rawFlashId: 0x1640c8,
        isSimulated: true,
      },
      macAddress: '24:6F:28:AB:CD:EF',
      siliconRevision: '3',
      crystalFreqMHz: 40,
      isSimulated: true,
    };

    this._stateMachine.transitionTo('connected');
    return this._identity;
  }

  async readMemory(
    request: MemoryReadRequest,
    onProgress?: (progress: MemoryReadProgress) => void
  ): Promise<MemoryReadResult> {
    if (this.state !== 'connected') {
      throw new DeviceError('NOT_CONNECTED', `Cannot read memory: adapter is not in 'connected' state (state: '${this.state}').`);
    }

    if (request.lengthBytes <= 0) {
      throw new DeviceError('READ_FAILED', 'Requested read length must be greater than 0.');
    }

    this._stateMachine.transitionTo('reading');
    const startTime = Date.now();
    this._activeAbortController = new AbortController();

    const chunkSize = 1024;
    let bytesRead = 0;
    const buffer = new Uint8Array(request.lengthBytes);

    try {
      while (bytesRead < request.lengthBytes) {
        if (request.abortSignal?.aborted || this._activeAbortController.signal.aborted) {
          throw new DeviceError('OPERATION_CANCELLED', 'Memory read operation was cancelled by the user.');
        }

        if (this.options.shouldFailRead && bytesRead > 2048) {
          throw new DeviceError('READ_FAILED', 'Serial transmission timeout during block transfer.');
        }

        const chunkLen = Math.min(chunkSize, request.lengthBytes - bytesRead);
        // Fill simulated test pattern without exposing secrets
        for (let i = 0; i < chunkLen; i++) {
          buffer[bytesRead + i] = (bytesRead + i) % 256;
        }

        bytesRead += chunkLen;
        const currentAddress = request.startAddress + bytesRead;

        if (onProgress) {
          onProgress({
            currentAddress,
            startAddress: request.startAddress,
            totalBytes: request.lengthBytes,
            bytesRead,
            percentage: Math.round((bytesRead / request.lengthBytes) * 100),
          });
        }

        await this.delay(10);
      }

      this._stateMachine.transitionTo('connected');
      return {
        startAddress: request.startAddress,
        bytesRead,
        rawBytes: buffer,
        isSimulated: true,
        elapsedMs: Date.now() - startTime,
      };
    } catch (err) {
      this._stateMachine.transitionTo('error');
      if (DeviceError.isDeviceError(err)) {
        throw err;
      }
      throw new DeviceError('READ_FAILED', `Memory read failed: ${(err as Error).message}`, err);
    } finally {
      this._activeAbortController = null;
    }
  }

  async cancelOperation(): Promise<void> {
    if (this._activeAbortController) {
      this._activeAbortController.abort();
    }
  }

  async disconnect(): Promise<DisconnectResult> {
    if (this.state === 'disconnected') {
      return { success: true, message: 'Already disconnected.', cleanedUp: true };
    }

    this._stateMachine.transitionTo('disconnecting');
    await this.delay(this.options.latencyMs ?? 20);

    this._connection = null;
    this._identity = null;
    this._activeAbortController = null;
    this._stateMachine.transitionTo('disconnected');

    return {
      success: true,
      message: 'Device disconnected successfully and exclusive port lock released.',
      cleanedUp: true,
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
