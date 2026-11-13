/**
 * ESP32 / Xtensa LX6 Disassembler Adapter
 * MICROCODE INSPECTOR — STAGE 8
 *
 * Implements Xtensa LX6 architecture disassembly handling.
 *
 * Technical Realities & Non-Negotiable Standards:
 * 1. Xtensa uses variable-length instruction encodings (16-bit narrow .n instructions and 24-bit standard instructions).
 * 2. PC-relative literal loads (L32R) and calls require precise virtual memory address context.
 *    - IRAM executable code: 0x40080000 – 0x400A0000
 *    - Flash MMU mapped code (IROM): 0x400D0000+
 *    - Flat binary disassembly without --adjust-vma=<base_address> results in erroneous target addresses.
 * 3. Raw Flash dumps are NOT flat executable binaries. They contain bootloaders, partition tables,
 *    NVS, and segmented application images.
 * 4. When the external toolchain (`xtensa-esp32-elf-objdump`) is not present on the system PATH,
 *    this adapter strictly marks itself as `unsupported`, detailing the exact required toolchain,
 *    command-line flags, and architectural segment context.
 */

import type {
  ArchitectureDisassembler,
  DisassemblyRequest,
  DisassemblyResult,
  DisassemblyInstruction,
} from '../types.ts';
import { formatHexAddress } from '../../utils/address.ts';

export interface XtensaToolRunner {
  runObjdump(
    binaryData: Uint8Array,
    baseAddress: number
  ): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

export class XtensaDisassemblerAdapter implements ArchitectureDisassembler {
  readonly architecture = 'xtensa-lx6';
  readonly displayName = 'ESP32 / Xtensa LX6 Disassembler';
  readonly backendName: string;
  readonly backendVersion: string;
  readonly isSupported: boolean;

  private runner: XtensaToolRunner | null = null;

  constructor(runner?: XtensaToolRunner | null) {
    if (runner) {
      this.runner = runner;
      this.isSupported = true;
      this.backendName = 'xtensa-esp32-elf-objdump (Toolchain Runner)';
      this.backendVersion = 'Espressif GNU Binutils (Xtensa LX6)';
    } else {
      this.runner = null;
      this.isSupported = false;
      this.backendName = 'xtensa-esp32-elf-objdump (Missing)';
      this.backendVersion = 'Unavailable';
    }
  }

  getLimitations(): string[] {
    return [
      'Xtensa LX6 uses variable-length 16-bit and 24-bit instructions; instruction boundary alignment depends on entry points.',
      'L32R (Load 32-bit PC-Relative) instructions reference literal pools located at negative offsets. The disassembly base address MUST match the runtime MMU / IRAM address (e.g. 0x40080000 for IRAM or 0x400D0000 for Flash MMU).',
      'Raw Flash dumps must be parsed into application image segments before disassembly. Disassembling raw SPI Flash directly produces nonsensical instructions for data/NVS sectors.',
      'Symbol names, function identifiers, parameter types, and comments are lost during compilation and cannot be recovered from raw Flash images.',
    ];
  }

  async disassemble(request: DisassemblyRequest): Promise<DisassemblyResult> {
    const baseAddress = request.baseAddress ?? 0x40080000;

    const addressBasisExplanation =
      `Address basis: ${formatHexAddress(baseAddress, 8)}. ` +
      `ESP32 executes code from IRAM (0x40080000–0x400A0000) or Flash MMU mapped cache (0x400D0000+). ` +
      `Accurate literal pool resolution (L32R) requires exact segment base address alignment.`;

    if (!this.isSupported || !this.runner) {
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
          'Native Xtensa LX6 toolchain (xtensa-esp32-elf-objdump) is not installed on the system PATH. ' +
          'Disassembly for Xtensa LX6 is strictly disabled to prevent invalid or misleading instruction output.',
        addressBasisExplanation,
        limitations: this.getLimitations(),
        warnings: [
          'Raw Flash image cannot be disassembled as a flat binary without ESP-IDF segment headers.',
          'Missing toolchain: xtensa-esp32-elf-objdump from ESP-IDF toolchain.',
        ],
        errors: [
          'Toolchain xtensa-esp32-elf-objdump not found.',
          'To disassemble Xtensa LX6 binaries offline, install the ESP-IDF toolchain and invoke: ' +
            `xtensa-esp32-elf-objdump -b binary -m xtensa -D --adjust-vma=${formatHexAddress(baseAddress, 8)} <segment.bin>`,
        ],
      };
    }

    try {
      const dataToDisassemble =
        request.offset !== undefined || request.length !== undefined
          ? request.data.subarray(
              request.offset ?? 0,
              (request.offset ?? 0) + (request.length ?? request.data.length)
            )
          : request.data;

      const { stdout, stderr, exitCode } = await this.runner.runObjdump(
        dataToDisassemble,
        baseAddress
      );

      if (exitCode !== 0) {
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
          confidenceReason: `objdump execution failed with exit code ${exitCode}`,
          addressBasisExplanation,
          limitations: this.getLimitations(),
          warnings: stderr ? [stderr] : [],
          errors: [`objdump returned exit code ${exitCode}: ${stderr}`],
        };
      }

      const parsed = this.parseObjdumpOutput(stdout, baseAddress);

      return {
        success: true,
        architecture: this.architecture,
        backendName: this.backendName,
        backendVersion: this.backendVersion,
        baseAddress,
        totalInstructions: parsed.instructions.length,
        undecodableCount: parsed.undecodableCount,
        instructions: parsed.instructions,
        confidence: 'verified',
        confidenceReason:
          'Disassembled via verified xtensa-esp32-elf-objdump with explicit base address alignment.',
        addressBasisExplanation,
        limitations: this.getLimitations(),
        warnings: stderr ? [stderr] : [],
        errors: [],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
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
        confidenceReason: `Exception during disassembly: ${message}`,
        addressBasisExplanation,
        limitations: this.getLimitations(),
        warnings: [],
        errors: [message],
      };
    }
  }

  /**
   * Parses standard GNU objdump -D output for Xtensa.
   *
   * Example lines:
   *  40080000:	f06d      	ret.n
   *  40080002:	004136    	entry	a1, 32
   *  40080005:	fffd81    	l32r	a8, 40080368 <.literal+0x4>
   *  40080008:	000880    	callx8	a8
   *  4008000b:	ffff      	.byte 0xff, 0xff
   */
  public parseObjdumpOutput(
    output: string,
    expectedBaseAddress: number
  ): { instructions: DisassemblyInstruction[]; undecodableCount: number } {
    const lines = output.split(/\r?\n/);
    const instructions: DisassemblyInstruction[] = [];
    const jumpTargets = new Set<number>();
    let undecodableCount = 0;

    // Line regex: hex address followed by ':' then hex opcode bytes, then mnemonic & operands
    // e.g. "  40080002:\t004136    \tentry\ta1, 32"
    const lineRegex = /^\s*([0-9a-fA-F]+):\s+([0-9a-fA-F]{2,8})\s+(.*)$/;

    for (const rawLine of lines) {
      const match = rawLine.match(lineRegex);
      if (!match) continue;

      const addrStr = match[1];
      const hexBytes = match[2].trim();
      const rest = match[3].trim();

      const address = parseInt(addrStr, 16);
      if (isNaN(address)) continue;

      // Split rest into mnemonic and operands/comment
      // e.g. "l32r\ta8, 40080368 <.literal+0x4>"
      // e.g. "entry\ta1, 32"
      // e.g. ".byte 0xff, 0xff"
      const parts = rest.split(/\s+/);
      const mnemonic = parts[0] || '';
      const operandAndComment = parts.slice(1).join(' ');

      let operands = operandAndComment;
      let comment: string | undefined = undefined;

      // Extract objdump comments or annotations e.g. "<.literal+0x4>" or "// comment"
      const commentIdx = operands.indexOf('<');
      if (commentIdx !== -1) {
        comment = operands.substring(commentIdx);
        operands = operands.substring(0, commentIdx).trim();
      }

      const isDecodable = !mnemonic.startsWith('.') && mnemonic !== 'unknown';
      if (!isDecodable) {
        undecodableCount++;
      }

      const isCall =
        mnemonic.startsWith('call') ||
        mnemonic === 'call0' ||
        mnemonic === 'call4' ||
        mnemonic === 'call8' ||
        mnemonic === 'call12' ||
        mnemonic === 'callx0' ||
        mnemonic === 'callx4' ||
        mnemonic === 'callx8' ||
        mnemonic === 'callx12';

      const isReturn =
        mnemonic === 'ret' ||
        mnemonic === 'ret.n' ||
        mnemonic === 'retw' ||
        mnemonic === 'retw.n';

      const isBranch =
        mnemonic.startsWith('b') ||
        mnemonic === 'j' ||
        mnemonic === 'jx' ||
        mnemonic === 'loop' ||
        mnemonic === 'loopnez' ||
        mnemonic === 'loopgtz';

      // Look for target address in operands (e.g. "40080368")
      let jumpTargetAddress: number | undefined = undefined;
      const hexAddrMatch = operands.match(/0x[0-9a-fA-F]+|\b[0-9a-fA-F]{6,8}\b/);
      if (hexAddrMatch && (isBranch || isCall || mnemonic === 'j')) {
        const parsedTarget = parseInt(hexAddrMatch[0], 16);
        if (!isNaN(parsedTarget)) {
          jumpTargetAddress = parsedTarget;
          jumpTargets.add(parsedTarget);
        }
      }

      instructions.push({
        address,
        rawBytesHex: hexBytes,
        mnemonic,
        operands,
        comment,
        isCall,
        isReturn,
        isBranch,
        jumpTargetAddress,
        isDecodable,
      });
    }

    // Mark jump targets
    for (const inst of instructions) {
      if (jumpTargets.has(inst.address)) {
        inst.isJumpTarget = true;
      }
    }

    return { instructions, undecodableCount };
  }
}
