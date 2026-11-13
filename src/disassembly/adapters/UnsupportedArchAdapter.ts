/**
 * Unsupported Architecture Disassembler Adapter
 * MICROCODE INSPECTOR — STAGE 8
 *
 * Handles architectures that do not yet have a verified offline disassembler backend
 * (such as ESP32-S3 Xtensa LX7 or ESP32-C3/C6 RISC-V).
 *
 * Strict Rule: Never attempt generic disassembly or claim support without a verified backend.
 */

import type {
  ArchitectureDisassembler,
  DisassemblyRequest,
  DisassemblyResult,
} from '../types.ts';
import type { TargetArchitecture } from '../../device/types.ts';
import { formatHexAddress } from '../../utils/address.ts';

export class UnsupportedArchAdapter implements ArchitectureDisassembler {
  readonly architecture: TargetArchitecture;
  readonly displayName: string;
  readonly isSupported = false;
  readonly backendName = 'Unsupported / No Verified Backend';
  readonly backendVersion = 'N/A';

  constructor(architecture: TargetArchitecture) {
    this.architecture = architecture;
    switch (architecture) {
      case 'xtensa-lx7':
        this.displayName = 'ESP32-S3 / Xtensa LX7 (Unsupported Backend)';
        break;
      case 'riscv32':
        this.displayName = 'ESP32-C3 / ESP32-C6 / RISC-V 32-bit (Unsupported Backend)';
        break;
      default:
        this.displayName = `${architecture} (Unsupported Architecture)`;
        break;
    }
  }

  getLimitations(): string[] {
    switch (this.architecture) {
      case 'xtensa-lx7':
        return [
          'ESP32-S3 features the Xtensa LX7 core with vector extensions (PIE - Processor Instruction Extension).',
          'Disassembly requires the dedicated xtensa-esp32s3-elf-objdump toolchain.',
          'Memory address spaces, cache configurations, and MMU segments differ from classic ESP32.',
        ];
      case 'riscv32':
        return [
          'ESP32-C3 and ESP32-C6 feature 32-bit RISC-V cores (RV32IMC / RV32IMAC).',
          'Disassembly requires the riscv32-esp-elf-objdump toolchain with compressed instruction support (RVC).',
          'Interrupt vectors and CSR registers differ fundamentally from Xtensa architectures.',
        ];
      default:
        return [
          `Target architecture '${this.architecture}' does not have a tested disassembly backend in Microcode Inspector.`,
          'Disassembly is disabled to prevent incorrect or misleading output.',
        ];
    }
  }

  async disassemble(request: DisassemblyRequest): Promise<DisassemblyResult> {
    const baseAddress = request.baseAddress ?? 0x0000;
    const requiredTool =
      this.architecture === 'xtensa-lx7'
        ? 'xtensa-esp32s3-elf-objdump'
        : this.architecture === 'riscv32'
          ? 'riscv32-esp-elf-objdump'
          : 'appropriate architecture-specific toolchain';

    return {
      success: false,
      architecture: this.architecture,
      backendName: this.backendName,
      backendVersion: this.backendVersion,
      baseAddress,
      totalInstructions: 0,
      undecodableCount: 0,
      instructions: [],
      confidence: 'unsupported',
      confidenceReason:
        `Architecture '${this.architecture}' is recognized but does not currently have a verified disassembly backend. ` +
        `Disassembly is strictly prevented.`,
      addressBasisExplanation: `Base address provided: ${formatHexAddress(baseAddress, 8)}. Address validation requires verified toolchain support.`,
      limitations: this.getLimitations(),
      warnings: [
        `Architecture '${this.architecture}' cannot be disassembled with current offline toolsets.`,
      ],
      errors: [
        `Disassembly unsupported for architecture '${this.architecture}'.`,
        `Required toolchain: ${requiredTool}`,
      ],
    };
  }
}

