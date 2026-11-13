/**
 * Traceable Approximate Pseudocode Generator
 * MICROCODE INSPECTOR
 *
 * Generates approximate pseudocode reconstructed from verified disassembly.
 * Strictly adheres to non-negotiable transparency and reverse-engineering boundaries.
 *
 * Non-Negotiable Standards:
 * 1. Prominently labeled "approximate reconstruction" or "inferred pseudocode".
 * 2. Every statement links back to exact assembly addresses [0x...].
 * 3. Confirmed machine facts are strictly separated from inferred high-level meanings.
 * 4. Strictly uses synthetic names (func_00001234, var_1, var_r16). Never invents symbols.
 * 5. Undecodable/unknown instruction regions remain explicitly unknown.
 * 6. Discloses all missing information (erased variable names, macros, comments).
 */

import type { FunctionBoundary, PseudocodeBlock, AssemblyTraceMapping, SyntheticVariable } from '../types.ts';
import type { TargetArchitecture } from '../../device/types.ts';
import { formatHexAddress } from '../../utils/address.ts';

export class PseudocodeGenerator {
  public static generateBlock(
    fn: FunctionBoundary,
    architecture: TargetArchitecture
  ): PseudocodeBlock {
    const lines: string[] = [];
    const traceMappings: AssemblyTraceMapping[] = [];
    const syntheticVariables: SyntheticVariable[] = [];
    const usedRegisters = new Set<string>();

    const startAddrHex = formatHexAddress(fn.entryAddress, 6);
    const endAddrHex = formatHexAddress(fn.endAddress, 6);

    // Identify synthetic variables from registers used
    for (const block of fn.basicBlocks) {
      for (const inst of block.instructions) {
        const regMatches = inst.operands.match(/\br(?:[0-9]|[12][0-9]|3[01])\b|\ba(?:[0-9]|1[0-5])\b/g);
        if (regMatches) {
          for (const reg of regMatches) {
            if (!usedRegisters.has(reg)) {
              usedRegisters.add(reg);
              syntheticVariables.push({
                name: `var_${reg}`,
                registerOrMemory: reg,
                inferredType: 'uint8_t',
                firstUsedAtAddress: inst.address,
                purpose: `Synthetic variable mapped to CPU hardware register ${reg}`,
              });
            }
          }
        }
      }
    }

    // Step 1: Banner Header (Non-Negotiable Mandatory Labeling & Disclosures)
    lines.push('// ==============================================================================');
    lines.push('// [APPROXIMATE RECONSTRUCTION / INFERRED PSEUDOCODE]');
    lines.push(`// Function: ${fn.name}`);
    lines.push(`// Address Range: ${startAddrHex} – ${endAddrHex} (${fn.instructionCount} instructions)`);
    lines.push(`// Reconstruction Confidence: ${fn.confidence.toUpperCase()} (Score: ${(fn.confidenceScore * 100).toFixed(0)}%)`);
    lines.push('//');
    lines.push('// EVIDENCE & PROVENANCE:');
    for (const reason of fn.confidenceReasons) {
      lines.push(`//   * ${reason}`);
    }
    lines.push('//');
    lines.push('// TECHNICAL LIMITATIONS & MISSING INFORMATION:');
    lines.push('//   * Original variable names, data types, struct definitions, and comments are');
    lines.push('//     permanently lost in compilation and cannot be recovered from Flash.');
    lines.push('//   * Preprocessor macros (#define, F(), PROGMEM) and includes are permanently lost.');
    lines.push('//   * This is an approximate reconstructed hypothesis, NOT the original .ino source.');
    lines.push('// ==============================================================================');
    lines.push('');

    // Step 2: Function Signature with Synthetic Name
    lines.push(`void ${fn.name}(void) {`);

    // Step 3: Synthetic Variable Declarations
    if (syntheticVariables.length > 0) {
      lines.push('    // Synthetic hardware register allocations');
      for (const v of syntheticVariables) {
        lines.push(`    ${v.inferredType} ${v.name}; // register ${v.registerOrMemory}`);
      }
      lines.push('');
    }

    // Step 4: Body generation linked to assembly addresses
    let currentLineNum = lines.length + 1;

    for (let b = 0; b < fn.basicBlocks.length; b++) {
      const block = fn.basicBlocks[b];

      if (block.isEntryBlock) {
        lines.push(`    // Entry Block: ${block.id}`);
      } else {
        lines.push(`    // Block: ${block.id} (target from: ${block.predecessorAddresses.map((a) => formatHexAddress(a, 4)).join(', ') || 'none'})`);
        lines.push(`  ${block.id}:`);
      }
      currentLineNum = lines.length + 1;

      for (const inst of block.instructions) {
        const addrTag = `/* [${formatHexAddress(inst.address, 6)}] */`;
        const assemblyLine = `${formatHexAddress(inst.address, 4)}: ${inst.rawBytesHex}  ${inst.mnemonic} ${inst.operands}`.trimEnd();

        let codeStmt = '';
        let confirmedFact = '';
        let inferredMeaning: string | undefined = undefined;

        if (!inst.isDecodable) {
          codeStmt = `    ${addrTag} /* UNKNOWN / UNDECODABLE BYTES: ${inst.mnemonic} ${inst.operands} */`;
          confirmedFact = `Undecodable opcode ${inst.mnemonic} ${inst.operands}`;
          inferredMeaning = 'Erased Flash memory or unrecognized instruction';
        } else if (inst.mnemonic === 'nop') {
          codeStmt = `    ${addrTag} __asm_nop(); // No operation`;
          confirmedFact = 'Executes single-cycle NOP';
        } else if (inst.mnemonic === 'ret' || inst.mnemonic === 'reti') {
          codeStmt = `    ${addrTag} return; // ${inst.mnemonic === 'reti' ? 'Return from interrupt handler' : 'Return to caller'}`;
          confirmedFact = `Returns from subroutine via ${inst.mnemonic.toUpperCase()}`;
        } else if (inst.mnemonic === 'ldi') {
          // LDI Rd, K -> var_rd = K
          const parts = inst.operands.split(',');
          const rd = parts[0]?.trim();
          const k = parts[1]?.trim();
          codeStmt = `    ${addrTag} var_${rd} = ${k};`;
          confirmedFact = `Loads constant ${k} into register ${rd}`;
        } else if (inst.mnemonic === 'out') {
          // OUT A, Rr
          const parts = inst.operands.split(',');
          const port = parts[0]?.trim();
          const rr = parts[1]?.trim();
          const portName = inst.comment || port;
          codeStmt = `    ${addrTag} ${portName} = var_${rr};`;
          confirmedFact = `Writes value of register ${rr} to I/O port ${port}`;
          if (inst.comment?.includes('PORTB')) {
            inferredMeaning = 'Sets digital output states on Port B (PB5 is Arduino Uno LED pin 13)';
          }
        } else if (inst.mnemonic === 'in') {
          // IN Rd, A
          const parts = inst.operands.split(',');
          const rd = parts[0]?.trim();
          const port = parts[1]?.trim();
          const portName = inst.comment?.replace('read ', '') || port;
          codeStmt = `    ${addrTag} var_${rd} = ${portName};`;
          confirmedFact = `Reads I/O port ${port} into register ${rd}`;
        } else if (inst.mnemonic === 'sbi') {
          // SBI A, b
          const parts = inst.operands.split(',');
          const port = parts[0]?.trim();
          const bit = parts[1]?.trim();
          const portName = inst.comment ? inst.comment.split(' in ')[1] : port;
          codeStmt = `    ${addrTag} ${portName} |= (1 << ${bit});`;
          confirmedFact = `Sets bit ${bit} in I/O port ${port}`;
          if (portName?.includes('PORTB') && bit === '5') {
            inferredMeaning = 'Turns ON Arduino Uno onboard LED (pin 13)';
          }
        } else if (inst.mnemonic === 'cbi') {
          // CBI A, b
          const parts = inst.operands.split(',');
          const port = parts[0]?.trim();
          const bit = parts[1]?.trim();
          const portName = inst.comment ? inst.comment.split(' in ')[1] : port;
          codeStmt = `    ${addrTag} ${portName} &= ~(1 << ${bit});`;
          confirmedFact = `Clears bit ${bit} in I/O port ${port}`;
          if (portName?.includes('PORTB') && bit === '5') {
            inferredMeaning = 'Turns OFF Arduino Uno onboard LED (pin 13)';
          }
        } else if (inst.isCall && inst.jumpTargetAddress !== undefined) {
          const targetName = `func_${formatHexAddress(inst.jumpTargetAddress, 6).replace('0x', '')}`;
          codeStmt = `    ${addrTag} ${targetName}();`;
          confirmedFact = `Calls subroutine at ${formatHexAddress(inst.jumpTargetAddress, 4)}`;
        } else if (inst.mnemonic === 'rjmp' || inst.mnemonic === 'jmp') {
          if (inst.jumpTargetAddress !== undefined) {
            const targetBlock = fn.basicBlocks.find((bl) => bl.startAddress === inst.jumpTargetAddress);
            const targetLabel = targetBlock ? targetBlock.id : `loc_${formatHexAddress(inst.jumpTargetAddress, 4).replace('0x', '')}`;
            codeStmt = `    ${addrTag} goto ${targetLabel};`;
            confirmedFact = `Unconditional jump to ${formatHexAddress(inst.jumpTargetAddress, 4)}`;
          } else {
            codeStmt = `    ${addrTag} goto ${inst.operands};`;
            confirmedFact = `Unconditional jump`;
          }
        } else if (inst.isBranch && inst.jumpTargetAddress !== undefined) {
          const targetBlock = fn.basicBlocks.find((bl) => bl.startAddress === inst.jumpTargetAddress);
          const targetLabel = targetBlock ? targetBlock.id : `loc_${formatHexAddress(inst.jumpTargetAddress, 4).replace('0x', '')}`;
          codeStmt = `    ${addrTag} if (${inst.mnemonic}) goto ${targetLabel};`;
          confirmedFact = `Conditional branch on ${inst.mnemonic} to ${formatHexAddress(inst.jumpTargetAddress, 4)}`;
        } else if (inst.mnemonic === 'clr') {
          const rd = inst.operands.trim();
          codeStmt = `    ${addrTag} var_${rd} = 0;`;
          confirmedFact = `Clears register ${rd} to 0`;
        } else if (inst.mnemonic === 'inc') {
          const rd = inst.operands.trim();
          codeStmt = `    ${addrTag} var_${rd}++;`;
          confirmedFact = `Increments register ${rd}`;
        } else if (inst.mnemonic === 'dec') {
          const rd = inst.operands.trim();
          codeStmt = `    ${addrTag} var_${rd}--;`;
          confirmedFact = `Decrements register ${rd}`;
        } else if (inst.mnemonic === 'add' || inst.mnemonic === 'adc') {
          const parts = inst.operands.split(',');
          const rd = parts[0]?.trim();
          const rr = parts[1]?.trim();
          codeStmt = `    ${addrTag} var_${rd} += var_${rr};`;
          confirmedFact = `Adds register ${rr} to ${rd}`;
        } else if (inst.mnemonic === 'sub') {
          const parts = inst.operands.split(',');
          const rd = parts[0]?.trim();
          const rr = parts[1]?.trim();
          codeStmt = `    ${addrTag} var_${rd} -= var_${rr};`;
          confirmedFact = `Subtracts register ${rr} from ${rd}`;
        } else {
          codeStmt = `    ${addrTag} __asm_${inst.mnemonic}(${inst.operands});`;
          confirmedFact = `Executes ${inst.mnemonic} ${inst.operands}`;
        }

        lines.push(codeStmt);
        if (inferredMeaning) {
          lines.push(`    // Inferred: ${inferredMeaning}`);
        }

        traceMappings.push({
          address: inst.address,
          assemblyLine,
          pseudocodeLineNumber: currentLineNum,
          confirmedFact,
          inferredMeaning,
        });

        currentLineNum = lines.length + 1;
      }
      lines.push('');
    }

    lines.push('}');
    lines.push('');
    lines.push('// --- END OF INFERRED PSEUDOCODE BLOCK ---');

    return {
      blockId: `pseudo_${fn.name}`,
      functionName: fn.name,
      label: 'approximate reconstruction',
      addressRange: {
        start: fn.entryAddress,
        end: fn.endAddress,
      },
      confidence: fn.confidence,
      confidenceScore: fn.confidenceScore,
      confidenceReason: fn.confidenceReasons.join('; '),
      missingInformation: [
        'Local variable names, types, and struct layouts permanently lost.',
        'Preprocessor macros and constants (#define, F(), PROGMEM) permanently lost.',
        'Compiler inlining, optimization levels, and loop unrolling cannot be mathematically proven.',
        'Comments and original file hierarchy permanently lost.',
      ],
      pseudocodeText: lines.join('\n'),
      traceMappings,
      syntheticVariables,
      peripheralSummary: fn.peripheralAccesses,
    };
  }
}
