# Project Progress & Hardware Verification Audit Trail

## 1. Stage Gate Roadmap

| Stage | Description | Status | Evidence / Artifacts |
| :---: | :--- | :---: | :--- |
| **Stage 1** | **Repository Audit, Official Docs Verification, Architecture & Permanent Rules** | **In Progress (Active)** | `AGENTS.md`, `docs/architecture.md`, `docs/limitations.md`, `docs/threat-model.md`, `docs/test-plan.md` |
| **Stage 2** | Production Scaffold Migration (Vite + React + TypeScript), Domain Models, & Test Harness | Queued | `package.json`, `tsconfig.json`, `src/types/`, Vitest test suite |
| **Stage 3** | ESP32 Read-Only Driver (Runtime Detection, Chunked Read, Safe Reset, No-Write Assertions) | Queued | `src/drivers/esp32/`, Mock serial tests, `esptool-js` integration |
| **Stage 4** | Hardened Local AVR Companion Agent (CSRF Session Token, Serial Port Whitelist, Safe AVRDUDE) | Queued | `agent/main.py`, Pytest test suite, `src/drivers/uno/` |
| **Stage 5** | Binary Parsers (ESP-IDF Partition Table, ESP Image Header, Intel HEX Roundtrip) & SHA-256 Engine | Queued | `src/parsers/`, unit test suite with corrupted/edge-case fixtures |
| **Stage 6** | Architecture Disassembly (Xtensa LX6 & AVR) & Approximate Pseudocode Engine | Queued | `src/disassemblers/`, confidence rating engine, disassembly view |
| **Stage 7** | Production Dashboard UI (Virtualized Hex View, Secret Redactor, Partition Map, Audit Exporter) | Queued | React dashboard components, Tailwind/CSS styling, UI tests |
| **Stage 8** | Physical Hardware Validation Bench (ESP32 DevKit V1 & Arduino Uno) & Final Release | Queued | Physical run logs, SHA-256 signatures, verification of preserved sensor app |

---

## 2. Hardware Validation Audit Log

> **Strict Verification Standard**: A physical hardware test is recorded **only** after execution against real hardware. Simulated or mocked tests are explicitly recorded as simulated and never conflated with real device validation.

### Physical Target 1: ESP32 DevKit V1
- **Target Role**: Primary test device with pre-installed sensor application (must be preserved).
- **Physical Test Status**: `NOT YET TESTED (Scheduled for Stage 3 & Stage 8)`
- **Observed Physical Evidence**: None recorded yet.
- **Requirements for Pass**:
  1. Runtime identification of chip family, revision, and MAC without hardcoded assumptions.
  2. Automatic detection of Flash capacity via SPI Flash ID.
  3. Non-destructive chunked read of accessible Flash.
  4. Generation of verifiable SHA-256 digest matching exported dump.
  5. Clean hardware reset returning the board to normal boot.
  6. Verified physical sensor output continuing normal operation after extraction.

### Physical Target 2: Arduino Uno R3 (ATmega328P)
- **Target Role**: Secondary target (8-bit AVR).
- **Physical Test Status**: `NOT YET TESTED (Scheduled for Stage 4 & Stage 8)`
- **Observed Physical Evidence**: None recorded yet.
- **Requirements for Pass**:
  1. Device signature verified as `0x1E 0x95 0x0F`.
  2. AVRDUDE execution in read-only mode via companion agent.
  3. Lock-bit audit confirming readout permissions.
  4. Full 32 KiB image capture with reconstructed erased padding labeling.
  5. Verification that installed sketch resumes normal execution.

---

## 3. Automated Test Suite Audit Log

| Test Suite | Scope | Status | Passed / Total |
| :--- | :--- | :---: | :---: |
| **Parser Unit Tests** | Partition table, ESP header, Intel HEX | Queued (Stage 5) | - |
| **Safety Assertions** | Zero write/erase APIs in codebase | Queued (Stage 2) | - |
| **Companion Security Tests**| CSRF token, Origin header, Port whitelist | Queued (Stage 4) | - |
| **Mock Driver Tests** | Simulated Web Serial & AVRDUDE stream | Queued (Stage 3/4)| - |
| **Typecheck & Lint** | TypeScript `strict: true` & Python typing| Queued (Stage 2) | - |
