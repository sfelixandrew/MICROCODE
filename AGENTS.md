# AGENTS.md — Permanent Rules for MICROCODE INSPECTOR

## 1. Project Mission & Identity
MICROCODE INSPECTOR is a browser-first, read-only firmware extraction, binary analysis, and disassembly application for embedded microcontrollers over USB.
The initial hardware targets are:
1. **ESP32 DevKit V1** (runtime chip identification; classic ESP32 / Xtensa LX6 or detected variant).
2. **Arduino Uno R3** (ATmega328P / 8-bit AVR).

The core operational goal is safe, non-destructive firmware extraction, verifiable dump storage, partition & binary inspection, architecture-specific disassembly, and approximate pseudocode generation with transparent confidence levels.

---

## 2. Non-Negotiable Technical Truths
Every agent and developer working on this codebase must adhere strictly to these technical realities:
1. **Source Code Distinction**: A compiled firmware dump is **NOT** the original Arduino `.ino`, C, or C++ source code. It has passed through a compiler, assembler, and linker.
2. **Irreversible Loss of Metadata**: Original comments, header includes, macros, preprocessor directives, local variable names, type names, formatting, and project folder hierarchy are permanently lost in compilation unless debugging symbols (DWARF/ELF) were explicitly embedded (which raw Flash images do not contain).
3. **Disassembly vs. Decompilation**: 
   - Disassembly recovers machine instructions into assembly when the architecture, instruction set, and base addresses are known. Assembly is the ground truth.
   - Decompilation generates approximate pseudocode representing reconstructed control flow. Pseudocode is a hypothesis and must always be labeled with uncertainty.
4. **Flash Topology & Memory Segmentation**: A raw Flash dump can contain the bootloader, partition table, NVS (Non-Volatile Storage), PHY calibration, OTA data, application image(s), filesystem (SPIFFS/LittleFS/FAT), padding (`0xFF`), and cryptographic metadata. These regions must never be conflated.
5. **No Blind Assumptions**: Never assume any ESP32 board has 4 MB Flash or an Xtensa LX6 core. Chip family, revision, core architecture, and Flash capacity must be queried and verified at runtime.
6. **Flash Encryption vs. Secure Boot**:
   - Secure Boot verifies cryptographic signatures of images before execution to ensure authenticity. It does **not** encrypt Flash bytes.
   - Flash Encryption encrypts Flash contents using AES-XTS-256 (or AES-128 depending on hardware) to protect confidentiality.
   - If Flash Encryption is enabled, raw readback via UART bootloader returns ciphertext or is prohibited by download mode restrictions. Never claim to decrypt encrypted Flash without valid authorized keys and hardware capabilities.
7. **AVR Lock & Fuse Bit Realities**: ATmega328P lock bits (LB1/LB2) can disable Flash and EEPROM verification/readout via SPI/bootloader. Never issue a chip erase or alter fuse/lock bits to bypass read protection. If readout is blocked, report the limitation honestly and halt.
8. **Arduino Bootloader Variability**: Bootloader readback depends on the installed bootloader (e.g., Optiboot vs. legacy ATmegaBOOT), baud rate, protocol (STK500v1), and lock bit configuration. Never assume universal readback support. External ISP programming is a separate, user-confirmed fallback, never automated.
9. **Execution Interruption Warning**: Entering bootloader mode to read Flash will reset the microcontroller and temporarily stop running firmware. Always warn the user beforehand, preserve installed firmware, and perform a clean reset back to normal user mode when finished.
10. **Evidence-Based Completion**: Never claim a physical hardware test passed unless it was executed on real physical hardware and the evidence (timestamps, chip ID, checksums, logs) is recorded. Simulated/mock tests must be labeled clearly as mocks.
11. **Strict Terminology**: Always use accurate technical terms:
    - `raw Flash dump`
    - `firmware image`
    - `disassembly`
    - `approximate pseudocode`
    - `source recovery limitation`
    Do not use marketing buzzwords like "recovered original source code".

---

## 3. Safety and Security Boundaries
1. **Strict Read-Only Operation (v1)**:
   - Erase, write, reflash, eFuse burn, chip erase, fuse modification, and lock-bit change operations are strictly prohibited.
   - Do not call `writeFlash`, `eraseFlash`, `eraseRegion`, AVRDUDE write arguments (`-U ...:w:...`), or equivalent routines.
   - Automated unit tests must verify statically and dynamically that no write/erase APIs are called.
2. **Local-First Privacy**:
   - Firmware processing must remain 100% client-side/local.
   - No external network requests, cloud telemetry, analytics, remote crash uploads, or remote AI processing of firmware bytes.
3. **Secret Redaction**:
   - Microcontroller Flash often holds Wi-Fi SSIDs/passwords, private keys, authentication tokens, API keys, and device identities.
   - The UI and report generator must include automated local redaction of probable secrets (high-entropy strings, passwords, tokens) with an explicit opt-in view for raw inspection.
4. **Untrusted Binary Handling**:
   - All external firmware bytes, partition tables, Intel HEX files, and device metadata must be treated as untrusted binary input.
   - Enforce rigorous bounds checks, integer overflow prevention, header validation, and error boundaries. Never execute extracted code.
5. **Local Companion Security (Arduino / AVR Helper)**:
   - Must bind strictly to loopback (`127.0.0.1`).
   - Validate HTTP `Origin` header against allowed local frontend origins.
   - Enforce CSRF protection via local session tokens.
   - Subprocess invocations must pass arguments as an explicit array (`subprocess.run(["avrdude", ...])`), **never** `shell=True`.
   - Serial port arguments must be validated against enumerated system serial devices.
   - Never expose arbitrary command execution or access unrelated filesystem paths.

---

## 4. Architectural & Development Standards
1. **Frontend Architecture**:
   - Modern Vite + React + TypeScript single-page application.
   - Accessible, high-contrast dark dashboard with modular panels: Device Connection, Extraction Progress, Hex/ASCII Viewer, Partition Table Inspector, Architecture Disassembler, Pseudocode Explainer, and Audit Report.
2. **Type Safety**:
   - Strict TypeScript (`noImplicitAny`, `strictNullChecks`) and Python type hints (`mypy`).
   - Shared domain models for `DeviceIdentity`, `MemoryRegion`, `ExtractionResult`, `PartitionEntry`, `DisassemblyInstruction`, `PseudocodeBlock`, and `AuditTrail`.
3. **Driver & Adapter Pattern**:
   - Microcontroller targets must implement a standard driver interface (`MicrocontrollerDriver`) with lifecycle hooks: `probe()`, `connect()`, `detectCapacity()`, `readRegion()`, `reset()`, `disconnect()`.
   - Disassemblers must implement an `ArchitectureDisassembler` adapter (Xtensa LX6, AVR, etc.).
4. **Verifiable Data Integrity**:
   - Every read must compute SHA-256 immediately upon reception.
   - Byte count and checksum verification must be executed when saving or exporting files.
   - Export formats supported: Raw Binary (`.bin`) and Intel HEX (`.hex`).
5. **Testing Rigor**:
   - Unit tests for all parsers (ESP-IDF partition table, ESP32 image headers, Intel HEX).
   - Mock transport tests for Web Serial and AVR helper.
   - Static assertion tests verifying absence of destructive APIs.
   - Explicit distinction between mocked tests and physical hardware validation logs.

---

## 5. Working Method & Stage Gate Protocol
Work proceeds sequentially through defined stages. For every stage:
1. Audit repository and current status.
2. Formulate explicit implementation plan with files to create/modify.
3. Identify technical risks, API assumptions, and dependencies.
4. Implement only the current stage.
5. Execute test suite, linting, typechecking, and build validation.
6. Review diffs to guarantee no destructive calls or accidental regressions.
7. Update documentation (`docs/architecture.md`, `docs/limitations.md`, `docs/test-plan.md`, `docs/progress.md`).
8. Deliver transparent summary and wait for user confirmation before advancing to the next stage.
