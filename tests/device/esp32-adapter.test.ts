import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  Esp32Adapter,
  mapChipNameToArchitecture,
  MANUAL_BOOT_GUIDANCE,
} from '../../src/device/esp32/Esp32Adapter.ts';
import { DeviceError } from '../../src/device/DeviceError.ts';

describe('Stage 4: ESP32 Connection and Identification Adapter', () => {
  describe('Chip Architecture Mapping', () => {
    it('maps classic ESP32 variants to xtensa-lx6', () => {
      assert.strictEqual(mapChipNameToArchitecture('ESP32'), 'xtensa-lx6');
      assert.strictEqual(mapChipNameToArchitecture('ESP32-D0WDQ6'), 'xtensa-lx6');
    });

    it('maps ESP32-S2 and ESP32-S3 to xtensa-lx7', () => {
      assert.strictEqual(mapChipNameToArchitecture('ESP32-S2'), 'xtensa-lx7');
      assert.strictEqual(mapChipNameToArchitecture('ESP32-S3'), 'xtensa-lx7');
    });

    it('maps ESP32-C and ESP32-H series to riscv32', () => {
      assert.strictEqual(mapChipNameToArchitecture('ESP32-C3'), 'riscv32');
      assert.strictEqual(mapChipNameToArchitecture('ESP32-C6'), 'riscv32');
      assert.strictEqual(mapChipNameToArchitecture('ESP32-H2'), 'riscv32');
    });

    it('maps unrecognized chips to unknown', () => {
      assert.strictEqual(mapChipNameToArchitecture('STM32F401'), 'unknown');
      assert.strictEqual(mapChipNameToArchitecture('RP2040'), 'unknown');
    });
  });

  describe('Mocked ESPLoader Lifecycle Tests', () => {
    it('successfully connects, identifies chip, and detects Flash capacity', async () => {
      const logs: string[] = [];
      const mockLoader = {
        main: async () => 'ESP32',
        detectFlashSize: async () => '4MB',
        readFlashId: async () => 0x1640c8,
        flashSizeBytes: (size: string) => (size === '4MB' ? 4194304 : 0),
        getSecurityInfo: async () => ({ flashCryptCount: 0 }),
        after: async () => {},
        chip: {
          getChipDescription: async () => 'ESP32 (revision v3.0)',
          readMac: async () => '24:6f:28:ab:cd:ef',
          getCrystalFreq: async () => 40,
          getChipRevision: async () => 3,
        },
      };

      const adapter = new Esp32Adapter({
        loaderFactory: async () => mockLoader,
        logger: (msg) => logs.push(msg),
      });

      assert.strictEqual(adapter.state, 'disconnected');
      await adapter.requestPortAndConnect();
      assert.strictEqual(adapter.state, 'connected');

      const identity = await adapter.identifyDevice();
      assert.strictEqual(identity.family, 'ESP32');
      assert.strictEqual(identity.model, 'ESP32 (revision v3.0)');
      assert.strictEqual(identity.architecture, 'xtensa-lx6');
      assert.strictEqual(identity.macAddress, '24:6f:28:ab:cd:ef');
      assert.strictEqual(identity.crystalFreqMHz, 40);
      assert.strictEqual(identity.siliconRevision, '3');
      assert.strictEqual(identity.flashInfo.totalBytes, 4194304);
      assert.strictEqual(identity.flashInfo.isEncrypted, false);
      assert.strictEqual(identity.isSimulated, false);

      const disc = await adapter.disconnect();
      assert.strictEqual(disc.success, true);
      assert.strictEqual(adapter.state, 'disconnected');
      assert.ok(logs.some((l) => l.includes('Identification complete')));
    });

    it('fails gracefully when browser lacks Web Serial capability', async () => {
      // Without loaderFactory, detects runtime browser capability (missing in Node)
      const adapter = new Esp32Adapter();
      let caught: DeviceError | null = null;
      try {
        await adapter.requestPortAndConnect();
      } catch (err: any) {
        caught = err;
      }

      assert.ok(caught);
      assert.strictEqual(caught.code, 'UNSUPPORTED_BROWSER');
      assert.strictEqual(adapter.state, 'error');
    });

    it('handles serial permission denied on user port cancellation', async () => {
      const adapter = new Esp32Adapter({
        portRequestFn: async () => {
          const domErr = new Error('User cancelled port picker');
          domErr.name = 'NotFoundError';
          throw domErr;
        },
      });

      let caught: DeviceError | null = null;
      try {
        await adapter.requestPortAndConnect();
      } catch (err: any) {
        caught = err;
      }

      assert.ok(caught);
      assert.strictEqual(caught.code, 'PERMISSION_DENIED');
      assert.strictEqual(adapter.state, 'error');
    });

    it('handles chip identification timeout with manual BOOT/RESET button guidance', async () => {
      const mockLoader = {
        main: async () => {
          const err = new Error('Timed out waiting for packet response');
          err.name = 'TimeoutError';
          throw err;
        },
      };

      const adapter = new Esp32Adapter({
        loaderFactory: async () => mockLoader,
      });

      await adapter.requestPortAndConnect();
      assert.strictEqual(adapter.state, 'connected');

      let caught: DeviceError | null = null;
      try {
        await adapter.identifyDevice();
      } catch (err: any) {
        caught = err;
      }

      assert.ok(caught);
      assert.strictEqual(caught.code, 'TIMEOUT');
      assert.ok(caught.message.includes('BOOT (IO0) button'));
      assert.ok(caught.message.includes('EN (RST) button'));
      assert.strictEqual(adapter.state, 'error');
    });

    it('identifies unsupported or unexpected chip and flags unknown architecture', async () => {
      const mockLoader = {
        main: async () => 'UNKNOWN_CHIP_FAMILY',
        detectFlashSize: async () => undefined,
        readFlashId: async () => 0,
        chip: {
          getChipDescription: async () => 'Mystery Silicon v0',
        },
      };

      const adapter = new Esp32Adapter({
        loaderFactory: async () => mockLoader,
      });

      await adapter.requestPortAndConnect();
      const identity = await adapter.identifyDevice();

      assert.strictEqual(identity.architecture, 'unknown');
      assert.strictEqual(identity.model, 'Mystery Silicon v0');
      assert.strictEqual(identity.flashInfo.totalBytes, null);
    });

    it('handles clean disconnect while connected', async () => {
      let resetCalled = false;
      const mockLoader = {
        main: async () => 'ESP32',
        after: async (mode: string) => {
          if (mode === 'hard_reset') resetCalled = true;
        },
      };

      const adapter = new Esp32Adapter({
        loaderFactory: async () => mockLoader,
      });

      await adapter.requestPortAndConnect();
      assert.strictEqual(adapter.state, 'connected');

      const disc = await adapter.disconnect();
      assert.strictEqual(disc.success, true);
      assert.strictEqual(resetCalled, true);
      assert.strictEqual(adapter.state, 'disconnected');
      assert.strictEqual(adapter.connection, null);
      assert.strictEqual(adapter.identity, null);
    });
  });
});
