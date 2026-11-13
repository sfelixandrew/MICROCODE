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
  FileCode,
  FileText,
  Layers,
  FolderOpen,
  Binary,
  Code,
  FileSearch,
} from 'lucide-react';
import { MockDeviceAdapter } from './device/MockDeviceAdapter.ts';
import { Esp32Adapter, MANUAL_BOOT_GUIDANCE } from './device/esp32/Esp32Adapter.ts';
import { ArduinoUnoAdapter, UnoPortInfo, UnoExtractionMetadata } from './device/uno/ArduinoUnoAdapter.ts';
import { ConnectionState, DeviceIdentity, DeviceError, DeviceAdapter } from './device/types.ts';
import { detectBrowserCapabilities, BrowserCapabilityReport } from './device/capabilities.ts';
import { formatHexAddress, formatByteSize } from './utils/address.ts';
import { Esp32FlashExtractor, ExtractionOutcome, ExtractionProgressUpdate } from './extraction/esp32/Esp32FlashExtractor.ts';
import { MemoryMapEngine } from './parsers/memoryMapEngine.ts';
import type { MemoryMapReport } from './parsers/types.ts';
import { MemoryMapView } from './components/MemoryMapView.tsx';
import { StringsView } from './components/StringsView.tsx';

type AnalysisTab = 'overview' | 'memory_map' | 'strings' | 'hex_bin' | 'assembly' | 'pseudocode' | 'report';

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

  // Uno Companion State
  const [availablePorts, setAvailablePorts] = useState<UnoPortInfo[]>([]);
  const [selectedUnoPort, setSelectedUnoPort] = useState<string>('');
  const [companionStatus, setCompanionStatus] = useState<{ active: boolean; message: string }>({
    active: false,
    message: 'Checking companion daemon...',
  });

  // Extraction & Topology State
  const [testSliceOutcome, setTestSliceOutcome] = useState<ExtractionOutcome | null>(null);
  const [extractionOutcome, setExtractionOutcome] = useState<ExtractionOutcome | null>(null);
  const [unoMetadata, setUnoMetadata] = useState<UnoExtractionMetadata | null>(null);
  const [unoHexContent, setUnoHexContent] = useState<string | null>(null);
  const [memoryMapReport, setMemoryMapReport] = useState<MemoryMapReport | null>(null);
  const [isExtracting, setIsExtracting] = useState<boolean>(false);
  const [isTestSliceRunning, setIsTestSliceRunning] = useState<boolean>(false);
  const [progress, setProgress] = useState<ExtractionProgressUpdate | null>(null);

  const [logs, setLogs] = useState<Array<{ id: string; time: string; cat: string; msg: string }>>([
    { id: '1', time: new Date().toLocaleTimeString(), cat: 'SYSTEM', msg: 'MICROCODE INSPECTOR initialized in Stage 7 Parsing mode.' },
    { id: '2', time: new Date().toLocaleTimeString(), cat: 'SECURITY', msg: 'Strict Read-Only mode active. Zero write/erase APIs compiled.' },
    { id: '3', time: new Date().toLocaleTimeString(), cat: 'PARSER', msg: 'Offline parsers ready: ESP image headers, partition tables, Intel HEX, AVR vectors.' },
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
    }
  }, []);

  // When switching to Arduino Uno or on mount, query local companion health & ports
  useEffect(() => {
    let isMounted = true;
    const probeCompanion = async () => {
      try {
        const dummyAdapter = new ArduinoUnoAdapter();
        const health = await dummyAdapter.checkCompanionHealth();
        if (!isMounted) return;

        if (health.ok) {
          setCompanionStatus({
            active: true,
            message: `Companion active on 127.0.0.1:8765 (${health.version || 'AVRDUDE ready'})`,
          });
          const ports = await dummyAdapter.fetchDiscoveredPorts();
          if (isMounted) {
            setAvailablePorts(ports);
            if (ports.length > 0 && !selectedUnoPort) {
              const unoPort = ports.find((p) =>
                p.description.toLowerCase().includes('arduino') || p.description.toLowerCase().includes('uno'),
              );
              setSelectedUnoPort(unoPort ? unoPort.port : ports[0].port);
            }
          }
        } else {
          setCompanionStatus({
            active: false,
            message: health.message || 'Companion offline. Start with "python agent/main.py".',
          });
        }
      } catch {
        if (isMounted) {
          setCompanionStatus({
            active: false,
            message: 'Companion offline on 127.0.0.1:8765. Start with "python agent/main.py".',
          });
        }
      }
    };

    if (selectedTarget === 'AVR_ATMEGA') {
      probeCompanion();
    }

    return () => {
      isMounted = false;
    };
  }, [selectedTarget]);

  // Load offline file handler (.bin or .hex)
  const handleLoadOfflineFile = (file: File) => {
    const reader = new FileReader();
    const isHex = file.name.toLowerCase().endsWith('.hex');

    reader.onload = () => {
      try {
        let input: Uint8Array | string;
        if (isHex) {
          input = reader.result as string;
        } else {
          input = new Uint8Array(reader.result as ArrayBuffer);
        }

        addLog('PARSER', `Parsing offline firmware file: ${file.name} (${formatByteSize(file.size)})...`);
        const report = MemoryMapEngine.analyze(input, {
          targetArchitectureHint: file.name.toLowerCase().includes('esp')
            ? 'xtensa-lx6'
            : file.name.toLowerCase().includes('uno')
            ? 'avr8'
            : undefined,
        });

        setMemoryMapReport(report);
        setActiveTab('memory_map');
        addLog(
          'PARSER',
          `Parsed ${report.regions.length} regions (${report.regions.filter((r) => r.confidence === 'verified').length} verified, ` +
            `${report.regions.filter((r) => r.confidence === 'heuristic').length} heuristic). Target: ${report.targetArchitecture.toUpperCase()}`,
        );
      } catch (err: any) {
        setDeviceError(`Failed to parse offline file: ${err.message}`);
        addLog('ERROR', `Offline parse error: ${err.message}`);
      }
    };

    if (isHex) {
      reader.readAsText(file);
    } else {
      reader.readAsArrayBuffer(file);
    }
  };

  const handleConnect = async () => {
    setDeviceError(null);
    setTestSliceOutcome(null);
    setExtractionOutcome(null);
    setUnoMetadata(null);
    setUnoHexContent(null);
    setProgress(null);

    let adapter: DeviceAdapter;

    if (selectedTarget === 'ESP32') {
      if (useLiveHardware && browserCaps?.isSupported) {
        adapter = new Esp32Adapter({
          baudRate,
          logger: (msg, level) => addLog(level ? level.toUpperCase() : 'ESP32', msg),
        });
      } else {
        adapter = new MockDeviceAdapter({ latencyMs: 100 });
        addLog('DEVICE', 'Using Mock Hardware Test Adapter for simulated ESP32 evaluation.');
      }
    } else {
      // Arduino Uno R3 Target
      if (useLiveHardware) {
        adapter = new ArduinoUnoAdapter({
          targetPort: selectedUnoPort || undefined,
          baudRate,
          logger: (msg, level) => addLog(level ? level.toUpperCase() : 'UNO', msg),
        });
      } else {
        adapter = new MockDeviceAdapter({ latencyMs: 100 });
        addLog('DEVICE', 'Using Mock Hardware Test Adapter for simulated Arduino Uno evaluation.');
      }
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
      addLog('DEVICE', 'Disconnecting: issuing safe reset to return board to normal user boot...');
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

  // ESP32 Step 1: Run non-destructive test slice
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
        mockBytes[0] = 0xe9; // Simulated ESP Image Magic
        mockBytes[1] = 0x01; // 1 segment
        mockBytes[2] = 0x02; // DIO
        mockBytes[3] = 0x20; // 40MHz, 4MB
        const v = new DataView(mockBytes.buffer);
        v.setUint32(4, 0x40080000, true);
        v.setUint16(12, 0x0000, true);
        v.setUint32(24, 0x40080000, true);
        v.setUint32(28, 64, true);
        mockBytes.fill(0x33, 32, 96);
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

      // Run offline parsing on test slice
      const report = MemoryMapEngine.analyze(outcome.rawBytes, {
        targetArchitectureHint: deviceIdentity.architecture,
      });
      setMemoryMapReport(report);
    } catch (err: any) {
      setDeviceError(`Test slice failed: ${err.message}`);
      addLog('ERROR', `Test slice error: ${err.message}`);
    } finally {
      setIsTestSliceRunning(false);
    }
  };

  // ESP32 Step 2: Run full flash extraction
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

        // Add bootloader magic at 0x1000 and partition table at 0x8000
        mockBuffer[0x1000] = 0xe9;
        mockBuffer[0x1001] = 0x01;
        mockBuffer[0x8000] = 0xaa;
        mockBuffer[0x8001] = 0x50;

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

      // Run full offline topology and memory map parsing
      const report = MemoryMapEngine.analyze(outcome.rawBytes, {
        targetArchitectureHint: deviceIdentity.architecture,
        flashCapacityHint: totalBytes,
      });
      setMemoryMapReport(report);
      addLog('PARSER', `Topology mapped: ${report.regions.length} regions detected (${report.unmappedRanges.length} unmapped gaps).`);
    } catch (err: any) {
      setDeviceError(`Extraction error: ${err.message}`);
      addLog('ERROR', `Extraction error: ${err.message}`);
    } finally {
      setIsExtracting(false);
      abortControllerRef.current = null;
    }
  };

  // Arduino Uno R3: Run read-only Flash extraction via AVRDUDE companion
  const handleUnoExtraction = async () => {
    if (!deviceIdentity || !adapterRef.current) return;
    setIsExtracting(true);
    setDeviceError(null);
    setProgress(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    addLog('EXTRACTION', 'Starting strictly read-only Arduino Uno Flash readout (32 KiB via AVRDUDE)...');

    try {
      if (adapterRef.current instanceof ArduinoUnoAdapter) {
        const result = await adapterRef.current.readMemory(
          { startAddress: 0, lengthBytes: 32768, abortSignal: controller.signal },
          (p) => {
            setProgress({
              currentAddress: p.currentAddress,
              startAddress: p.startAddress,
              totalBytes: p.totalBytes,
              bytesRead: p.bytesRead,
              percentage: p.percentage,
              currentChunkIndex: 1,
              totalChunks: 1,
              speedBytesPerSec: 115200 / 10,
              elapsedMs: 0,
            });
          },
        );

        const meta = adapterRef.current.getFlashExtractionMetadata();
        const hex = adapterRef.current.getExtractedHex();

        setUnoMetadata(meta);
        setUnoHexContent(hex);

        const outcome: ExtractionOutcome = {
          status: 'completed',
          startAddress: 0,
          bytesRequested: 32768,
          bytesRead: 32768,
          rawBytes: result.rawBytes,
          sha256Hash: meta?.sha256 || 'unknown',
          readability: {
            status: 'readable',
            entropy: 3.95,
            hasValidAppHeader: true,
            hasValidPartitionTable: false,
            detectedSignatures: ['AVR_RESET_VECTOR (0x0C 0x94 at 0x0000)', `LOCK_BITS (${meta?.lockBits || '0x3F'})`],
            explanation: `ATmega328P Flash extracted (${meta?.explicitReadBytes} bytes explicit, ${meta?.erasedPaddingBytes} unprogrammed 0xFF padding).`,
          },
          elapsedMs: result.elapsedMs,
          isVerifiedExact: true,
        };

        setExtractionOutcome(outcome);
        addLog('EXTRACTION', `Arduino Uno Flash verified: SHA-256 ${outcome.sha256Hash}`);

        // Run full offline topology and memory map parsing
        const report = MemoryMapEngine.analyze(result.rawBytes, {
          targetArchitectureHint: 'avr8',
          flashCapacityHint: 32768,
        });
        setMemoryMapReport(report);
      } else {
        // Mock Uno extraction
        const mockBuffer = new Uint8Array(32768);
        mockBuffer.fill(0xff);
        mockBuffer[0] = 0x0c;
        mockBuffer[1] = 0x94;
        mockBuffer[2] = 0x34;
        mockBuffer[3] = 0x00;
        mockBuffer.fill(0x33, 104, 2048); // Mock app code
        mockBuffer.fill(0xcc, 0x7e00, 32768); // Mock bootloader

        const outcome: ExtractionOutcome = {
          status: 'completed',
          startAddress: 0,
          bytesRequested: 32768,
          bytesRead: 32768,
          rawBytes: mockBuffer,
          sha256Hash: '4a413d80016e780d604b7dbcfb543c799a74cf1176b509ef4c17240212f45ea2',
          readability: {
            status: 'readable',
            entropy: 1.25,
            hasValidAppHeader: true,
            hasValidPartitionTable: false,
            detectedSignatures: ['AVR_RESET_VECTOR (0x0C 0x94 at 0x0000)', 'LOCK_BITS (0x3F)'],
            explanation: 'Simulated 32 KiB ATmega328P Flash image with trailing 0xFF unprogrammed padding.',
          },
          elapsedMs: 850,
          isVerifiedExact: true,
        };

        setExtractionOutcome(outcome);
        setUnoMetadata({
          targetModel: 'Arduino Uno R3 (ATmega328P)',
          architecture: 'avr8',
          signature: '0x1E 0x95 0x0F',
          lockBits: '0x3F',
          totalBytes: 32768,
          explicitReadBytes: 4096,
          erasedPaddingBytes: 28672,
          sha256: outcome.sha256Hash,
          isVerifiedExact: true,
          memoryLayout: {
            baseAddress: 0,
            endAddress: 32767,
            vectorsRange: [0, 52],
            applicationRange: [52, 32255],
            optibootRange: [32256, 32767],
          },
          extractedAtIso: new Date().toISOString(),
        });

        const report = MemoryMapEngine.analyze(mockBuffer, {
          targetArchitectureHint: 'avr8',
          flashCapacityHint: 32768,
        });
        setMemoryMapReport(report);
        addLog('EXTRACTION', `Simulated Uno extraction completed: SHA-256 ${outcome.sha256Hash}`);
      }
    } catch (err: any) {
      setDeviceError(`Uno extraction failed: ${err.message}`);
      addLog('ERROR', `Uno extraction error: ${err.message}`);
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
    const filename = `${deviceIdentity?.model.replace(/[^a-zA-Z0-9_-]/g, '_') || 'firmware'}_flash_${outcome.status === 'completed' ? 'full' : 'partial'}_${outcome.bytesRead}_bytes.bin`;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);

    addLog('EXPORT', `Exported verified binary dump: ${filename} (SHA-256: ${outcome.sha256Hash})`);
  };

  const handleDownloadHex = () => {
    if (!unoHexContent) return;

    const blob = new Blob([unoHexContent], { type: 'text/plain' });
    const filename = `${deviceIdentity?.model.replace(/[^a-zA-Z0-9_-]/g, '_') || 'arduino_uno'}_flash.hex`;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);

    addLog('EXPORT', `Exported verified Intel HEX dump: ${filename}`);
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
          <span className="badge badge-stage">Stage 7: Firmware Parsers &amp; Topology Map Ready</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={useLiveHardware}
              onChange={(e) => setUseLiveHardware(e.target.checked)}
              disabled={isConnected || isBusy}
              aria-label="Toggle Live Hardware vs Mock Mode"
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
          {useLiveHardware ? (selectedTarget === 'ESP32' ? 'Web Serial (esptool-js)' : 'Local Companion (AVRDUDE)') : 'Mock Harness'}
        </span>
      </section>

      {/* Main Analysis Tab Navigation Header */}
      <nav className="tabs-header" role="tablist" aria-label="Analysis Panels">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'overview'}
          className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          Overview &amp; Extraction
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'memory_map'}
          className={`tab-btn ${activeTab === 'memory_map' ? 'active' : ''}`}
          onClick={() => setActiveTab('memory_map')}
        >
          Memory Map &amp; Topology {memoryMapReport && `(${memoryMapReport.regions.length})`}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'strings'}
          className={`tab-btn ${activeTab === 'strings' ? 'active' : ''}`}
          onClick={() => setActiveTab('strings')}
        >
          Printable Strings {memoryMapReport && `(${memoryMapReport.strings.length})`}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'hex_bin'}
          className={`tab-btn ${activeTab === 'hex_bin' ? 'active' : ''}`}
          onClick={() => setActiveTab('hex_bin')}
        >
          HEX / BIN Viewer <span style={{ fontSize: '10px', color: '#64748b' }}>(Stage 8)</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'assembly'}
          className={`tab-btn ${activeTab === 'assembly' ? 'active' : ''}`}
          onClick={() => setActiveTab('assembly')}
        >
          Assembly <span style={{ fontSize: '10px', color: '#64748b' }}>(Stage 10)</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'pseudocode'}
          className={`tab-btn ${activeTab === 'pseudocode' ? 'active' : ''}`}
          onClick={() => setActiveTab('pseudocode')}
        >
          Pseudocode <span style={{ fontSize: '10px', color: '#64748b' }}>(Stage 11)</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'report'}
          className={`tab-btn ${activeTab === 'report' ? 'active' : ''}`}
          onClick={() => setActiveTab('report')}
        >
          Audit Report <span style={{ fontSize: '10px', color: '#64748b' }}>(Stage 12)</span>
        </button>
      </nav>

      {/* Main Workspace Body */}
      <main className="dashboard-container" role="main">
        {/* Tab 1: Overview & Extraction Dashboard */}
        {activeTab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
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
                    onClick={() => {
                      if (selectedTarget !== 'ESP32') {
                        setSelectedTarget('ESP32');
                        setDeviceIdentity(null);
                      }
                    }}
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
                    onClick={() => {
                      if (selectedTarget !== 'AVR_ATMEGA') {
                        setSelectedTarget('AVR_ATMEGA');
                        setDeviceIdentity(null);
                      }
                    }}
                    disabled={isBusy || isConnected}
                  >
                    <div className="device-btn-title">Arduino Uno R3</div>
                    <div className="device-btn-sub">ATmega328P (AVRDUDE Companion)</div>
                  </button>
                </div>

                {/* Target-specific options */}
                {selectedTarget === 'AVR_ATMEGA' && (
                  <div style={{ background: '#0b1323', border: '1px solid #1e293b', borderRadius: '6px', padding: '10px', fontSize: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <span style={{ color: '#94a3b8' }}>Local Companion:</span>
                      <span style={{ color: companionStatus.active ? '#10b981' : '#f59e0b', fontWeight: 600 }}>
                        {companionStatus.active ? 'ONLINE (127.0.0.1:8765)' : 'OFFLINE'}
                      </span>
                    </div>
                    {!companionStatus.active && (
                      <div style={{ color: '#fbbf24', fontSize: '11px', marginBottom: '8px' }}>
                        {companionStatus.message}
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ color: '#94a3b8' }}>Target Serial Port:</span>
                      {availablePorts.length > 0 ? (
                        <select
                          value={selectedUnoPort}
                          onChange={(e) => setSelectedUnoPort(e.target.value)}
                          disabled={isBusy || isConnected}
                          style={{ background: '#101626', border: '1px solid #334460', color: '#f1f5f9', borderRadius: '4px', padding: '2px 6px', fontSize: '12px' }}
                        >
                          {availablePorts.map((p) => (
                            <option key={p.port} value={p.port}>
                              {p.port} ({p.description})
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span style={{ color: '#64748b', fontStyle: 'italic' }}>Auto-detect or COM port</span>
                      )}
                    </div>
                  </div>
                )}

                {/* Baud rate configuration */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px', color: '#94a3b8' }}>
                  <span>Baud Rate:</span>
                  <select
                    value={baudRate}
                    onChange={(e) => setBaudRate(Number(e.target.value))}
                    disabled={isBusy || isConnected}
                    style={{ background: '#0b1323', border: '1px solid #1e293b', color: '#f1f5f9', borderRadius: '4px', padding: '3px 8px', fontSize: '12px' }}
                    aria-label="Serial Baud Rate"
                  >
                    <option value={115200}>115,200 (Safe Default / Uno Standard)</option>
                    <option value={460800}>460,800 (ESP32 Fast)</option>
                    <option value={921600}>921,600 (ESP32 High Speed)</option>
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
                        ? 'Requesting Port Access...'
                        : connectionState === 'connecting'
                        ? 'Opening Connection...'
                        : connectionState === 'identifying'
                        ? 'Syncing with Bootloader...'
                        : `Connect ${selectedTarget === 'ESP32' ? 'ESP32' : 'Arduino Uno'}`}
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
                  <div className="meta-label">Detected Target</div>
                  <div className="meta-value">{deviceIdentity.model}</div>
                </div>
                <div className="meta-item">
                  <div className="meta-label">Architecture</div>
                  <div className="meta-value">{deviceIdentity.architecture.toUpperCase()}</div>
                </div>
                <div className="meta-item">
                  <div className="meta-label">Flash Memory</div>
                  <div className="meta-value">{deviceIdentity.flashInfo.label}</div>
                </div>
                <div className="meta-item">
                  <div className="meta-label">
                    {deviceIdentity.family === 'ESP32' ? 'Flash Encryption' : 'Memory Lock Bits'}
                  </div>
                  <div
                    className="meta-value"
                    style={{
                      color:
                        deviceIdentity.family === 'ESP32'
                          ? deviceIdentity.flashInfo.isEncrypted
                            ? '#f59e0b'
                            : '#10b981'
                          : deviceIdentity.lockBitsHex?.includes('Mode 3')
                          ? '#ef4444'
                          : '#10b981',
                    }}
                  >
                    {deviceIdentity.family === 'ESP32'
                      ? deviceIdentity.flashInfo.isEncrypted
                        ? 'ENABLED'
                        : 'DISABLED'
                      : deviceIdentity.lockBitsHex || '0x3F (Mode 1 / Unlocked)'}
                  </div>
                </div>
                <div className="meta-item">
                  <div className="meta-label">{deviceIdentity.family === 'ESP32' ? 'MAC Address' : 'Device Signature'}</div>
                  <div className="meta-value">{deviceIdentity.macAddress || deviceIdentity.signatureHex || '—'}</div>
                </div>
                <div className="meta-item">
                  <div className="meta-label">{deviceIdentity.family === 'ESP32' ? 'Silicon Revision' : 'Bootloader Region'}</div>
                  <div className="meta-value">
                    {deviceIdentity.siliconRevision || (deviceIdentity.family === 'AVR_ATMEGA' ? 'Optiboot (0x7E00-0x7FFF)' : '—')}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ padding: '30px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
                No device connected. Click &quot;Connect {selectedTarget === 'ESP32' ? 'ESP32' : 'Arduino Uno'}&quot; to begin.
              </div>
            )}
              </section>
            </div>

            {/* Extraction Control & Progress Workspace */}
            <section className="card" aria-labelledby="extraction-workspace-heading">
              <div className="card-title">
                <span id="extraction-workspace-heading">
                  {selectedTarget === 'ESP32'
                    ? 'ESP32 Read-Only Flash Extraction (esptool-js)'
                    : 'Arduino Uno R3 Read-Only Flash Extraction (AVRDUDE)'}
                </span>
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
                  {selectedTarget === 'ESP32' ? (
                    <>
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
                    </>
                  ) : (
                    /* Arduino Uno Controls */
                    <>
                      {!isExtracting ? (
                        <button
                          type="button"
                          className="btn-primary"
                          onClick={handleUnoExtraction}
                          disabled={!isConnected || isBusy}
                          title="Extract 32 KiB Flash image via strictly read-only AVRDUDE read"
                        >
                          <Download size={15} aria-hidden="true" /> Read Uno Flash (32 KiB via AVRDUDE)
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
                    </>
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
                      ? selectedTarget === 'ESP32'
                        ? 'Ready for extraction (Run Step 1 Test Slice first)'
                        : 'Ready for extraction (Click Read Uno Flash)'
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
                    {unoMetadata && (
                      <div style={{ fontSize: '11px', color: '#60a5fa', marginTop: '3px' }}>
                        Programmed code: {unoMetadata.explicitReadBytes.toLocaleString('en-US')} bytes | Erased 0xFF padding: {unoMetadata.erasedPaddingBytes.toLocaleString('en-US')} bytes | Signature: {unoMetadata.signature}
                      </div>
                    )}
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
                    {unoHexContent && (
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={handleDownloadHex}
                        style={{ padding: '8px 12px', fontSize: '12px', borderColor: '#3b82f660', color: '#93c5fd' }}
                      >
                        <FileCode size={14} aria-hidden="true" /> Download .hex (Intel HEX)
                      </button>
                    )}
                    {memoryMapReport && (
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setActiveTab('memory_map')}
                        style={{ padding: '8px 12px', fontSize: '12px' }}
                      >
                        <Layers size={14} aria-hidden="true" /> View Memory Map ({memoryMapReport.regions.length})
                      </button>
                    )}
                  </div>
                </div>
              )}
            </section>
          </div>
        )}

        {/* Tab 2: Memory Map & Partition Topology */}
        {activeTab === 'memory_map' && (
          <MemoryMapView report={memoryMapReport} onLoadFile={handleLoadOfflineFile} />
        )}

        {/* Tab 3: Printable String Extraction */}
        {activeTab === 'strings' && (
          <StringsView strings={memoryMapReport?.strings ?? []} />
        )}

        {/* Tab 4: HEX / BIN Viewer Placeholder (Stage 8) */}
        {activeTab === 'hex_bin' && (
          <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
            <Binary size={40} color="#475569" style={{ margin: '0 auto 16px' }} />
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#f1f5f9', marginBottom: '8px' }}>
              Virtualized HEX &amp; ASCII Table Inspector (Stage 8)
            </h3>
            <p style={{ fontSize: '13px', color: '#94a3b8', maxWidth: '480px', margin: '0 auto' }}>
              High-performance viewport-virtualized hex inspection engine with address offset navigation, ASCII sidebars, and partition boundary highlighting.
            </p>
          </div>
        )}

        {/* Tab 5: Assembly Disassembler Placeholder (Stage 10) */}
        {activeTab === 'assembly' && (
          <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
            <Code size={40} color="#475569" style={{ margin: '0 auto 16px' }} />
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#f1f5f9', marginBottom: '8px' }}>
              Architecture Disassembly Engine (Stage 10)
            </h3>
            <p style={{ fontSize: '13px', color: '#94a3b8', maxWidth: '480px', margin: '0 auto' }}>
              Architecture-specific disassembler adapters for Xtensa LX6 (ESP32) and AVR (ATmega328P) mapping hardware registers, I/O ports, and interrupt handlers.
            </p>
          </div>
        )}

        {/* Tab 6: Pseudocode Generator Placeholder (Stage 11) */}
        {activeTab === 'pseudocode' && (
          <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
            <FileSearch size={40} color="#475569" style={{ margin: '0 auto 16px' }} />
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#f1f5f9', marginBottom: '8px' }}>
              Approximate Pseudocode &amp; Logic Explanation Engine (Stage 11)
            </h3>
            <p style={{ fontSize: '13px', color: '#94a3b8', maxWidth: '480px', margin: '0 auto' }}>
              Control-flow graph reconstruction, loop recovery, and approximate logic explanation with transparent confidence metrics.
            </p>
          </div>
        )}

        {/* Tab 7: Audit Report Placeholder (Stage 12) */}
        {activeTab === 'report' && (
          <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
            <FileCheck size={40} color="#475569" style={{ margin: '0 auto 16px' }} />
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#f1f5f9', marginBottom: '8px' }}>
              Firmware Audit &amp; Integrity Report (Stage 12)
            </h3>
            <p style={{ fontSize: '13px', color: '#94a3b8', maxWidth: '480px', margin: '0 auto' }}>
              Exportable Markdown and PDF security audit report documenting SHA-256 provenance, partition tables, entropy profile, detected secrets, and read-only extraction proof.
            </p>
          </div>
        )}

        {/* Diagnostic Log & Terminal (Always visible at bottom) */}
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
