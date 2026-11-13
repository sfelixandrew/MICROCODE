/**
 * Unified Microcode Analysis Engine
 * MICROCODE INSPECTOR
 *
 * Orchestrates CFG construction, function boundary detection, cross-referencing,
 * peripheral hardware access inference, and approximate pseudocode generation.
 *
 * Non-Negotiable Principle:
 * Ground truth is assembly. All pseudocode is an approximate hypothesis and
 * strictly preserves unknown and undecodable ranges.
 */

import type { DisassemblyResult, DisassemblyInstruction } from '../disassembly/types.ts';
import type { TargetArchitecture } from '../device/types.ts';
import type { AnalysisReport, FunctionBoundary, PseudocodeBlock } from './types.ts';
import { FunctionBoundaryDetector } from './functions/FunctionBoundaryDetector.ts';
import { CrossReferenceTracker } from './xref/CrossReferenceTracker.ts';
import { PeripheralAccessInferrer } from './patterns/PeripheralAccessInferrer.ts';
import { PseudocodeGenerator } from './pseudocode/PseudocodeGenerator.ts';

export class AnalysisEngine {
  public static analyze(
    disassembly: DisassemblyResult,
    targetArch?: TargetArchitecture
  ): AnalysisReport {
    const architecture = targetArch || disassembly.architecture;
    const instructions = disassembly.instructions || [];

    // Step 1: Build static cross-reference indices
    const xrefTracker = CrossReferenceTracker.buildIndex(instructions);
    const crossReferences = xrefTracker.getAllCrossReferences();

    // Step 2: Detect function boundaries and CFGs
    const functions = FunctionBoundaryDetector.detectFunctions(
      instructions,
      architecture,
      xrefTracker
    );

    // Step 3: Infer global peripheral accesses
    const globalPeripheralAccesses = PeripheralAccessInferrer.inferAccesses(
      instructions,
      architecture
    );

    // Step 4: Generate approximate pseudocode for all detected functions
    const pseudocodeBlocks: PseudocodeBlock[] = [];
    for (const fn of functions) {
      const block = PseudocodeGenerator.generateBlock(fn, architecture);
      pseudocodeBlocks.push(block);
    }

    const warnings: string[] = [];
    if (disassembly.undecodableCount > 0) {
      warnings.push(
        `Firmware contains ${disassembly.undecodableCount} undecodable/erased word(s) which remain labeled as unknown bytes.`
      );
    }
    if (functions.length === 0 && instructions.length > 0) {
      warnings.push('No discrete function entry points could be verified in this range.');
    }

    return {
      timestamp: new Date().toISOString(),
      architecture,
      totalInstructionsAnalyzed: instructions.length,
      functions,
      crossReferences,
      globalPeripheralAccesses,
      pseudocodeBlocks,
      limitations: [
        'Pseudocode is an approximate hypothesis reconstructed from compiler-generated assembly.',
        'Local variable names, type structures, preprocessor macros (#define, constants), and formatting are permanently lost.',
        'Flash padding (0xFF) represents unwritten/erased semiconductor cells, not executable source instructions.',
        'Not the original Arduino (.ino), C, or C++ source code.',
      ],
      warnings,
    };
  }
}
