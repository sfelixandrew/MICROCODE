import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ConnectionStateMachine } from '../../src/device/ConnectionStateMachine.ts';
import { MockDeviceAdapter } from '../../src/device/MockDeviceAdapter.ts';
import { DeviceError } from '../../src/device/DeviceError.ts';
import { detectBrowserCapabilities } from '../../src/device/capabilities.ts';

describe('Stage 3: Device Communication Framework', () => {
  describe('ConnectionStateMachine Lifecycle', () => {
    it('initializes in disconnected state', () => {
      const sm = new ConnectionStateMachine();
      assert.strictEqual(sm.state, 'disconnected');
      assert.strictEqual(sm.history.length, 1);
    });

    it('follows valid linear connection lifecycle: disconnected -> requesting_permission -> connecting -> connected', () => {
      const sm = new ConnectionStateMachine();
      const transitions: string[] = [];

      sm.subscribe((state, prev) => {
        transitions.push(`${prev}->${state}`);
      });

      sm.transitionTo('requesting_permission');
      assert.strictEqual(sm.state, 'requesting_permission');

      sm.transitionTo('connecting');
      assert.strictEqual(sm.state, 'connecting');

      sm.transitionTo('connected');
      assert.strictEqual(sm.state, 'connected');

      assert.deepStrictEqual(transitions, [
        'disconnected->requesting_permission',
        'requesting_permission->connecting',
        'connecting->connected',
      ]);
    });

    it('rejects duplicate connection attempt from already connected state', () => {
      const sm = new ConnectionStateMachine('connected');
      assert.throws(
        () => sm.transitionTo('requesting_permission'),
        (err: unknown) => {
          assert(err instanceof DeviceError);
          assert.strictEqual(err.code, 'ALREADY_CONNECTED');
          return true;
        }
      );
    });

    it('transitions to error from any non-disconnected state on failure', () => {
      const sm = new ConnectionStateMachine('connecting');
      sm.transitionTo('error');
      assert.strictEqual(sm.state, 'error');
    });

    it('supports clean disconnect transition and reset', () => {
      const sm = new ConnectionStateMachine('connected');
      sm.transitionTo('disconnecting');
      assert.strictEqual(sm.state, 'disconnecting');
      sm.transitionTo('disconnected');
      assert.strictEqual(sm.state, 'disconnected');
    });
  });

  describe('MockDeviceAdapter Operations', () => {
    it('connects and identifies device successfully under normal conditions', async () => {
      const adapter = new MockDeviceAdapter({ latencyMs: 5 });
      assert.strictEqual(adapter.state, 'disconnected');

      const conn = await adapter.requestPortAndConnect();
      assert.ok(conn.connectionId);
      assert.strictEqual(adapter.state, 'connected');
      assert.strictEqual(conn.baudRate, 115200);

      const identity = await adapter.identifyDevice();
      assert.strictEqual(identity.family, 'ESP32');
      assert.strictEqual(identity.architecture, 'xtensa-lx6');
      assert.strictEqual(identity.flashInfo.totalBytes, 4194304);
      assert.strictEqual(identity.isSimulated, true);
    });

    it('handles user rejected permission gracefully without unhandled exceptions', async () => {
      const adapter = new MockDeviceAdapter({ shouldDenyPermission: true, latencyMs: 5 });
      let caughtError: DeviceError | null = null;

      try {
        await adapter.requestPortAndConnect();
      } catch (err) {
        caughtError = err as DeviceError;
      }

      assert.ok(caughtError);
      assert.strictEqual(caughtError.code, 'PERMISSION_DENIED');
      assert.strictEqual(adapter.state, 'error');
    });

    it('handles port busy / locked by another application', async () => {
      const adapter = new MockDeviceAdapter({ shouldFailPortBusy: true, latencyMs: 5 });
      let caughtError: DeviceError | null = null;

      try {
        await adapter.requestPortAndConnect();
      } catch (err) {
        caughtError = err as DeviceError;
      }

      assert.ok(caughtError);
      assert.strictEqual(caughtError.code, 'PORT_BUSY');
      assert.strictEqual(adapter.state, 'error');
    });

    it('handles failed identification / synchronization timeout', async () => {
      const adapter = new MockDeviceAdapter({ shouldFailIdentification: true, latencyMs: 5 });
      await adapter.requestPortAndConnect();

      let caughtError: DeviceError | null = null;
      try {
        await adapter.identifyDevice();
      } catch (err) {
        caughtError = err as DeviceError;
      }

      assert.ok(caughtError);
      assert.strictEqual(caughtError.code, 'IDENTIFICATION_FAILED');
      assert.strictEqual(adapter.state, 'error');
    });

    it('simulates progressive memory read with progress updates', async () => {
      const adapter = new MockDeviceAdapter({ latencyMs: 5 });
      await adapter.requestPortAndConnect();
      await adapter.identifyDevice();

      const progressSnapshots: number[] = [];
      const result = await adapter.readMemory(
        { startAddress: 0x1000, lengthBytes: 4096 },
        (p) => progressSnapshots.push(p.percentage)
      );

      assert.strictEqual(result.bytesRead, 4096);
      assert.strictEqual(result.rawBytes.length, 4096);
      assert.strictEqual(adapter.state, 'connected');
      assert.ok(progressSnapshots.length > 0);
      assert.strictEqual(progressSnapshots[progressSnapshots.length - 1], 100);
    });

    it('supports operation cancellation via AbortController', async () => {
      const adapter = new MockDeviceAdapter({ latencyMs: 5 });
      await adapter.requestPortAndConnect();
      await adapter.identifyDevice();

      const controller = new AbortController();
      // Cancel after 15ms
      setTimeout(() => controller.abort(), 15);

      let caughtError: DeviceError | null = null;
      try {
        await adapter.readMemory({
          startAddress: 0x0,
          lengthBytes: 100000,
          abortSignal: controller.signal,
        });
      } catch (err) {
        caughtError = err as DeviceError;
      }

      assert.ok(caughtError);
      assert.strictEqual(caughtError.code, 'OPERATION_CANCELLED');
    });

    it('performs clean disconnect and releases locks', async () => {
      const adapter = new MockDeviceAdapter({ latencyMs: 5 });
      await adapter.requestPortAndConnect();
      assert.strictEqual(adapter.state, 'connected');

      const disc = await adapter.disconnect();
      assert.strictEqual(disc.success, true);
      assert.strictEqual(adapter.state, 'disconnected');
      assert.strictEqual(adapter.connection, null);
      assert.strictEqual(adapter.identity, null);
    });
  });

  describe('Browser Capabilities & Security Guard', () => {
    it('detects missing Web Serial in node test environment safely without throwing', () => {
      const report = detectBrowserCapabilities();
      assert.strictEqual(report.hasWebSerial, false);
      assert.strictEqual(report.isSupported, false);
      assert.ok(report.limitationReason);
    });
  });
});
