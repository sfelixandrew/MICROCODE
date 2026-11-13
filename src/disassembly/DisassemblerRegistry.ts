/**
 * Disassembler Architecture Registry
 * MICROCODE INSPECTOR — STAGE 8
 *
 * Enforces per-architecture adapter routing.
 * Ensures no generic disassembler is ever applied to mismatched microcontrollers.
 */

import type { TargetArchitecture } from '../device/types.ts';
import type {
  ArchitectureDisassembler,
  DisassemblyRequest,
  DisassemblyResult,
} from './types.ts';
import { AvrDisassemblerAdapter } from './adapters/AvrDisassemblerAdapter.ts';
import {
  XtensaDisassemblerAdapter,
  type XtensaToolRunner,
} from './adapters/XtensaDisassemblerAdapter.ts';
import { UnsupportedArchAdapter } from './adapters/UnsupportedArchAdapter.ts';

export class DisassemblerRegistry {
  private static instance: DisassemblerRegistry | null = null;
  private adapters = new Map<TargetArchitecture, ArchitectureDisassembler>();

  constructor(xtensaRunner?: XtensaToolRunner | null) {
    this.registerDefaults(xtensaRunner);
  }

  public static getInstance(xtensaRunner?: XtensaToolRunner | null): DisassemblerRegistry {
    if (!DisassemblerRegistry.instance) {
      DisassemblerRegistry.instance = new DisassemblerRegistry(xtensaRunner);
    }
    return DisassemblerRegistry.instance;
  }

  private registerDefaults(xtensaRunner?: XtensaToolRunner | null): void {
    // 1. ATmega328P / 8-bit AVR
    this.registerAdapter(new AvrDisassemblerAdapter());

    // 2. ESP32 Classic / Xtensa LX6
    this.registerAdapter(new XtensaDisassemblerAdapter(xtensaRunner));

    // 3. ESP32-S3 / Xtensa LX7 (explicitly unsupported)
    this.registerAdapter(new UnsupportedArchAdapter('xtensa-lx7'));

    // 4. ESP32-C3 / ESP32-C6 / RISC-V (explicitly unsupported)
    this.registerAdapter(new UnsupportedArchAdapter('riscv32'));
  }

  public registerAdapter(adapter: ArchitectureDisassembler): void {
    this.adapters.set(adapter.architecture, adapter);
  }

  public getAdapter(architecture: TargetArchitecture): ArchitectureDisassembler {
    const adapter = this.adapters.get(architecture);
    if (adapter) {
      return adapter;
    }
    // Return an unsupported adapter for any unrecognized architecture
    return new UnsupportedArchAdapter(architecture);
  }

  public getSupportedArchitectures(): {
    architecture: TargetArchitecture;
    displayName: string;
    isSupported: boolean;
    backendName: string;
  }[] {
    const list: {
      architecture: TargetArchitecture;
      displayName: string;
      isSupported: boolean;
      backendName: string;
    }[] = [];

    for (const adapter of this.adapters.values()) {
      list.push({
        architecture: adapter.architecture,
        displayName: adapter.displayName,
        isSupported: adapter.isSupported,
        backendName: adapter.backendName,
      });
    }

    return list;
  }

  public async disassemble(request: DisassemblyRequest): Promise<DisassemblyResult> {
    const adapter = this.getAdapter(request.architecture);
    return adapter.disassemble(request);
  }
}
