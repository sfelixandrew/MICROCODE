# Comprehensive Test Plan: MICROCODE INSPECTOR

## 1. Testing Philosophy & Verification Standards

To guarantee hardware safety, cryptographic integrity, and technical transparency, MICROCODE INSPECTOR enforces strict testing disciplines:
1. **Never Falsify Hardware Evidence**: Simulated or mock tests must **never** be reported as physical hardware tests. A physical hardware test is only marked complete when executed against an authentic physical microcontroller and the verification evidence (serial log, chip ID, SHA-256 digest, timestamp) is logged.
2. **Zero-Destructive API Verification**: Automated test suites must continuously assert that no flash erase, flash write, or fuse modification APIs are invoked.
3. **100% Deterministic Unit Testing**: Binary parsers, checksum routines, address arithmetic, and Intel HEX converters must be covered with edge-case test vectors including truncated, corrupted, and malformed inputs.

---

## 2. Test Pyramid & Categorization

```
               ▲
              / \
             /   \      Physical Hardware Bench (Stage 12)
            /     \     - ESP32 DevKit V1: Read-only dump & sensor app preservation
           /-------\    - Arduino Uno R3: Signature check, readback & lock audit
          /         \
         /           \   Mocked Transport & Subprocess Integration Tests (Stages 3-6)
        /             \  - Mock Web Serial packet streams & progress updates
       /---------------\ - Mock AVRDUDE subprocess failure/success/timeout
      /                 \
     /                   \ Unit Tests & Static Safety Assertions (Stages 2, 7, 8, 9, 10)
    /                     \- Binary parsers (Partition table, ESP header, Intel HEX)
   /-----------------------\- Static safety check: ZERO write/erase APIs in codebase
```

---

## 3. Test Suites

### Suite A: Binary Parsers & Memory Arithmetic (Unit Tests)
- **ESP-IDF Partition Table Parser**:
  - Test A1: Valid 2-partition table (nvs, factory app) at `0x8000`.
  - Test A2: Multi-partition table with OTA partitions, SPIFFS, and coredump.
  - Test A3: Partition table with invalid magic (corrupted bytes instead of `0xAA50`).
  - Test A4: Truncated partition table (under 32 bytes).
  - Test A5: Erased partition space (`0xFF` fill).
  - Test A6: Partition table offset out-of-bounds handling.
- **ESP Application Image Header Parser**:
  - Test B1: Valid header (magic `0xE9`, 3 segments, entry point in IRAM `0x40080698`).
  - Test B2: Header with invalid magic byte (not `0xE9`).
  - Test B3: Corrupted segment count (> 16).
  - Test B4: Segment length exceeding available image buffer.
  - Test B5: Trailing SHA-256 validation (ESP-IDF v3.0+ format).
- **Intel HEX & Memory Map Engine**:
  - Test C1: Record type 00 (Data) decoding and address mapping.
  - Test C2: Record type 04 (Extended Linear Address) high-order address shifting.
  - Test C3: Checksum calculation and mismatch detection.
  - Test C4: Trailing erased byte padding (`0xFF`) reconstruction for ATmega328P.
  - Test C5: Round-trip test: Raw binary -> Intel HEX -> Raw binary roundtrip verification.
- **Secret Redactor Engine**:
  - Test D1: Detection of Wi-Fi credentials (e.g. `WIFI_SSID`, `wifi_password`, `psk=...`).
  - Test D2: Detection of AWS keys (`AKIA...`), private keys (`-----BEGIN PRIVATE KEY-----`).
  - Test D3: Verification that redacted view masks secrets while retaining underlying dump fidelity.

### Suite B: Safety & Read-Only Assertions
- **Static Code AST & Grep Check**:
  - Verify zero references to `writeFlash`, `eraseFlash`, `eraseRegion` across all TypeScript modules.
  - Verify zero occurrences of write modes in AVRDUDE invocations (`:w:` or `-e` chip erase).
  - Verify `shell=True` is never passed to Python `subprocess`.
- **Dynamic Prohibitions**:
  - Ensure driver mocks throw immediate fatal errors if an unauthorized command opcode is requested.

### Suite C: Companion Agent Integration Tests (Pytest)
- **Endpoint Security**:
  - Test E1: Rejection of cross-origin requests from disallowed origins.
  - Test E2: Enforcement of `X-MicroCode-Session` token (403 Forbidden on missing/invalid token).
  - Test E3: Strict loopback binding validation (`127.0.0.1`).
- **Serial Port Sanitization**:
  - Test F1: Rejection of port names containing shell characters (`;`, `&`, `|`, `` ` ``).
  - Test F2: Rejection of non-existent serial ports not present in enumerated device list.
- **AVRDUDE Error Handling**:
  - Test G1: Handling when `avrdude` executable is missing from PATH (returns friendly instructions).
  - Test G2: Handling subprocess timeout (exceeding 90 seconds).
  - Test G3: Handling non-zero return code (device signature mismatch, lock bit block).

### Suite D: Mock Transport Integration Tests
- **Web Serial Mocking**:
  - Mock `SerialPort`, `ReadableStream`, and `WritableStream`.
  - Simulate packet stream for `esptool-js` chip sync, `detectFlashSize()`, and `readFlash()`.
  - Verify progress callbacks update accurately and monotonically from 0% to 100%.

### Suite E: Physical Hardware Validation Protocols (Manual Device Bench)

#### Protocol 1: ESP32 DevKit V1 (Installed Sensor Application)
> **Goal**: Perform read-only dump, verify chip identity and flash size, calculate SHA-256, and confirm the existing sensor application continues running without corruption.
1. Connect ESP32 DevKit V1 to workstation USB port.
2. Observe serial monitor or physical sensor output before test to verify normal application operation.
3. Open MICROCODE INSPECTOR in Google Chrome.
4. Select ESP32 target and initiate connection.
5. Verify detected chip: Chip model, revision, MAC address, and Flash capacity.
6. Trigger read-only extraction of first 256 KiB test slice, then full detected flash.
7. Observe extraction progress, address ranges, and final SHA-256 computation.
8. Download `.bin` dump; verify file size matches detected flash bytes.
9. Verify device reset to normal boot; observe physical sensor resume active telemetry without re-flashing.
10. Record serial log, chip metadata, and SHA-256 in `docs/progress.md`.

#### Protocol 2: Arduino Uno R3 (ATmega328P)
> **Goal**: Perform read-only dump via AVR companion, verify device signature, and confirm application preservation.
1. Connect Arduino Uno R3 via USB.
2. Launch local AVR companion agent.
3. Open MICROCODE INSPECTOR in browser, select Arduino Uno.
4. Verify port enumeration detects board port.
5. Initiate read; observe companion execute read-only AVRDUDE command.
6. Verify device signature `0x1E 0x95 0x0F` (ATmega328P).
7. Confirm 32,768 byte dump generated with SHA-256 checksum.
8. Confirm board resets to normal execution.

---

## 4. Test Execution Commands

```bash
# Frontend Unit Tests & Safety Checks
npm run test

# Frontend TypeScript Typecheck
npm run typecheck

# Frontend Production Build Check
npm run build

# Python Companion Unit & Security Tests
cd agent
pytest -v
```
