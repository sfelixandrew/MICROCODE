# Security & Privacy Threat Model (MICROCODE INSPECTOR)

## 1. Scope and Mission
MICROCODE INSPECTOR operates at the critical boundary between web browser sandboxes, local host operating system utilities, and physical embedded hardware over USB. This document provides a formal STRIDE threat modeling analysis, identifies protected assets and trust boundaries, and specifies the defensive architecture ensuring hardware safety, host security, and user data privacy.

---

## 2. Asset Inventory & Protection Objectives

| Asset | Sensitivity | Primary Threat | Architectural Countermeasure |
| :--- | :--- | :--- | :--- |
| **Installed Target Firmware** | Critical | Accidental erase, overwrite, or corruption | Strict read-only architecture. Automated tests assert zero write/erase routines. |
| **Microcontroller eFuses & Lock Bits** | Critical | Permanent hardware lockout or bricking | Zero fuse-burning or chip-erase functionality. Halts immediately on lock bit restriction. |
| **Embedded User Secrets** | High | Unintended disclosure of Wi-Fi credentials, private keys, or API tokens | 100% client-side execution (zero cloud telemetry). Automated regex redactor masks secrets by default. |
| **Host System Execution** | High | Command injection or unauthorized subprocess execution via companion | Subprocesses use discrete argument arrays (no `shell=True`). Port parameter validated against enumerated hardware ports. |
| **Local Companion API** | High | Cross-Site Request Forgery (CSRF) or DNS Rebinding from malicious web pages | Loopback binding only (`127.0.0.1`), CORS origin validation, and ephemeral `X-MicroCode-Session` token check. |
| **Browser Application Integrity** | Medium | Memory exhaustion or DOM freezing from corrupted binary dumps | Virtualized hex viewer rendering only visible lines. Chunked streaming with bounded memory buffers. |

---

## 3. Trust Boundaries & Data Flow

```
[ UNTRUSTED: External Web / Public Internet ]
       │
       ✕ (BLOCKED: Zero external telemetry, zero remote servers, zero cloud AI calls)
       │
[ BROWSER RUNTIME: Desktop Chrome / Edge Sandbox ]
       │
       │ (Trust Boundary 1: Loopback HTTP with Origin & Session Token)
       ▼
[ LOCAL COMPANION: FastAPI on 127.0.0.1:8765 ]
       │
       │ (Trust Boundary 2: Subprocess Execution with Array Arguments & Port Whitelist)
       ▼
[ HOST SYSTEM: Native AVRDUDE CLI Utility ]
       │
       │ (Trust Boundary 3: Physical USB CDC / UART Serial Connection)
       ▼
[ PHYSICAL MICROCONTROLLER: Flash Memory / ROM Bootloader ]
```

---

## 4. Threat Analysis (STRIDE) & Mitigations

### 1. Spoofing & Cross-Site Request Forgery (CSRF)
- **Threat Vector**: A user browses an untrusted website in another browser tab while the local AVR companion agent is running on port 8765. The malicious page issues cross-origin `POST` requests to `http://127.0.0.1:8765/read/uno` to trigger unauthorized hardware reads or probe host serial ports.
- **Mitigations**:
  1. **Strict Loopback Binding**: The FastAPI server binds strictly to `127.0.0.1` (never `0.0.0.0`).
  2. **CORS Origin Validation**: Middleware enforces that requests originate exclusively from `http://localhost:5173` or `http://127.0.0.1:5173`.
  3. **Ephemeral Session Tokens**: At startup, the companion generates a cryptographically secure 32-byte session token (`secrets.token_urlsafe(32)`). The frontend must send this token in the `X-MicroCode-Session` HTTP header. Any request lacking a valid token is rejected with HTTP 403 Forbidden.

### 2. Tampering & Command Injection
- **Threat Vector**: An attacker supplies malicious shell metacharacters in the serial port input field (e.g., `COM5; rm -rf /` or `COM1 && calc.exe`) attempting arbitrary command execution on the host operating system.
- **Mitigations**:
  1. **Zero Shell Execution**: Python subprocesses are invoked strictly with discrete argument vectors (`subprocess.run([...], shell=False)`). The shell interpreter is never spawned.
  2. **Hardware Serial Port Whitelisting**: The requested port string is cross-referenced against active system serial ports enumerated via `serial.tools.list_ports.comports()`. If the port does not match an authentic physical/virtual serial device, the request is immediately rejected.
  3. **Strict Alphanumeric Validation**: Port names must match regex `^[A-Za-z0-9_./:-]+$`.

### 3. Repudiation & Data Integrity Loss
- **Threat Vector**: A read operation suffers serial transmission corruption, leading to a modified or corrupted firmware dump being saved without detection.
- **Mitigations**:
  1. **Immediate Cryptographic Hashing**: Upon receiving raw byte streams, the SHA-256 digest is calculated immediately in the browser using the Web Crypto API (`crypto.subtle.digest`).
  2. **Audit Trail Recording**: Every extraction records device identity, timestamp, byte count, address range, and SHA-256 digest in a verifiable audit record.
  3. **Export Verification**: When exporting `.bin` or `.hex` files, the byte count and checksum of the exported blob are verified against the captured buffer.

### 4. Information Disclosure (Embedded Secrets Privacy)
- **Threat Vector**: Microcontroller Flash dumps frequently contain embedded Wi-Fi SSIDs, WPA2 passwords, AWS/cloud credentials, RSA private keys, or internal API tokens. Exporting or displaying dumps carelessly could compromise the user's infrastructure.
- **Mitigations**:
  1. **Local-Only Processing**: All extraction, partition parsing, disassembly, and report generation take place 100% locally. Zero firmware bytes or metadata are uploaded anywhere.
  2. **Automated Secret Scanner**: An embedded regex engine scans extracted printable ASCII/UTF-8 strings for sensitive patterns:
     - Wi-Fi credentials (`ssid`, `password`, `psk`, `wpa`)
     - Cloud API keys (AWS `AKIA...`, Google API keys, Generic Bearer tokens)
     - Cryptographic keys (`-----BEGIN PRIVATE KEY-----`)
  3. **Masked by Default**: Detected secrets are masked in the UI hex view, string tables, and generated audit reports with placeholder strings (`[REDACTED_SECRET]`). Unmasking requires deliberate, opt-in user confirmation.

### 5. Denial of Service (Device & Host Freezing)
- **Threat Vector**: Corrupted Flash images or malformed partition tables trigger infinite loops, memory exhaustion, or browser tab freezes during parsing or disassembly.
- **Mitigations**:
  1. **Bounds-Checked Parsing**: All binary parsers validate length headers, entry counts, and segment offsets against the actual buffer length before performing byte slices.
  2. **Virtualized Rendering**: The hex viewer uses viewport virtualization, rendering only the ~40 rows currently visible on screen rather than instantiating DOM nodes for millions of bytes.
  3. **Disassembly Execution Limits**: Instruction decoding loops enforce maximum instruction counts and bounded address ranges.

### 6. Elevation of Privilege (Hardware Safety Violation)
- **Threat Vector**: An operator inadvertently triggers a command that writes to Flash, alters eFuses, modifies lock bits, or clears memory.
- **Mitigations**:
  1. **Complete Absence of Write APIs**: The application contains no flash write (`writeFlash`), flash erase (`eraseFlash`, `eraseRegion`), or chip erase (`-e`) routines.
  2. **Static Assertion Testing**: Automated CI tests inspect the abstract syntax tree (AST) and string tokens across the codebase to fail the build if any write or erase directive is introduced.
  3. **Clear Limitation Disclosures**: If hardware security (Flash Encryption or AVR Lock Bits) prevents readout, the application reports the boundary honestly and halts rather than attempting destructive bypass techniques.
