import React, { useState, useEffect, useRef } from 'react';
import {
  Shield,
  Cpu,
  HardDrive,
  Terminal,
  Download,
  AlertTriangle,
  RefreshCw,
  PowerOff,
  Radio,
  Lock,
  Info,
  CheckCircle2,
  XCircle,
  FileCheck,
  StopCircle,
} from 'lucide-react';
import { MockDeviceAdapter } from './device/MockDeviceAdapter.ts';
import { Esp32Adapter, MANUAL_BOOT_GUIDANCE } from './device/esp32/Esp32Adapter.ts';
import { ConnectionState, DeviceIdentity, DeviceError, DeviceAdapter } from './device/types.ts';
import { detectBrowserCapabilities, BrowserCapabilityReport } from './device/capabilities.ts';
import { formatHexAddress, formatByteSize } from './utils/address.ts';
import { Esp32FlashExtractor, ExtractionOutcome, ExtractionProgressUpdate } from './extraction/esp32/Esp32FlashExtractor.ts';

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

  // Extraction Engine State
  const [testSliceOutcome, setTestSliceOutcome] = useState<ExtractionOutcome | null>(null);
  const [extractionOutcome, setExtractionOutcome] = useState<ExtractionOutcome | null>(null);
  const [isExtracting, setIsExtracting] = useState<boolean>(false);
  const [isTestSliceRunning, setIsTestSliceRunning] = useState<boolean>(false);
  const [progress, setProgress] = useState<ExtractionProgressUpdate | null>(null);
  const [unmaskSecrets, setUnmaskSecrets] = useState<boolean>(false);

  const [logs, setLogs] = useState<Array<{ id: string; time: string; cat: string; msg: string }>>([
    { id: '1', time: new Date().toLocaleTimeString(), cat: 'SYSTEM', msg: 'MICROCODE INSPECTOR initialized in Stage 5 Read-Only Extraction mode.' },
    { id: '2', time: new Date().toLocaleTimeString(), cat: 'SECURITY', msg: 'Strict Read-Only mode active. Zero write/erase APIs compiled.' },
  ]);

  const adapterRef = useRef<DeviceAdapter | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const addLog = (cat: string, msg: string) => {
    setLogs((prev) => [
      ...prev,
      { id: String(Date.now() + Math.random()), time: new Date().toLocaleTimeString(), cat, msg },
    ]);
  };

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
    setTestSliceOutcome(null);
    setExtractionOutcome(null);
    setProgress(null);

    let adapter: DeviceAdapter;
    if (selectedTarget === 'ESP32' && useLiveHardware && browserCaps?.isSupported) {
      adapter = new Esp32Adapter({
        baudRate,
        logger: (msg, level) => addLog(level ? level.toUpperCase() : 'ESP32', msg),
      });
    } else {
      adapter = new MockDeviceAdapter({ latencyMs: 100 });
      addLog('DEVICE', 'Using Mock Hardware Test Adapter for simulated extraction evaluation.');
    }

    adapterRef.current = adapter;

    adapter.onStateChange((state, prev) => {
      setConnectionState(state);
      addLog('STATE', `Lifecycle transition: ${prev} -> ${state}`);
    });

    adapter.onError((err: DeviceError) => {
      setDeviceError(`[${err.code}] ${err.message}`);
      addLog('ERROR', `Device error: ${err.message}`);
    });

    try {
      addLog('DEVICE', `Connecting to target: ${selectedTarget}...`);
      await adapter.requestPortAndConnect();
      addLog('DEVICE', 'Port opened. Synchronizing with bootloader & querying chip ID...');
      const identity = await adapter.identifyDevice();
      setDeviceIdentity(identity);
      addLog('DEVICE', `Chip identified: ${identity.model} (${identity.architecture}) | Flash: ${identity.flashInfo.label}`);
    } catch (err: any) {
      setDeviceError(err.message || 'Connection failed.');
      addLog('ERROR', `Connection failed: ${err.message}`);
    }
  };

  const handleDisconnect = async () => {
    if (!adapterRef.current) return;
    try {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      addLog('DEVICE', 'Disconnecting: issuing safe hard-reset to return board to normal boot...');
      const res = await adapterRef.current.disconnect();
      setDeviceIdentity(null);
      addLog('DEVICE', res.message);
    } catch (err: any) {
      addLog('ERROR', `Disconnect error: ${err.message}`);
    } finally {
      adapterRef.current = null;
      setIsExtracting(false);
      setIsTestSliceRunning(false);
    }
  };

  // Step 1: Run non-destructive test slice
  const handleTestSlice = async () => {
    if (!deviceIdentity) return;
    setIsTestSliceRunning(true);
    setDeviceError(null);
    addLog('EXTRACTION', 'Executing user-approved test slice read (4 KiB at 0x1000)...');

    try {
      let outcome: ExtractionOutcome;
      if (adapterRef.current instanceof Esp32Adapter) {
        const loader = (adapterRef.current as any)._loader;
        outcome = await Esp32FlashExtractor.executeTestSlice(loader, 0x1000, 4096);
      } else {
        // Mock execution
        const mockBytes = new Uint8Array(4096);
        mockBytes[0] = 0xE9; // Simulated ESP Image Magic
        mockBytes.fill(0x33, 1);
        outcome = {
          status: 'completed',
          startAddress: 0x1000,
          bytesRequested: 4096,
          bytesRead: 4096,
          rawBytes: mockBytes,
          sha256Hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          readability: {
            status: 'readable',
            entropy: 4.82,
            hasValidAppHeader: true,
            hasValidPartitionTable: false,
            detectedSignatures: ['ESP_IMAGE_MAGIC (0xE9 at 0x1000)'],
            explanation: 'Standard ESP image header identified at 0x1000. Firmware is readable plaintext.',
          },
          elapsedMs: 85,
          isVerifiedExact: true,
        };
      }

      setTestSliceOutcome(outcome);
      addLog('EXTRACTION', `Test slice succeeded! SHA-256: ${outcome.sha256Hash.substring(0, 16)}... | Readability: ${outcome.readability.status.toUpperCase()}`);
    } catch (err: any) {
      setDeviceError(`Test slice failed: ${err.message}`);
      addLog('ERROR', `Test slice error: ${err.message}`);
    } finally {
      setIsTestSliceRunning(false);
    }
  };

  // Step 2: Run full flash extraction
  const handleFullExtraction = async () => {
    if (!deviceIdentity || !deviceIdentity.flashInfo.totalBytes) return;
    setIsExtracting(true);
    setDeviceError(null);
    setProgress(null);

    const totalBytes = deviceIdentity.flashInfo.totalBytes;
    const plan = Esp32FlashExtractor.calculatePlan(0x0, totalBytes, totalBytes, 65536);
    addLog('EXTRACTION', `Starting full Flash extraction: ${plan.totalBytes.toLocaleString('en-US')} bytes (${plan.totalChunks} chunks of 64 KiB)...`);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      let outcome: ExtractionOutcome;
      if (adapterRef.current instanceof Esp32Adapter) {
        const loader = (adapterRef.current as any)._loader;
        outcome = await Esp32FlashExtractor.executeExtraction(loader, plan, {
          abortSignal: controller.signal,
          onProgress: (p) => setProgress(p),
        });
      } else {
        // Mock extraction with live progress simulation
        const mockBuffer = new Uint8Array(totalBytes);
        for (let i = 0; i < plan.totalChunks; i++) {
          if (controller.signal.aborted) break;
          const bytesRead = Math.min((i + 1) * plan.chunkSize, totalBytes);
          setProgress({
            currentAddress: bytesRead,
            startAddress: 0,
            totalBytes,
            bytesRead,
            percentage: Math.round((bytesRead / totalBytes) * 100),
            currentChunkIndex: i + 1,
            totalChunks: plan.totalChunks,
            speedBytesPerSec: 180000,
            elapsedMs: (i + 1) * 30,
          });
          await new Promise((r) => setTimeout(r, 25));
        }

        outcome = {
          status: controller.signal.aborted ? 'cancelled' : 'completed',
          startAddress: 0,
          bytesRequested: totalBytes,
          bytesRead: controller.signal.aborted ? Math.round(totalBytes / 2) : totalBytes,
          rawBytes: mockBuffer,
          sha256Hash: '9a27e7f677d242c16f2bfa518f8dc6d88b4887b4f5352c6f11cb73b3131e508f',
          readability: {
            status: 'readable',
            entropy: 5.12,
            hasValidAppHeader: true,
            hasValidPartitionTable: true,
            detectedSignatures: ['ESP_IMAGE_MAGIC (0xE9 at 0x1000)', 'PARTITION_TABLE_MAGIC (0xAA50 at 0x8000)'],
            explanation: 'Verified readable plaintext firmware dump with valid headers.',
          },
          elapsedMs: 1200,
          isVerifiedExact: true,
        };
      }

      setExtractionOutcome(outcome);
      addLog('EXTRACTION', `Extraction outcome: ${outcome.status.toUpperCase()} (${outcome.bytesRead.toLocaleString('en-US')} bytes). SHA-256: ${outcome.sha256Hash}`);
    } catch (err: any) {
      setDeviceError(`Extraction error: ${err.message}`);
      addLog('ERROR', `Extraction error: ${err.message}`);
    } finally {
      setIsExtracting(false);
      abortControllerRef.current = null;
    }
  };

  const handleCancelExtraction = () => {
    if (abortControllerRef.current) {
      addLog('EXTRACTION', 'User requested extraction cancellation. Halting and preserving captured bytes...');
      abortControllerRef.current.abort();
    }
  };

  const handleDownloadBin = () => {
    const outcome = extractionOutcome || testSliceOutcome;
    if (!outcome) return;

    const blob = new Blob([outcome.rawBytes], { type: 'application/octet-stream' });
    const filename = `${deviceIdentity?.model.replace(/[^a-zA-Z0-9_-]/g, '_') || 'esp32'}_flash_${outcome.status === 'completed' ? 'full' : 'partial'}_${outcome.bytesRead}_bytes.bin`;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);

    addLog('EXPORT', `Exported verified binary dump: ${filename} (SHA-256: ${outcome.sha256Hash})`);
  };

  const isConnected = connectionState === 'connected';
  const isBusy =
    connectionState === 'connecting' ||
    connectionState === 'requesting_permission' ||
    connectionState === 'identifying' ||
    connectionState === 'reading' ||
    connectionState === 'disconnecting' ||
    isExtracting ||
    isTestSliceRunning;

  const activeDisplayOutcome = extractionOutcome || testSliceOutcome;

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
          <span className="badge badge-stage">Stage 5: Read-Only Extractor Ready</span>
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
            <strong>Sensor Application Preservation Notice:</strong> Entering bootloader mode resets the microcontroller and temporarily halts running firmware. The board will be reset to normal boot on disconnect. The tool does <strong>NOT</strong> write or erase Flash.
          </span>
        </div>
        <span className="badge badge-stage">
          {useLiveHardware ? 'Physical Web Serial' : 'Mock Harness'}
        </span>
      </section>

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
                <div className="device-btn-sub">Local AVR Companion (Stage 6)</div>
              </button>
            </div>

            {/* Baud rate configuration */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px', color: '#94a3b8' }}>
              <span>Initial Baud Rate:</span>
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
                No device connected. Click &quot;Connect Serial Device&quot; to begin.
              </div>
            )}
          </section>
        </div>

        {/* Extraction Control & Progress Workspace */}
        <section className="card" aria-labelledby="extraction-workspace-heading">
          <div className="card-title">
            <span id="extraction-workspace-heading">Stage 5: ESP32 Read-Only Flash Extraction</span>
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
              <button
                type="button"
                className="btn-secondary"
                onClick={handleTestSlice}
                disabled={!isConnected || isExtracting || isTestSliceRunning}
                title="Perform small non-destructive 4 KiB read at 0x1000 before full extraction"
              >
                {isTestSliceRunning ? 'Reading Test Slice...' : 'Step 1: Test Slice (4 KiB)'}
              </button>

              {!isExtracting ? (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleFullExtraction}
                  disabled={!isConnected || !deviceIdentity?.flashInfo.totalBytes || isTestSliceRunning}
                  title="Read full accessible Flash memory using bounded 64 KiB chunks"
                >
                  Step 2: Read Full Flash Dump
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleCancelExtraction}
                  style={{ borderColor: '#f59e0b80', color: '#fbbf24' }}
                >
                  <StopCircle size={15} aria-hidden="true" /> Cancel Extraction
                </button>
              )}
            </div>
          </div>

          {/* Progress Bar & Range Reporting */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#94a3b8', marginBottom: '4px' }}>
              <span>
                {progress
                  ? `Reading: ${formatHexAddress(progress.currentAddress)} / ${formatHexAddress(progress.totalBytes)} (${progress.currentChunkIndex}/${progress.totalChunks} chunks)`
                  : extractionOutcome
                  ? `Extraction ${extractionOutcome.status.toUpperCase()} (${extractionOutcome.bytesRead.toLocaleString('en-US')} bytes)`
                  : isConnected
                  ? 'Ready for extraction (Run Step 1 Test Slice first)'
                  : 'Device Disconnected'}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>
                {progress ? `${progress.percentage}%` : extractionOutcome ? '100%' : '0%'}
              </span>
            </div>
            <div className="progress-bar-container" role="progressbar" aria-valuenow={progress ? progress.percentage : 0} aria-valuemin={0} aria-valuemax={100}>
              <div className="progress-bar-fill" style={{ width: `${progress ? progress.percentage : extractionOutcome ? 100 : 0}%` }} />
            </div>
          </div>

          {/* Extraction Result Summary Banner */}
          {activeDisplayOutcome && (
            <div style={{ background: '#0b1323', border: '1px solid #1e293b', borderRadius: '8px', padding: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase' }}>
                  {activeDisplayOutcome.bytesRead < (deviceIdentity?.flashInfo.totalBytes || 0) && activeDisplayOutcome.bytesRead > 4096
                    ? 'Preserved Partial Dump'
                    : 'Captured Firmware Digest'}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#6ee7b7', wordBreak: 'break-all' }}>
                  SHA-256: {activeDisplayOutcome.sha256Hash}
                </div>
                <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                  Classification: <strong>{activeDisplayOutcome.readability.status.toUpperCase()}</strong> (Shannon Entropy: {activeDisplayOutcome.readability.entropy.toFixed(3)}/8.0) — {activeDisplayOutcome.readability.explanation}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleDownloadBin}
                  style={{ padding: '8px 12px', fontSize: '12px' }}
                >
                  <Download size={14} aria-hidden="true" /> Download .bin ({formatByteSize(activeDisplayOutcome.bytesRead)})
                </button>
              </div>
            </div>
          )}
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
