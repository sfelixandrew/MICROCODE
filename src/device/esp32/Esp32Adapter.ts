import { ESPLoader, Transport } from 'esptool-js';
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
  TargetArchitecture,
} from '../types.ts';
import { ConnectionStateMachine } from '../ConnectionStateMachine.ts';
import { DeviceError } from '../DeviceError.ts';
import { detectBrowserCapabilities } from '../capabilities.ts';

export const MANUAL_BOOT_GUIDANCE =
  'Automatic bootloader entry timed out. To enter ROM bootloader manually:\n' +
  '1. Press and hold the BOOT (IO0) button on your ESP32 board.\n' +
  '2. Press and release the EN (RST) button once.\n' +
  '3. Release the BOOT button.\n' +
  '4. Click "Connect Serial Device" again.';

export function mapChipNameToArchitecture(chipName: string): TargetArchitecture {
  const norm = chipName.toUpperCase();
  if (norm.includes('ESP32-S2') || norm.includes('ESP32-S3')) {
    return 'xtensa-lx7';
  }
  if (norm.includes('ESP32-C') || norm.includes('ESP32-H')) {
    return 'riscv32';
  }
  if (norm.includes('ESP32')) {
    return 'xtensa-lx6';
  }
  return 'unknown';
}

export type DiagnosticLogger = (message: string, level?: 'info' | 'warn' | 'error') => void;

export interface Esp32AdapterOptions {
  baudRate?: number;
  romBaudRate?: number;
  logger?: DiagnosticLogger;
  portRequestFn?: () => Promise<any>;
  // Factory injection for testing without physical Web Serial
  loaderFactory?: (port: any, baud: number, logger?: DiagnosticLogger) => Promise<any>;
}

export class Esp32Adapter implements DeviceAdapter {
  readonly id = 'esp32-webserial';
  readonly displayName = 'ESP32 (Web Serial / esptool-js)';

  private readonly _stateMachine = new ConnectionStateMachine();
  private readonly _errorListeners = new Set<ErrorCallback>();
  private _connection: DeviceConnection | null = null;
  private _identity: DeviceIdentity | null = null;
  private _port: any = null;
  private _transport: any = null;
  private _loader: any = null;
  private _isDisconnecting = false;

  private readonly baudRate: number;
  private readonly romBaudRate: number;
  private readonly logger?: DiagnosticLogger;
  private readonly portRequestFn?: () => Promise<any>;
  private readonly loaderFactory?: (port: any, baud: number, logger?: DiagnosticLogger) => Promise<any>;

  constructor(options: Esp32AdapterOptions = {}) {
    this.baudRate = options.baudRate ?? 115200;
    this.romBaudRate = options.romBaudRate ?? 115200;
    this.logger = options.logger;
    this.portRequestFn = options.portRequestFn;
    this.loaderFactory = options.loaderFactory;
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

  private log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    // Sanitize: never log binary dumps or potential secret values
    if (message.includes('0x') && message.length > 256) {
      message = '[Truncated diagnostic buffer]';
    }
    if (this.logger) {
      this.logger(message, level);
    }
  }

  async requestPortAndConnect(): Promise<DeviceConnection> {
    if (this.state !== 'disconnected') {
      throw new DeviceError('ALREADY_CONNECTED', `Cannot connect: adapter is in state '${this.state}'.`);
    }

    // 1. Verify Browser Web Serial capability
    const caps = detectBrowserCapabilities();
    if (!caps.isSupported && !this.loaderFactory && !this.portRequestFn) {
      const err = new DeviceError(
        'UNSUPPORTED_BROWSER',
        caps.limitationReason || 'Web Serial API is not supported in this browser context.'
      );
      this.emitError(err);
      throw err;
    }

    // 2. User-initiated Port Picker
    this._stateMachine.transitionTo('requesting_permission');
    this.log('Prompting user for USB serial port selection...');

    try {
      if (this.portRequestFn) {
        this._port = await this.portRequestFn();
      } else if (this.loaderFactory) {
        // Mocked port for tests
        this._port = { name: 'MOCK_PORT' };
      } else {
        this._port = await (navigator as any).serial.requestPort();
      }
    } catch (err: any) {
      const isAbort = err.name === 'NotFoundError' || err.name === 'AbortError' || err.message?.includes('cancelled');
      const devErr = new DeviceError(
        'PERMISSION_DENIED',
        isAbort ? 'User cancelled USB serial port selection.' : `Serial permission denied: ${err.message}`,
        err
      );
      this.emitError(devErr);
      throw devErr;
    }

    if (this._isDisconnecting) {
      this._stateMachine.transitionTo('disconnected');
      throw new DeviceError('OPERATION_CANCELLED', 'Connection cancelled by user disconnect.');
    }

    // 3. Connect Transport & ESPLoader
    this._stateMachine.transitionTo('connecting');
    this.log(`Opening serial port at ${this.baudRate} baud...`);

    try {
      if (this.loaderFactory) {
        this._loader = await this.loaderFactory(this._port, this.baudRate, this.logger);
      } else {
        // Initialize official esptool-js Transport without packet tracing
        this._transport = new Transport(this._port, false);
        
        // Wrap terminal logging with clean/writeLine methods
        const terminal = {
          clean: () => {},
          writeLine: (data: string) => this.log(data.trim(), 'info'),
          write: (data: string) => {
            const cleanStr = data.trim();
            if (cleanStr) this.log(cleanStr, 'info');
          },
        };

        this._loader = new ESPLoader({
          transport: this._transport,
          baudrate: this.baudRate,
          romBaudrate: this.romBaudRate,
          terminal,
          debugLogging: false,
          enableTracing: false,
        });
      }

      this._connection = {
        connectionId: `esp32-${Date.now()}`,
        portName: this._port.getInfo ? `VID:0x${this._port.getInfo().usbVendorId?.toString(16)}` : 'USB-Serial Port',
        baudRate: this.baudRate,
        connectedAtIso: new Date().toISOString(),
        isExclusiveLocked: true,
      };

      this._stateMachine.transitionTo('connected');
      this.log('Serial port opened successfully. Ready for chip identification.');
      return this._connection;
    } catch (err: any) {
      const isBusy = err.message?.includes('already open') || err.message?.includes('locked') || err.name === 'InvalidStateError';
      const devErr = new DeviceError(
        isBusy ? 'PORT_BUSY' : 'CONNECTION_FAILED',
        isBusy
          ? 'Serial port is currently locked or in use by another program (e.g. Serial Monitor or Cura).'
          : `Failed to open serial transport: ${err.message}`,
        err
      );
      this.emitError(devErr);
      throw devErr;
    }
  }

  async identifyDevice(): Promise<DeviceIdentity> {
    if (this.state !== 'connected' || !this._loader) {
      throw new DeviceError('NOT_CONNECTED', `Cannot identify device: adapter is not connected (state: '${this.state}').`);
    }

    this._stateMachine.transitionTo('identifying');
    this.log('Connecting to ROM bootloader (sending DTR/RTS reset pulse)...');

    let chipName = 'Unknown';
    try {
      chipName = await this._loader.main();
      this.log(`Synchronized with ROM bootloader. Detected chip family: ${chipName}`);
    } catch (err: any) {
      const isTimeout = err.name === 'TimeoutError' || err.message?.includes('Timed out') || err.message?.includes('sync');
      const message = isTimeout
        ? `${MANUAL_BOOT_GUIDANCE}\n[Original error: ${err.message}]`
        : `ROM bootloader sync failed: ${err.message}`;

      const devErr = new DeviceError(
        isTimeout ? 'TIMEOUT' : 'IDENTIFICATION_FAILED',
        message,
        err
      );
      this.emitError(devErr);
      throw devErr;
    }

    const architecture = mapChipNameToArchitecture(chipName);
    if (architecture === 'unknown') {
      this.log(`Warning: Detected chip "${chipName}" is not a recognized ESP32 architecture variant.`, 'warn');
    }

    // Query detailed hardware metadata from loader.chip
    let model = chipName;
    let macAddress: string | undefined;
    let crystalFreqMHz: number | undefined;
    let siliconRevision: string | undefined;

    try {
      if (this._loader.chip) {
        if (typeof this._loader.chip.getChipDescription === 'function') {
          model = await this._loader.chip.getChipDescription(this._loader);
        }
        if (typeof this._loader.chip.readMac === 'function') {
          macAddress = await this._loader.chip.readMac(this._loader);
        }
        if (typeof this._loader.chip.getCrystalFreq === 'function') {
          crystalFreqMHz = await this._loader.chip.getCrystalFreq(this._loader);
        }
        if (typeof this._loader.chip.getChipRevision === 'function') {
          const revNum = await this._loader.chip.getChipRevision(this._loader);
          siliconRevision = revNum != null ? String(revNum) : undefined;
        }
      }
    } catch (err: any) {
      this.log(`Hardware descriptor query partially failed: ${err.message}`, 'warn');
    }

    // Query Flash capacity dynamically
    let totalFlashBytes: number | null = null;
    let flashLabel = 'Unknown (detection unmapped)';
    let rawFlashId: number | undefined;

    try {
      if (typeof this._loader.readFlashId === 'function') {
        rawFlashId = await this._loader.readFlashId();
      }
      if (typeof this._loader.detectFlashSize === 'function') {
        const detectedSizeStr = await this._loader.detectFlashSize();
        if (detectedSizeStr && typeof this._loader.flashSizeBytes === 'function') {
          totalFlashBytes = this._loader.flashSizeBytes(detectedSizeStr);
          flashLabel = `${detectedSizeStr} (${totalFlashBytes.toLocaleString('en-US')} bytes) [detected]`;
        }
      }
    } catch (err: any) {
      this.log(`SPI Flash capacity detection error: ${err.message}`, 'warn');
    }

    // Query Security Info (Flash Encryption & Secure Boot)
    let isEncrypted = false;
    try {
      if (typeof this._loader.getSecurityInfo === 'function') {
        const secInfo = await this._loader.getSecurityInfo();
        if (secInfo && secInfo.flashCryptCount > 0) {
          isEncrypted = true;
          this.log('Security Info: Hardware Flash Encryption is ENABLED on device.', 'warn');
        }
      }
    } catch {
      // getSecurityInfo is not supported on all early chips (e.g. classic ESP32 uses magic registers)
    }

    this._identity = {
      family: 'ESP32',
      model,
      architecture,
      flashInfo: {
        totalBytes: totalFlashBytes,
        label: flashLabel,
        isEncrypted,
        rawFlashId,
        isSimulated: false,
      },
      macAddress,
      siliconRevision,
      crystalFreqMHz,
      isSimulated: false,
    };

    this._stateMachine.transitionTo('connected');
    this.log(`Identification complete: ${model} | Arch: ${architecture} | Flash: ${flashLabel}`);
    return this._identity;
  }

  async readMemory(
    _request: MemoryReadRequest,
    _onProgress?: (progress: MemoryReadProgress) => void
  ): Promise<MemoryReadResult> {
    throw new DeviceError('READ_FAILED', 'Memory extraction engine is implemented in Stage 4/5. Read operations are deferred.');
  }

  async cancelOperation(): Promise<void> {
    this._isDisconnecting = true;
    if (this._stateMachine.state === 'connecting' || this._stateMachine.state === 'identifying') {
      await this.disconnect();
    }
  }

  async disconnect(): Promise<DisconnectResult> {
    this._isDisconnecting = true;
    if (this.state === 'disconnected') {
      return { success: true, message: 'Already disconnected.', cleanedUp: true };
    }

    this._stateMachine.transitionTo('disconnecting');
    this.log('Disconnecting from ESP32: triggering safe reset into normal boot...');

    let cleanedUp = true;
    try {
      // Safe reset to normal user boot so board resumes normal execution
      if (this._loader && typeof this._loader.after === 'function') {
        try {
          await this._loader.after('hard_reset');
        } catch {}
      }

      if (this._transport && typeof this._transport.disconnect === 'function') {
        await this._transport.disconnect();
      } else if (this._port && typeof this._port.close === 'function') {
        await this._port.close();
      }
    } catch (err: any) {
      cleanedUp = false;
      this.log(`Error during serial disconnect cleanup: ${err.message}`, 'warn');
    } finally {
      this._loader = null;
      this._transport = null;
      this._port = null;
      this._connection = null;
      this._identity = null;
      this._isDisconnecting = false;
      this._stateMachine.transitionTo('disconnected');
      this.log('Serial port closed and exclusive lock released.');
    }

    return {
      success: true,
      message: 'ESP32 disconnected and reset to normal boot mode.',
      cleanedUp,
    };
  }
}
