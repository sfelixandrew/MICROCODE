import React, { useState, useEffect, useRef } from 'react';
import {
  Shield,
  Cpu,
  HardDrive,
  Terminal,
  AlertTriangle,
  RefreshCw,
  PowerOff,
  Radio,
  Lock,
  Info,
  Sliders,
} from 'lucide-react';
import { MockDeviceAdapter } from './device/MockDeviceAdapter.ts';
import { Esp32Adapter, MANUAL_BOOT_GUIDANCE } from './device/esp32/Esp32Adapter.ts';
import { ConnectionState, DeviceIdentity, DeviceError, DeviceAdapter } from './device/types.ts';
import { detectBrowserCapabilities, BrowserCapabilityReport } from './device/capabilities.ts';
import { formatHexAddress, formatByteSize } from './utils/address.ts';

type AnalysisTab = 'overview' | 'memory_map' | 'hex_bin' | 'strings' | 'assembly' | 'pseudocode' | 'report';

export const App: React.FC = () => {
  // Device Communication State
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [deviceIdentity, setDeviceIdentity] = useState<DeviceIdentity | null>(null);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<'ESP32' | 'AVR_ATMEGA'>('ESP32');
  const [activeTab, setActiveTab] = useState<AnalysisTab>('overview');
  const [browserCaps, setBrowserCaps] = useState<BrowserCapabilityReport | null>(null);
  const [useLiveHardware, setUseLiveHardware] = useState<boolean>(true);
  const [baudRate, setBaudRate] = useState<number>(115200);

  const [logs, setLogs] = useState<Array<{ id: string; time: string; cat: string; msg: string }>>([
    { id: '1', time: new Date().toLocaleTimeString(), cat: 'SYSTEM', msg: 'MICROCODE INSPECTOR initialized in Stage 4 ESP32 Detection mode.' },
    { id: '2', time: new Date().toLocaleTimeString(), cat: 'SECURITY', msg: 'Strict Read-Only mode active. Zero write/erase APIs compiled.' },
  ]);

  const adapterRef = useRef<DeviceAdapter | null>(null);

  const addLog = (cat: string, msg: string) => {
    setLogs((prev) => [
      ...prev,
      { id: String(Date.now() + Math.random()), time: new Date().toLocaleTimeString(), cat, msg },
    ]);
  };

  // Check browser capabilities on mount
  useEffect(() => {
    const caps = detectBrowserCapabilities();
    setBrowserCaps(caps);
    if (!caps.hasWebSerial) {
      addLog('WARN', caps.limitationReason || 'Web Serial is unavailable in this environment.');
      setUseLiveHardware(false);
    }
  }, []);

  const handleConnect = async () => {
    setDeviceError(null);

    // Create adapter based on target and mode
    let adapter: DeviceAdapter;
    if (selectedTarget === 'ESP32' && useLiveHardware && browserCaps?.isSupported) {
      adapter = new Esp32Adapter({
        baudRate,
        logger: (msg, level) => addLog(level ? level.toUpperCase() : 'ESP32', msg),
      });
    } else {
      adapter = new MockDeviceAdapter({
        latencyMs: 150,
      });
      addLog('DEVICE', 'Using Mock Hardware Test Adapter for simulated evaluation.');
    }

    adapterRef.current = adapter;

    const unsubState = adapter.onStateChange((state, prev) => {
      setConnectionState(state);
      addLog('STATE', `Lifecycle transition: ${prev} -> ${state}`);
    });

    const unsubError = adapter.onError((err: DeviceError) => {
      setDeviceError(`[${err.code}] ${err.message}`);
      addLog('ERROR', `Device error: ${err.message}`);
    });

    try {
      addLog('DEVICE', `Initiating connection for target: ${selectedTarget}...`);
      await adapter.requestPortAndConnect();
      addLog('DEVICE', 'Port opened. Synchronizing with bootloader & querying chip ID...');
      const identity = await adapter.identifyDevice();
      setDeviceIdentity(identity);
      addLog('DEVICE', `Chip identified: ${identity.model} (${identity.architecture}) | Flash: ${identity.flashInfo.label}`);
    } catch (err: any) {
      setDeviceError(err.message || 'Connection failed.');
      addLog('ERROR', `Connection failed: ${err.message}`);
    } finally {
      // Retain subscription cleanup when unmounted
    }
  };

  const handleDisconnect = async () => {
    if (!adapterRef.current) return;
    try {
      addLog('DEVICE', 'Disconnecting: issuing safe hard-reset into normal user boot...');
      const res = await adapterRef.current.disconnect();
      setDeviceIdentity(null);
      addLog('DEVICE', res.message);
    } catch (err: any) {
      addLog('ERROR', `Disconnect error: ${err.message}`);
    } finally {
      adapterRef.current = null;
    }
  };

  const isConnected = connectionState === 'connected';
  const isBusy =
    connectionState === 'connecting' ||
    connectionState === 'requesting_permission' ||
    connectionState === 'identifying' ||
    connectionState === 'reading' ||
    connectionState === 'disconnecting';

  return (
    <div className="app-layout">
      {/* Product Header */}
      <header className="app-header" role="banner">
        <div className="brand-wrapper">
          <Shield size={24} color="#3b82f6" aria-hidden="true" />
          <div className="brand-title">
            MICROCODE <span>INSPECTOR</span>
          </div>
          <span className="badge badge-readonly" title="All firmware write and erase operations are physically banned">
            <Lock size={12} aria-hidden="true" /> Strict Read-Only
          </span>
          <span className="badge badge-stage">Stage 4: ESP32 Adapter Ready</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={useLiveHardware}
              onChange={(e) => setUseLiveHardware(e.target.checked)}
              disabled={!browserCaps?.isSupported || isConnected || isBusy}
              aria-label="Toggle Live Web Serial vs Mock Mode"
            />
            <span style={{ color: useLiveHardware ? '#60a5fa' : '#f59e0b', fontWeight: 600 }}>
              {useLiveHardware ? 'Live USB Hardware Mode' : 'Simulated Mock Mode'}
            </span>
          </label>

          <span
            className="badge"
            style={{
              background: isConnected ? '#10b98120' : connectionState === 'error' ? '#ef444420' : '#1e293b',
              color: isConnected ? '#10b981' : connectionState === 'error' ? '#ef4444' : '#94a3b8',
              border: `1px solid ${isConnected ? '#10b98140' : connectionState === 'error' ? '#ef444440' : '#334155'}`,
            }}
          >
            <Radio size={12} aria-hidden="true" /> State: {connectionState.toUpperCase()}
          </span>
        </div>
      </header>

      {/* Prominent Read-Only & Execution Interruption Warning Banner */}
      <section className="safety-banner" role="region" aria-label="Safety & Technical Boundaries Disclaimer">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <AlertTriangle size={18} color="#f59e0b" aria-hidden="true" />
          <span>
            <strong>Execution Interruption Warning:</strong> Entering bootloader mode resets the microcontroller and temporarily halts running firmware. The board will be reset to normal boot on disconnect. The tool does <strong>NOT</strong> write or erase Flash.
          </span>
        </div>
        <span className="badge badge-stage">
          {useLiveHardware ? 'Physical Web Serial' : 'Mock Harness'}
        </span>
      </section>

      {/* Browser Capability Alert if Web Serial is unsupported */}
      {browserCaps && !browserCaps.isSupported && (
        <div style={{ background: '#3b82f615', borderBottom: '1px solid #3b82f640', padding: '8px 24px', fontSize: '12px', color: '#93c5fd' }}>
          <Info size={14} style={{ display: 'inline', marginRight: '6px' }} />
          {browserCaps.limitationReason}
        </div>
      )}

      {/* Main Dashboard Layout */}
      <main className="dashboard-container" role="main">
        {/* Top Controls Grid */}
        <div className="top-grid">
          {/* Target & Hardware Selection Card */}
          <section className="card" aria-labelledby="target-select-heading">
            <div className="card-title">
              <span id="target-select-heading">Target Microcontroller</span>
              <Cpu size={16} color="#94a3b8" aria-hidden="true" />
            </div>

            <div className="device-options" role="radiogroup" aria-label="Select Target Board">
              <button
                type="button"
                role="radio"
                aria-checked={selectedTarget === 'ESP32'}
                className={`device-btn ${selectedTarget === 'ESP32' ? 'selected' : ''}`}
                onClick={() => setSelectedTarget('ESP32')}
                disabled={isBusy || isConnected}
              >
                <div className="device-btn-title">ESP32 DevKit V1</div>
                <div className="device-btn-sub">esptool-js 0.7.1 (Web Serial)</div>
              </button>

              <button
                type="button"
                role="radio"
                aria-checked={selectedTarget === 'AVR_ATMEGA'}
                className={`device-btn ${selectedTarget === 'AVR_ATMEGA' ? 'selected' : ''}`}
                onClick={() => setSelectedTarget('AVR_ATMEGA')}
                disabled={isBusy || isConnected}
              >
                <div className="device-btn-title">Arduino Uno R3</div>
                <div className="device-btn-sub">Local AVR Companion (Stage 5)</div>
              </button>
            </div>

            {/* Baud rate configuration */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px', color: '#94a3b8' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Sliders size={13} aria-hidden="true" /> Initial Baud Rate:
              </span>
              <select
                value={baudRate}
                onChange={(e) => setBaudRate(Number(e.target.value))}
                disabled={isBusy || isConnected}
                style={{ background: '#0b1323', border: '1px solid #1e293b', color: '#f1f5f9', borderRadius: '4px', padding: '3px 8px', fontSize: '12px' }}
                aria-label="Serial Baud Rate"
              >
                <option value={115200}>115,200 (Safe Default)</option>
                <option value={460800}>460,800 (Fast)</option>
                <option value={921600}>921,600 (High Speed)</option>
              </select>
            </div>

            {/* Connection Actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '4px' }}>
              {!isConnected ? (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleConnect}
                  disabled={isBusy}
                  aria-label="Request serial port and connect"
                >
                  <RefreshCw size={15} className={isBusy ? 'animate-spin' : ''} aria-hidden="true" />
                  {connectionState === 'requesting_permission'
                    ? 'Select USB Serial Port...'
                    : connectionState === 'connecting'
                    ? 'Opening Port...'
                    : connectionState === 'identifying'
                    ? 'Syncing with Bootloader...'
                    : 'Connect Serial Device'}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleDisconnect}
                  disabled={isBusy}
                  style={{ borderColor: '#ef444450', color: '#f87171' }}
                  aria-label="Disconnect device and release port"
                >
                  <PowerOff size={15} aria-hidden="true" /> Disconnect &amp; Reset Board
                </button>
              )}

              {deviceError && (
                <div style={{ background: '#ef444415', border: '1px solid #ef444440', borderRadius: '6px', padding: '10px', fontSize: '12px', color: '#fca5a5', whiteSpace: 'pre-line' }}>
                  {deviceError}
                </div>
              )}
            </div>
          </section>

          {/* Connection & Hardware Status Panel */}
          <section className="card" aria-labelledby="status-panel-heading">
            <div className="card-title">
              <span id="status-panel-heading">Hardware &amp; Security Status</span>
              {deviceIdentity ? (
                <span className="badge badge-readonly" style={{ background: '#10b98120', color: '#10b981' }}>
                  {deviceIdentity.isSimulated ? 'Simulated Mock' : 'Live Detection'}
                </span>
              ) : (
                <span className="badge" style={{ background: '#1e293b', color: '#94a3b8' }}>
                  Disconnected
                </span>
              )}
            </div>

            {deviceIdentity ? (
              <div className="meta-grid">
                <div className="meta-item">
                  <div className="meta-label">Detected Model</div>
                  <div className="meta-value">{deviceIdentity.model}</div>
                </div>
                <div className="meta-item">
                  <div className="meta-label">CPU Architecture</div>
                  <div className="meta-value">{deviceIdentity.architecture}</div>
                </div>
                <div className="meta-item">
                  <div className="meta-label">Flash Capacity</div>
                  <div className="meta-value">{deviceIdentity.flashInfo.label}</div>
                </div>
                <div className="meta-item">
                  <div className="meta-label">Flash Encryption</div>
                  <div className="meta-value" style={{ color: deviceIdentity.flashInfo.isEncrypted ? '#f59e0b' : '#10b981' }}>
                    {deviceIdentity.flashInfo.isEncrypted ? 'ENABLED' : 'DISABLED'}
                  </div>
                </div>
                <div className="meta-item">
                  <div className="meta-label">MAC Address</div>
                  <div className="meta-value">{deviceIdentity.macAddress || '—'}</div>
                </div>
                <div className="meta-item">
                  <div className="meta-label">Silicon Revision</div>
                  <div className="meta-value">{deviceIdentity.siliconRevision || '—'}</div>
                </div>
              </div>
            ) : (
              <div style={{ padding: '30px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
                No device connected. Click &quot;Connect Serial Device&quot; to prompt Web Serial selection.
              </div>
            )}
          </section>
        </div>

        {/* Extraction Control & Progress Workspace (Deferred to Stage 5) */}
        <section className="card" aria-labelledby="extraction-workspace-heading">
          <div className="card-title">
            <span id="extraction-workspace-heading">Firmware Extraction Workspace</span>
            <HardDrive size={16} color="#94a3b8" aria-hidden="true" />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
              <div>
                <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase' }}>Memory Range:</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', marginLeft: '6px', color: '#93c5fd' }}>
                  {deviceIdentity?.flashInfo.totalBytes
                    ? `0x00000000 — ${formatHexAddress(deviceIdentity.flashInfo.totalBytes)}`
                    : '—'}
                </span>
              </div>
              <div>
                <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase' }}>Total Capacity:</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', marginLeft: '6px' }}>
                  {deviceIdentity?.flashInfo.totalBytes
                    ? formatByteSize(deviceIdentity.flashInfo.totalBytes)
                    : '—'}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button type="button" className="btn-secondary" disabled title="Extraction engine scheduled for next stage">
                Read Test Slice (Stage 5)
              </button>
              <button type="button" className="btn-primary" disabled title="Extraction engine scheduled for next stage">
                Read Full Flash Dump (Stage 5)
              </button>
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#94a3b8', marginBottom: '4px' }}>
              <span>Extraction Engine Status</span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>
                {isConnected ? 'Chip Identified — Ready for Extraction (Stage 5)' : 'Device Disconnected'}
              </span>
            </div>
            <div className="progress-bar-container" role="progressbar" aria-valuenow={0} aria-valuemin={0} aria-valuemax={100}>
              <div className="progress-bar-fill" style={{ width: '0%' }} />
            </div>
          </div>
        </section>

        {/* Diagnostic Log & Terminal */}
        <section className="card" aria-labelledby="terminal-log-heading">
          <div className="card-title">
            <span id="terminal-log-heading">Diagnostic Log Panel (Sanitized)</span>
            <Terminal size={16} color="#94a3b8" aria-hidden="true" />
          </div>
          <div className="terminal-card" role="log" aria-live="polite">
            {logs.map((log) => (
              <div key={log.id} className="log-entry">
                <span className="log-time">[{log.time}]</span>
                <span className={`log-${log.cat === 'ERROR' ? 'error' : log.cat === 'WARN' ? 'warn' : 'info'}`}>
                  [{log.cat}]
                </span>
                <span>{log.msg}</span>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
};
