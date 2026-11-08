import { DeviceIdentity } from '../types/device';
import { MemoryRegion } from '../types/memory';
import { PartitionEntry, EspAppHeader, DisassemblyInstruction, PseudocodeBlock, AuditEntry } from '../types/analysis';
import { VerifiableDump } from '../types/extraction';

export const MOCK_ESP32_IDENTITY: DeviceIdentity = {
  family: 'ESP32',
  model: 'ESP32 (revision v3.0) [MOCK TEST HARNESS]',
  architecture: 'xtensa-lx6',
  macAddress: '24:6F:28:AB:CD:EF',
  crystalFreqMHz: 40,
  chipRevision: '3',
  detectedFlashBytes: 4194304,
  flashCapacityLabel: '4 MB (4,194,304 bytes) [SIMULATED]',
  securityFeatures: {
    flashEncryption: 'disabled',
    secureBoot: 'disabled',
    flashCryptCount: 0,
    secureDownloadMode: false,
  },
  rawChipId: 0,
};

export const MOCK_UNO_IDENTITY: DeviceIdentity = {
  family: 'AVR_ATMEGA',
  model: 'Arduino Uno R3 (ATmega328P) [MOCK TEST HARNESS]',
  architecture: 'avr8',
  detectedFlashBytes: 32768,
  flashCapacityLabel: '32 KiB (32,768 bytes) [SIMULATED]',
  securityFeatures: {
    flashEncryption: 'disabled',
    secureBoot: 'disabled',
    lockBitsHex: '0x3F (Unprotected Mode 1)',
    signatureBytesHex: '0x1E 0x95 0x0F',
  },
};

export const MOCK_MEMORY_REGIONS: MemoryRegion[] = [
  {
    id: 'bootloader',
    name: '2nd Stage Bootloader',
    type: 'bootloader',
    range: { start: 0x1000, end: 0x8000, length: 0x7000 },
    isReadable: true,
    isEncrypted: false,
    description: 'ESP-IDF secondary bootloader image',
    provenance: 'standard_default',
  },
  {
    id: 'partitions',
    name: 'Partition Table',
    type: 'partition_table',
    range: { start: 0x8000, end: 0x9000, length: 0x1000 },
    isReadable: true,
    isEncrypted: false,
    description: 'ESP-IDF partition table records',
    provenance: 'detected',
  },
  {
    id: 'nvs',
    name: 'NVS Storage',
    type: 'data_nvs',
    range: { start: 0x9000, end: 0xD000, length: 0x4000 },
    isReadable: true,
    isEncrypted: false,
    description: 'Non-Volatile Storage key-value partition',
    provenance: 'detected',
  },
  {
    id: 'app0',
    name: 'Factory Application (app0)',
    type: 'app',
    range: { start: 0x10000, end: 0x110000, length: 0x100000 },
    isReadable: true,
    isEncrypted: false,
    description: 'Active factory sensor application firmware',
    provenance: 'detected',
  },
];

export const MOCK_PARTITIONS: PartitionEntry[] = [
  {
    magic: 0xAA50,
    type: 0x01,
    typeLabel: 'Data',
    subtype: 0x02,
    subtypeLabel: 'nvs',
    offset: 0x9000,
    size: 0x4000,
    label: 'nvs',
    flags: 0,
    isEncrypted: false,
  },
  {
    magic: 0xAA50,
    type: 0x01,
    typeLabel: 'Data',
    subtype: 0x00,
    subtypeLabel: 'ota_data',
    offset: 0xD000,
    size: 0x2000,
    label: 'otadata',
    flags: 0,
    isEncrypted: false,
  },
  {
    magic: 0xAA50,
    type: 0x00,
    typeLabel: 'App',
    subtype: 0x00,
    subtypeLabel: 'factory',
    offset: 0x10000,
    size: 0x100000,
    label: 'factory',
    flags: 0,
    isEncrypted: false,
  },
];

export const MOCK_ESP_APP_HEADER: EspAppHeader = {
  magic: 0xE9,
  segmentCount: 4,
  spiMode: 'DIO',
  spiSpeed: '40MHz',
  spiSize: '4MB',
  entryPoint: 0x40080698,
  segments: [
    { loadAddress: 0x3F400020, dataLength: 0x1928, segmentIndex: 0 },
    { loadAddress: 0x3FFE0000, dataLength: 0x0740, segmentIndex: 1 },
    { loadAddress: 0x40080000, dataLength: 0x0400, segmentIndex: 2 },
    { loadAddress: 0x40080400, dataLength: 0x4E20, segmentIndex: 3 },
  ],
  hasSha256Digest: true,
  sha256DigestHex: '8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4',
};

export const MOCK_DISASSEMBLY_SAMPLE: DisassemblyInstruction[] = [
  { address: 0x40080400, rawBytesHex: '36 41 00', mnemonic: 'ENTRY', operands: 'a1, 32', comment: 'Function prologue' },
  { address: 0x40080403, rawBytesHex: '06 02 00', mnemonic: 'L32R', operands: 'a2, 0x40080040', comment: 'Load register base' },
  { address: 0x40080406, rawBytesHex: '22 42 00', mnemonic: 'MOV.N', operands: 'a4, a2', comment: '' },
  { address: 0x40080409, rawBytesHex: 'e0 08 00', mnemonic: 'CALL8', operands: '0x40081240', comment: 'Call gpio_config_internal' },
  { address: 0x4008040C, rawBytesHex: 'f0 0d 00', mnemonic: 'RETW.N', operands: '', comment: 'Function return' },
];

export const MOCK_PSEUDOCODE_SAMPLE: PseudocodeBlock[] = [
  {
    blockId: 'block_0',
    range: { start: 0x40080400, end: 0x4008040F, length: 15 },
    functionName: 'inferred_hardware_init',
    confidence: 'MEDIUM',
    confidenceReason: 'Recognized windowed register prologue and GPIO peripheral initialization call.',
    syntheticCode: `// [SYNTHETIC HYPOTHESIS - APPROXIMATE RECONSTRUCTED LOGIC]
// Target: Xtensa LX6 @ 0x40080400
void inferred_hardware_init(void) {
    // Register a2 loaded from literal pool at 0x40080040
    const uint32_t *peripheral_base = (const uint32_t *)0x3FF44000;
    
    // Inferred call to internal initialization routine
    sub_40081240(peripheral_base);
    return;
}`,
    inferredRegisters: ['a1', 'a2', 'a4'],
  },
];

export const MOCK_VERIFIABLE_DUMP: VerifiableDump = {
  dumpId: 'dump-sim-esp32-001',
  timestampIso: '2026-11-08T22:50:00Z',
  targetFamily: 'ESP32',
  targetModel: 'ESP32 (revision v3.0)',
  architecture: 'xtensa-lx6',
  byteCount: 4194304,
  sha256Hash: '9a27e7f677d242c16f2bfa518f8dc6d88b4887b4f5352c6f11cb73b3131e508f',
  rawBytes: new Uint8Array(4096), // Small sample buffer for mock
  isSimulatedMock: true,
  notes: 'Simulated visual development dump. No physical hardware was queried.',
};

export const MOCK_AUDIT_LOGS: AuditEntry[] = [
  {
    id: 'log-1',
    timestamp: '22:50:01',
    category: 'DEVICE',
    message: 'System started in VISUAL DEVELOPMENT MODE. Hardware connectivity disabled in Stage 2.',
  },
  {
    id: 'log-2',
    timestamp: '22:50:02',
    category: 'SECURITY',
    message: 'Read-only safety engine initialized. Zero write/erase APIs compiled.',
  },
  {
    id: 'log-3',
    timestamp: '22:50:03',
    category: 'INTEGRITY',
    message: 'Web Crypto SHA-256 integrity verification ready.',
  },
];

