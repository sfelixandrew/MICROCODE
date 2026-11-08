# MICROCODE INSPECTOR

MICROCODE INSPECTOR is a browser-first, read-only firmware extraction, binary analysis, and disassembly application for embedded microcontrollers over USB.

The primary hardware targets are:
1. **ESP32 DevKit V1** (with runtime chip identification; classic ESP32 / Xtensa LX6 or detected variant).
2. **Arduino Uno R3** (ATmega328P / 8-bit AVR).

---

## 🛡️ Read-Only Safety Guarantee

MICROCODE INSPECTOR is built with a strict **Read-Only** security foundation:
- **Zero Flash Modification**: No write, erase, reflash, eFuse burn, chip erase, or lock-bit modification routines exist in extraction or analysis flows.
- **Application Preservation**: Reading Flash causes a temporary reset into bootloader mode; once extraction completes, the board is cleanly returned to normal user boot without altering the installed application.
- **Local-First Privacy**: 100% of firmware processing happens locally in the browser and loopback companion. No telemetry, cloud uploads, or remote AI processing.
- **Embedded Secret Protection**: Automatic client-side redaction for sensitive credentials (Wi-Fi passwords, private keys, API tokens) in previews and exported audit reports.

---

## 🔍 Core Capabilities

- **Browser-Native USB Connection**: Connect directly to ESP32 boards using the W3C Web Serial API in desktop Chromium browsers.
- **Runtime Chip & Flash Detection**: Automatic identification of chip family, silicon revision, MAC address, and Flash capacity. Never assumes a generic 4 MB size.
- **Verified Extraction & Integrity**: Chunked, safe streaming with real-time address-range reporting and immediate SHA-256 cryptographic digest calculation.
- **ESP-IDF Partition Table & Header Inspection**: Visualizes partition tables (`0x8000`/`0x9000`), bootloaders, app images (`0xE9` header format), and NVS regions.
- **AVR ATmega328P Analysis**: Validates device signatures, parses interrupt vectors, and differentiates active sketch code from unprogrammed Flash (`0xFF`).
- **Architecture Disassembly & Approximate Logic**: Recovers machine instructions (Xtensa LX6 and AVR) and generates approximate pseudocode with explicit uncertainty and confidence grading.
- **Audit Trail Export**: Generates transparent analysis reports and verifiable binary (`.bin`) and Intel HEX (`.hex`) dumps.

---

## 📚 Technical Truths & Limitations

1. **A compiled firmware dump is NOT the original `.ino`, C, or C++ source code.** Source comments, macros, local variable names, and project structures are permanently lost during compilation.
2. **Disassembly vs. Decompilation**: Disassembly produces machine instructions (ground truth). Decompilation generates synthetic hypotheses (approximate pseudocode) with uncertainty.
3. **Flash Encryption & Lock Bits**: The tool honors hardware security protections and will not attempt to crack Flash Encryption or clear AVR lock bits via chip erase.
4. **Evidence-Based Quality**: Mocked tests are never conflated with physical hardware validation.

For in-depth technical disclosures, consult:
- [`AGENTS.md`](./AGENTS.md): Permanent architectural and safety rules.
- [`docs/architecture.md`](./docs/architecture.md): Layered architecture and driver abstraction.
- [`docs/limitations.md`](./docs/limitations.md): Boundary disclosures and physics of embedded reverse engineering.
- [`docs/threat-model.md`](./docs/threat-model.md): Threat vectors (STRIDE) and security controls.
- [`docs/test-plan.md`](./docs/test-plan.md): Automated test suites and hardware bench protocols.
- [`docs/progress.md`](./docs/progress.md): Stage-by-stage implementation and hardware audit trail.

---

## 📁 Repository Structure

```
.
├── AGENTS.md                   # Permanent project and safety rules
├── README.md                   # Project overview and quick start
├── docs/                       # Technical specifications & audit logs
│   ├── architecture.md         # Component diagrams & driver models
│   ├── limitations.md          # Compilation realities & boundary disclosures
│   ├── progress.md             # Stage gate status & physical hardware log
│   ├── test-plan.md            # Test suites & device bench protocols
│   └── threat-model.md         # STRIDE threat model & mitigations
└── MicroCode_Inspector_v0.1.1/ # Audited v0.1 prototype reference
    ├── agent/                  # Legacy AVR companion helper
    └── web/                    # Legacy prototype interface
```

---

## 🚀 Development Roadmap

- **Stage 1 (Current)**: Repository Audit, Official Documentation Verification, System Architecture & Threat Model, Permanent AGENTS.md Rules.
- **Stage 2**: Production Scaffold Migration (Vite + React + TypeScript), Domain Models, & Test Harness.
- **Stage 3**: ESP32 Read-Only Driver with Runtime Detection, Chunked Streaming, & Safe Reset.
- **Stage 4**: Secure Python Companion Agent with Session CSRF, Port Whitelisting, & AVRDUDE Read-Only Driver.
- **Stage 5**: Binary Parsers (ESP-IDF Partition Table, ESP Image Header, Intel HEX Roundtrip) & SHA-256 Engine.
- **Stage 6**: Architecture Disassemblers (Xtensa LX6 & AVR) and Heuristic Pseudocode Engine with Uncertainty Flags.
- **Stage 7**: Production Web UI (Virtualized Hex Viewer, Secrets Redactor, Visual Partition Map, Audit Exporter).
- **Stage 8**: Physical Hardware Verification Bench (ESP32 DevKit V1 & Arduino Uno) & Final Release.
