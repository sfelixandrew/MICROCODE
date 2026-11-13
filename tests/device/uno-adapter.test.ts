import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ArduinoUnoAdapter } from '../../src/device/uno/ArduinoUnoAdapter.ts';
import { computeSha256 } from '../../src/utils/crypto.ts';

// Helper to create a fake fetch response
function makeJsonResponse(data: any, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as Response);
}

describe('Stage 6: Arduino Uno R3 Companion Adapter', () => {
  describe('Companion Health & Connection Lifecycle', () => {
    test('successfully connects and queries health and ports from companion', async () => {
      const mockFetch: typeof fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/health')) {
          return makeJsonResponse({
            ok: true,
            avrdudeAvailable: true,
            version: 'avrdude version 7.3',
            path: '/usr/bin/avrdude',
          });
        }
        if (url.endsWith('/session')) {
          return makeJsonResponse({ sessionToken: 'mock-session-token-1234' });
        }
        if (url.endsWith('/ports')) {
          return makeJsonResponse({
            ports: [
              { port: 'COM3', description: 'Arduino Uno R3 (COM3)', hwid: 'USB VID:PID=2341:0043' },
            ],
          });
        }
        return Promise.reject(new Error(`Unhandled URL: ${url}`));
      };

      const adapter = new ArduinoUnoAdapter({
        fetchFn: mockFetch,
        targetPort: 'COM3',
      });

      assert.equal(adapter.state, 'disconnected');

      const conn = await adapter.requestPortAndConnect();
      assert.equal(conn.portName, 'COM3');
      assert.equal(conn.baudRate, 115200);
      assert.equal(adapter.state, 'connected');

      const identity = await adapter.identifyDevice();
      assert.equal(identity.family, 'AVR_ATMEGA');
      assert.equal(identity.architecture, 'avr8');
      assert.equal(identity.flashInfo.totalBytes, 32768);

      const disc = await adapter.disconnect();
      assert.equal(disc.success, true);
      assert.equal(adapter.state, 'disconnected');
    });

    test('fails gracefully when companion daemon is unreachable', async () => {
      const failingFetch: typeof fetch = () => Promise.reject(new Error('ECONNREFUSED'));

      const adapter = new ArduinoUnoAdapter({ fetchFn: failingFetch });

      await assert.rejects(
        async () => {
          await adapter.requestPortAndConnect('COM3');
        },
        {
          name: 'DeviceError',
          code: 'COMPANION_UNAVAILABLE',
        },
      );

      assert.equal(adapter.state, 'error');
    });

    test('fails gracefully when AVRDUDE is missing on host system', async () => {
      const mockFetch: typeof fetch = (input) => {
        const url = String(input);
        if (url.endsWith('/health')) {
          return makeJsonResponse({
            ok: false,
            avrdudeAvailable: false,
            message: 'AVRDUDE was not found on system PATH.',
          });
        }
        return Promise.reject(new Error(`Unhandled: ${url}`));
      };

      const adapter = new ArduinoUnoAdapter({ fetchFn: mockFetch });

      await assert.rejects(
        async () => {
          await adapter.requestPortAndConnect('COM3');
        },
        {
          name: 'DeviceError',
          code: 'AVRDUDE_NOT_FOUND',
        },
      );

      assert.equal(adapter.state, 'error');
    });
  });

  describe('Read-Only Flash Extraction & Verification', () => {
    test('successfully extracts 32 KiB Flash dump and verifies client-side SHA-256', async () => {
      // Create 32 KiB test payload (first 4 bytes code, rest 0xFF)
      const testBuffer = new Uint8Array(32768);
      testBuffer.fill(0xff);
      testBuffer[0] = 0x0c;
      testBuffer[1] = 0x94;
      testBuffer[2] = 0x34;
      testBuffer[3] = 0x00;

      const expectedSha256 = await computeSha256(testBuffer);
      const b64Data = Buffer.from(testBuffer).toString('base64');

      const mockFetch: typeof fetch = (input) => {
        const url = String(input);
        if (url.endsWith('/health')) {
          return makeJsonResponse({ ok: true, avrdudeAvailable: true });
        }
        if (url.endsWith('/session')) {
          return makeJsonResponse({ sessionToken: 'valid-token' });
        }
        if (url.endsWith('/ports')) {
          return makeJsonResponse({ ports: [{ port: 'COM3', description: 'Arduino Uno' }] });
        }
        if (url.endsWith('/read/uno')) {
          return makeJsonResponse({
            success: true,
            targetModel: 'Arduino Uno R3 (ATmega328P)',
            architecture: 'avr8',
            signature: '0x1E 0x95 0x0F',
            lockBits: '0x3F',
            totalBytes: 32768,
            explicitReadBytes: 4,
            erasedPaddingBytes: 32764,
            sha256: expectedSha256,
            base64: b64Data,
            hexRecords: ':040000000C94340028\n:00000001FF\n',
            isVerifiedExact: true,
            memoryLayout: {
              baseAddress: 0,
              endAddress: 32767,
              vectorsRange: [0, 52],
              applicationRange: [52, 32255],
              optibootRange: [32256, 32767],
            },
          });
        }
        return Promise.reject(new Error(`Unhandled URL: ${url}`));
      };

      const adapter = new ArduinoUnoAdapter({
        fetchFn: mockFetch,
        targetPort: 'COM3',
      });

      await adapter.requestPortAndConnect();

      const progressEvents: number[] = [];
      const result = await adapter.readMemory(
        { startAddress: 0, lengthBytes: 32768 },
        (p) => progressEvents.push(p.percentage),
      );

      assert.equal(result.bytesRead, 32768);
      assert.equal(result.rawBytes.length, 32768);
      assert.equal(result.rawBytes[0], 0x0c);
      assert.equal(result.rawBytes[1], 0x94);
      assert.equal(result.rawBytes[4], 0xff);
      assert.equal(result.rawBytes[32767], 0xff);

      // Verify cached exports
      const hex = adapter.getExtractedHex();
      assert.ok(hex && hex.includes(':040000000C94340028'));

      const metadata = adapter.getFlashExtractionMetadata();
      assert.ok(metadata);
      assert.equal(metadata.explicitReadBytes, 4);
      assert.equal(metadata.erasedPaddingBytes, 32764);
      assert.equal(metadata.sha256, expectedSha256);
      assert.equal(metadata.lockBits, '0x3F');

      assert.ok(progressEvents.includes(100));
    });

    test('detects cryptographic integrity mismatch if SHA-256 does not match', async () => {
      const testBuffer = new Uint8Array(32768);
      testBuffer.fill(0xaa);
      const b64Data = Buffer.from(testBuffer).toString('base64');

      const mockFetch: typeof fetch = (input) => {
        const url = String(input);
        if (url.endsWith('/health')) return makeJsonResponse({ ok: true, avrdudeAvailable: true });
        if (url.endsWith('/session')) return makeJsonResponse({ sessionToken: 'token' });
        if (url.endsWith('/read/uno')) {
          return makeJsonResponse({
            success: true,
            targetModel: 'Arduino Uno R3',
            architecture: 'avr8',
            signature: '0x1E 0x95 0x0F',
            lockBits: '0x3F',
            totalBytes: 32768,
            explicitReadBytes: 32768,
            erasedPaddingBytes: 0,
            sha256: '0000000000000000000000000000000000000000000000000000000000000000', // Forged hash
            base64: b64Data,
            hexRecords: '',
            isVerifiedExact: true,
          });
        }
        return Promise.reject(new Error(`Unhandled: ${url}`));
      };

      const adapter = new ArduinoUnoAdapter({ fetchFn: mockFetch, targetPort: 'COM3' });
      await adapter.requestPortAndConnect();

      await assert.rejects(
        async () => {
          await adapter.readMemory({ startAddress: 0, lengthBytes: 32768 });
        },
        {
          name: 'DeviceError',
          code: 'INTEGRITY_MISMATCH',
        },
      );
    });

    test('rejects Mode 3 lock-bit protected ATmega328P without chip erase', async () => {
      const mockFetch: typeof fetch = (input) => {
        const url = String(input);
        if (url.endsWith('/health')) return makeJsonResponse({ ok: true, avrdudeAvailable: true });
        if (url.endsWith('/session')) return makeJsonResponse({ sessionToken: 'token' });
        if (url.endsWith('/read/uno')) {
          return makeJsonResponse(
            {
              success: false,
              code: 'LOCK_PROTECTION_BLOCKED',
              message:
                'ATmega328P lock bits are configured in Mode 3 (read and verification disabled). Hardware security blocks readout. Chip erase is strictly prohibited.',
            },
            403,
          );
        }
        return Promise.reject(new Error(`Unhandled: ${url}`));
      };

      const adapter = new ArduinoUnoAdapter({ fetchFn: mockFetch, targetPort: 'COM3' });
      await adapter.requestPortAndConnect();

      await assert.rejects(
        async () => {
          await adapter.readMemory({ startAddress: 0, lengthBytes: 32768 });
        },
        {
          name: 'DeviceError',
          code: 'LOCK_PROTECTION_BLOCKED',
        },
      );
    });

    test('reports unsupported Optiboot bootloader build without STK_READ_PAGE', async () => {
      const mockFetch: typeof fetch = (input) => {
        const url = String(input);
        if (url.endsWith('/health')) return makeJsonResponse({ ok: true, avrdudeAvailable: true });
        if (url.endsWith('/session')) return makeJsonResponse({ sessionToken: 'token' });
        if (url.endsWith('/read/uno')) {
          return makeJsonResponse(
            {
              success: false,
              code: 'UNSUPPORTED_BOOTLOADER',
              message:
                'Bootloader rejected STK_READ_PAGE command. Readback unsupported by this bootloader build.',
            },
            400,
          );
        }
        return Promise.reject(new Error(`Unhandled: ${url}`));
      };

      const adapter = new ArduinoUnoAdapter({ fetchFn: mockFetch, targetPort: 'COM3' });
      await adapter.requestPortAndConnect();

      await assert.rejects(
        async () => {
          await adapter.readMemory({ startAddress: 0, lengthBytes: 32768 });
        },
        {
          name: 'DeviceError',
          code: 'UNSUPPORTED_BOOTLOADER',
        },
      );
    });

    test('supports user cancellation via AbortSignal', async () => {
      const abortController = new AbortController();

      const mockFetch: typeof fetch = (input, init) => {
        const url = String(input);
        if (url.endsWith('/health')) return makeJsonResponse({ ok: true, avrdudeAvailable: true });
        if (url.endsWith('/session')) return makeJsonResponse({ sessionToken: 'token' });
        if (url.endsWith('/read/uno')) {
          // Listen to the signal passed to fetch
          return new Promise((resolve, reject) => {
            const sig = init?.signal;
            if (sig) {
              sig.addEventListener('abort', () => {
                const err = new Error('The user aborted a request.');
                err.name = 'AbortError';
                reject(err);
              });
            }
          });
        }
        return Promise.reject(new Error(`Unhandled: ${url}`));
      };

      const adapter = new ArduinoUnoAdapter({ fetchFn: mockFetch, targetPort: 'COM3' });
      await adapter.requestPortAndConnect();

      const readPromise = adapter.readMemory({
        startAddress: 0,
        lengthBytes: 32768,
        abortSignal: abortController.signal,
      });

      // Trigger abort immediately
      setTimeout(() => abortController.abort(), 10);

      await assert.rejects(readPromise, {
        name: 'DeviceError',
        code: 'OPERATION_CANCELLED',
      });
    });
  });
});

