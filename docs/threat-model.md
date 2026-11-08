# Threat Model and Security Architecture

## 1. Scope & Objective
MICROCODE INSPECTOR operates at the intersection of web browsers, native host operating system utilities, and physical embedded hardware. This document outlines the threat model, assets, trust boundaries, threat scenarios (STRIDE), and architectural mitigations.

---

## 2. Assets & Security Objectives

| Asset | Primary Threat | Security Objective |
| :--- | :--- | :--- |
| **Installed Device Firmware** | Accidental overwrite, erase, corruption, or bricking | Strict read-only guarantee. Zero write/erase APIs implemented or invoked. |
| **Hardware eFuses & Lock Bits** | Irreversible fuse burning or lock bit destruction | Zero eFuse or lock bit programming capability. Halts on lock bit restriction. |
| **User Embedded Secrets** | Exposure of Wi-Fi credentials, API keys, or private keys | 100% local processing. Automatic client-side secret detection and redaction. |
| **Host System Execution** | Arbitrary code execution or host compromise via companion | Restricted loopback API, strict input validation, no `shell=True`, isolated subprocesses. |
| **Frontend Application** | Cross-Site Request Forgery (CSRF) or DNS Rebinding | Origin validation, loopback restriction, and ephemeral session token enforcement. |

---

## 3. Trust Boundaries

```
[ Untrusted External Internet / Web ]
  │
  ├─── (Blocked: No external telemetry, no remote servers, no cloud APIs)
  │
[ Browser Client Context (Chrome / Edge) ]
  │
  ├─── (Trust Boundary 1: Local Loopback HTTP with Origin & Session Token)
  │
[ Local AVR Companion (127.0.0.1:8765) ]
  │
  ├─── (Trust Boundary 2: Subprocess Execution with Array Arguments & Port Whitelist)
  │
[ Native Host Binaries (AVRDUDE CLI) ]
  │
  ├─── (Trust Boundary 3: Physical USB CDC / UART Serial Connection)
  │
[ Microcontroller Non-Volatile Flash Memory ]
```

---

## 4. Threat Analysis (STRIDE) & Mitigations

### 1. Spoofing & Cross-Site Request Forgery (CSRF)
- **Threat**: A malicious website visited in another browser tab attempts to send HTTP requests to `http://127.0.0.1:8765/read/uno` to probe hardware or dump device memory.
- **Mitigations**:
  1. The Python helper binds strictly to `127.0.0.1` (never `0.0.0.0`).
  2. CORS middleware strictly enforces allowed origins (`http://localhost:5173`, `http://127.0.0.1:5173`).
  3. Every companion session generates an ephemeral cryptographically secure session token (`secrets.token_urlsafe(32)`). The frontend must supply this in the `X-MicroCode-Session` HTTP header for every request. Requests without a matching token are rejected with HTTP 403 Forbidden.

### 2. Tampering & Command Injection
- **Threat**: Malicious input in the `port` field (e.g. `COM5; rm -rf /` or `COM1 && calc.exe`) executes arbitrary commands on the host OS.
- **Mitigations**:
  1. Subprocess execution **never** uses `shell=True`. Arguments are passed strictly as discrete argument arrays: `["avrdude", "-p", "atmega328p", "-c", "arduino", "-P", port, ...]`.
  2. The `port` string is validated against active hardware serial ports enumerated via `serial.tools.list_ports.comports()`. If the requested port is not an active physical/virtual serial port on the system, the request is rejected immediately.

### 3. Accidental Device Modification (Integrity Loss)
- **Threat**: A software bug or unintended flag causes the extraction routine to erase Flash, overwrite bootloader sectors, or alter configuration fuses.
- **Mitigations**:
  1. `esptool-js`: The codebase strictly excludes any invocation of `writeFlash`, `eraseFlash`, `eraseRegion`, or register write routines that alter Flash or eFuses.
  2. AVRDUDE: Arguments are hardcoded to read-only memory directives (`-U flash:r:...:i` and `-U lock:r:...:m`). No write (`:w:`) or chip-erase (`-e`) flags exist in the codebase.
  3. Continuous testing includes static and dynamic assertions confirming zero write/erase routines are imported or called.

### 4. Information Disclosure of Embedded Secrets
- **Threat**: Firmware dumps often contain embedded Wi-Fi SSIDs, WPA2 pre-shared keys, AWS tokens, RSA private keys, or MQTT passwords. Displaying or exporting these carelessly exposes credentials.
- **Mitigations**:
  1. All extraction and analysis are executed 100% locally in the browser and loopback agent. Zero telemetry or remote uploads.
  2. A local secret scanning engine runs regex checks (patterns for PEM private keys, AWS access keys, high-entropy tokens, Wi-Fi credentials) across extracted strings.
  3. Secrets are redacted by default in UI hex views, string tables, and exported audit summaries, requiring an explicit user opt-in to reveal.

### 5. Denial of Service & Malicious Binary Payloads
- **Threat**: Corrupted Flash or a maliciously crafted binary causes integer overflows, memory exhaustion, or browser tab freezes during parsing and disassembly.
- **Mitigations**:
  1. Binary parsers strictly validate boundary conditions: segment sizes, table lengths, and record bounds before reading slices.
  2. Disassemblers operate with strict loop iteration limits and address range bounds.
  3. The hex viewer uses virtualization, rendering only the visible viewport rather than the entire multi-megabyte binary.
