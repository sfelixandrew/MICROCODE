# Architecture Specification: MICROCODE INSPECTOR

## 1. System Overview & Component-Level Architecture

MICROCODE INSPECTOR is structured as a browser-first, modular embedded reverse-engineering platform. It is engineered with a strict separation of concerns across communication transports, device drivers, binary analysis engines, disassembly modules, and presentation layers.

```mermaid
flowchart TD
    subgraph BrowserClient ["Web Browser (Desktop Chromium: Chrome / Edge)"]
        subgraph UI ["Presentation Layer (Vite + React + TypeScript)"]
            Dashboard["Inspector Dashboard Shell"]
            DeviceSelector["Device Target & Port Controller"]
            ProgressBar["Live Progress & Range Reporter"]
            HexViewer["Virtualized Hex & ASCII Inspector"]
            PartitionView["Partition Table & Region Map"]
            DisasmView["Architecture Disassembly View"]
            PseudoView["Approximate Logic & Pseudocode View"]
            AuditReport["Verifiable Audit Trail & Report Exporter"]
        end

        subgraph CoreEngine ["Firmware Processing & Analysis Engine"]
            IntegrityEngine["SHA-256 Cryptographic Hash Engine"]
            PartitionParser["ESP-IDF Partition Table Parser"]
            EspImageParser["ESP Application Image Parser"]
            AvrMapParser["AVR Memory Map & Vector Parser"]
            SecretDetector["Local Secret Detector & Redactor"]
            DisasmEngine["Architecture Disassembler Dispatcher"]
            IntelHexEngine["Intel HEX Encoder & Reconstitution"]
        end

        subgraph DriverLayer ["Device Driver Abstraction Layer"]
            IDriver["IDeviceDriver Interface"]
            Esp32Driver["ESP32 Driver (esptool-js Adapter)"]
            UnoDriver["Arduino Uno Driver (Companion Client)"]
        end

        subgraph TransportLayer ["Hardware Transport Layer"]
            WebSerial["Web Serial API Transport"]
            CompanionClient["Authenticated Local REST Client"]
        end
    end

    subgraph LocalHost ["Local Host System (127.0.0.1)"]
        subgraph LocalCompanion ["Local AVR Companion Agent (FastAPI)"]
            FastAPI["FastAPI Loopback Server (:8765)"]
            SessionGuard["CSRF & Session Token Validator"]
            PortEnumerator["System Serial Port Enumerator (pyserial)"]
            AvrdudeSubproc["AVRDUDE CLI Wrapper (Read-Only Array Args)"]
        end
        AvrdudeCLI["Host AVRDUDE Executable"]
    end

    subgraph PhysicalHardware ["Physical USB Microcontrollers"]
        ESP32DevKit["ESP32 DevKit V1 (USB-UART / CP2102 / CH340)"]
        ArduinoUno["Arduino Uno R3 (ATmega328P + 16U2/CH340)"]
    end

    %% Wiring UI to Drivers
    Dashboard --> DeviceSelector
    DeviceSelector --> IDriver
    IDriver --> Esp32Driver
    IDriver --> UnoDriver
    
    %% Transport connections
    Esp32Driver --> WebSerial
    WebSerial -->|Web Serial API / Exclusive Port Lock| ESP32DevKit
    
    UnoDriver --> CompanionClient
    CompanionClient -->|HTTP / X-MicroCode-Session Header| FastAPI
    FastAPI --> SessionGuard
    SessionGuard --> PortEnumerator
    PortEnumerator --> AvrdudeSubproc
    AvrdudeSubproc --> AvrdudeCLI
    AvrdudeCLI -->|STK500v1 / 115200 Baud| ArduinoUno
    
    %% Data Flow to Core Engine
    WebSerial -->|Raw Byte Stream| IntegrityEngine
    CompanionClient -->|Intel HEX Stream| IntelHexEngine
    IntelHexEngine -->|Reconstituted Binary| IntegrityEngine
    
    IntegrityEngine --> PartitionParser
    IntegrityEngine --> EspImageParser
    IntegrityEngine --> AvrMapParser
    IntegrityEngine --> SecretDetector
    IntegrityEngine --> DisasmEngine

    %% Engine to Views
    PartitionParser --> PartitionView
    EspImageParser --> PartitionView
    AvrMapParser --> PartitionView
    IntegrityEngine --> HexViewer
    SecretDetector --> HexViewer
    DisasmEngine --> DisasmView
    DisasmEngine --> PseudoView
    IntegrityEngine --> AuditReport
```

---

## 2. Technology & Dependency Decision Record (ADR)

| Component | Selected Technology | Alternative Evaluated | Decision Rationale |
| :--- | :--- | :--- | :--- |
| **Frontend Framework** | **React 19 + TypeScript** | Vanilla JS / Svelte | Multi-region state, virtualized hex grids, multi-tab binary views, and strict typing of binary bitfields necessitate declarative components and compile-time type safety. |
| **Bundler & Build Tool**| **Vite 6** | Webpack / Parcel | Instant HMR, native ES modules, lightweight configuration, and direct compatibility with Web Serial and Web Workers. |
| **Test Runner** | **Vitest 3** | Jest / Mocha | Native Vite pipeline integration, blazing-fast execution, TypeScript support without Babel overhead, and node-compatible Web Crypto mocks. |
| **ESP32 Communication**| **esptool-js (0.7.1)** | Custom Web Serial ROM implementation | Official Espressif library containing validated ROM reset sequences, software stub flasher, chip magic detection, and SPI Flash ID decoding. |
| **AVR Extraction Method**| **Local Python Helper + AVRDUDE** | In-browser Web Serial STK500v1 | Optiboot DTR/RTS auto-reset timing over Web Serial in JavaScript is unreliable across varied host OS drivers. Native AVRDUDE provides battle-tested STK500v1 protocol implementation and precise DTR pulse handling. |
| **Companion Server** | **FastAPI + Uvicorn** | Node.js Express / Go binary | Python provides lightweight syntax, built-in subprocess management, `pyserial` hardware device enumeration, and clean type annotations via Pydantic. |
| **Integrity Hashing** | **Web Crypto API (`crypto.subtle`)** | CryptoJS / js-sha256 | Native hardware-accelerated SHA-256 implementation available in modern browsers without third-party bundle bloat. |
| **Styling & UI Shell** | **Scoped Modern CSS** | Tailwind CSS / Bootstrap | Zero dependency runtime footprint, high contrast dark theme optimized for technical binary inspection, and predictable rendering without external CDN lookups. |

---

## 3. Data-Flow Diagram: ESP32 Firmware Extraction

The ESP32 extraction pipeline operates entirely browser-side over the W3C Web Serial API:

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant UI as Dashboard UI
    participant Driver as Esp32Driver
    participant Transport as WebSerial Transport
    participant Loader as esptool-js ESPLoader
    participant Chip as Physical ESP32 DevKit V1
    participant Integrity as Integrity Engine (SHA-256)
    participant Parsers as Partition & Image Parsers

    User->>UI: Select ESP32 & Click "Connect"
    UI->>Driver: connect()
    Driver->>Transport: navigator.serial.requestPort()
    Transport->>User: Browser Port Picker Dialog
    User->>Transport: Selects USB Serial Port (e.g. CP2102)
    Transport->>Chip: Open port (115200 baud)
    Driver->>Loader: ESPLoader.main()
    Loader->>Chip: DTR/RTS Reset Sequence into ROM Bootloader
    Note over Chip: Microcontroller enters ROM bootloader mode
    Chip-->>Loader: Sync response packet
    Loader->>Chip: Upload & Execute Flasher Stub in IRAM
    Chip-->>Loader: Stub active confirmation
    Loader->>Driver: Chip identified (e.g. "ESP32 (revision v3.0)")
    
    Driver->>Loader: getSecurityInfo()
    Loader->>Chip: Opcode 0x14 (GET_SECURITY_INFO)
    Chip-->>Loader: Flash Crypt Count & Secure Download flags
    
    Driver->>Loader: detectFlashSize()
    Loader->>Chip: Read SPI Flash RDID (Opcode 0x9F)
    Chip-->>Loader: Flash ID -> Mapped size (e.g. 4 MB / 4,194,304 bytes)
    Driver-->>UI: Display chip identity, security flags, & detected Flash size
    
    User->>UI: Click "Read Flash"
    UI->>Driver: readRegion(0x0, 4194304)
    loop Stream in 64 KiB Chunks
        Driver->>Loader: readFlash(offset, length)
        Loader->>Chip: ESP_READ_FLASH packets
        Chip-->>Loader: Raw Flash Byte Packets
        Loader-->>Driver: Chunk Uint8Array
        Driver-->>UI: Progress (offset, range, percentage)
    end
    
    Driver->>Integrity: computeDigest(rawBytes)
    Integrity-->>Driver: SHA-256 Digest Hex
    
    Driver->>Loader: after("hard_reset")
    Loader->>Chip: Pulse EN/RTS to reboot chip
    Note over Chip: Microcontroller resumes normal user application
    
    Driver->>Parsers: parsePartitionTable(rawBytes)
    Parsers-->>UI: Partitions (nvs, otadata, app, spiffs)
    Driver->>Parsers: parseAppHeader(rawBytes)
    Parsers-->>UI: App image metadata, entry point, segments
    Driver-->>UI: Update Hex View, Statistics, and Enable Verified Download
```

---

## 4. Data-Flow Diagram: Arduino Uno (AVR) Extraction

The Arduino Uno pipeline leverages the hardened local loopback companion to drive AVRDUDE:

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant UI as Dashboard UI
    participant UnoDriver as ArduinoUnoDriver
    participant Companion as Local Companion (127.0.0.1:8765)
    participant Avrdude as AVRDUDE CLI
    participant Uno as Physical Arduino Uno (ATmega328P)
    participant Reconstitution as Reconstitution & Integrity Engine

    User->>UI: Select Arduino Uno & Click "Query Ports"
    UI->>UnoDriver: getAvailablePorts()
    UnoDriver->>Companion: GET /ports (Header: X-MicroCode-Session)
    Companion-->>UnoDriver: Enumerated physical COM ports (e.g. ["COM5"])
    UnoDriver-->>UI: Populate Port Dropdown

    User->>UI: Select "COM5" & Click "Read Flash"
    UI->>UnoDriver: readFlash("COM5")
    UnoDriver->>Companion: POST /read/uno { port: "COM5", baud: 115200 }
    
    Note over Companion: Validate Origin & Session Token
    Note over Companion: Verify "COM5" exists in enumerated physical ports
    
    Companion->>Avrdude: subprocess.run(["avrdude", "-p", "atmega328p", "-c", "arduino", "-P", "COM5", "-b", "115200", "-U", "lock:r:...:h", "-U", "flash:r:...:i"])
    Avrdude->>Uno: Toggle DTR to enter Optiboot
    Note over Uno: Microcontroller enters Optiboot bootloader
    Avrdude->>Uno: STK_GET_SYNC & Signature query
    Uno-->>Avrdude: Signature 0x1E 0x95 0x0F (ATmega328P)
    Avrdude->>Uno: STK_READ_PAGE (Flash pages 0x0000 - 0x7FFF)
    Uno-->>Avrdude: Flash bytes (32 KiB)
    Avrdude-->>Companion: Intel HEX file + Lock bits
    
    Companion-->>UnoDriver: JSON { hexRecords: "...", lockBits: "0x3F", signature: "0x1E950F" }
    
    UnoDriver->>Reconstitution: parseAndReconstitute(hexRecords, 32768)
    Note over Reconstitution: Reconstruct 32 KiB buffer; tag unwritten trailing bytes as ERASED (0xFF)
    Reconstitution->>Reconstitution: Calculate SHA-256
    Reconstitution-->>UnoDriver: Verifiable 32 KiB Dump + SHA-256
    
    UnoDriver-->>UI: Display Memory Map (Vectors, App, Bootloader), Hex, and Verified Download
```

---

## 5. Architectural Security Boundaries

1. **Client Isolation**: The browser frontend runs strictly client-side. No remote cloud endpoints, analytics, or telemetry exist.
2. **Loopback Protection**: The Python companion binds exclusively to `127.0.0.1`. Requests require validation of the `Origin` header against `http://localhost:5173` and the presence of an ephemeral `X-MicroCode-Session` token generated at companion boot.
3. **Serial Argument Whitelisting**: Subprocess calls avoid `shell=True`. Ports are cross-referenced with `serial.tools.list_ports.comports()`, rejecting arbitrary device paths or injected characters.
4. **Strict Read-Only Enforcement**: Neither the TypeScript codebase nor the Python companion contains routines or command flags for flash writing (`:w:`), flash erasing (`eraseFlash`, `eraseRegion`), or chip erasure (`-e`).
