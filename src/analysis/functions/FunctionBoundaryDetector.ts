/**
 * Probable Function Boundary Detector
 * MICROCODE INSPECTOR
 *
 * Statically detects subroutine boundaries, entry points, and returns.
 * Computes transparent confidence scores and assigns strictly synthetic identifiers (func_00001234).
 *
 * Non-Negotiable Standard:
 * Never invent function names, original symbols, or source file structures.
 */

import type { DisassemblyInstruction } from '../../disassembly/types.ts';
import type { FunctionBoundary, BasicBlock } from '../types.ts';
import type { TargetArchitecture } from '../../device/types.ts';
import { ControlFlowGraphBuilder } from '../cfg/ControlFlowGraphBuilder.ts';
import { CrossReferenceTracker } from '../xref/CrossReferenceTracker.ts';
import { LoopPatternDetector } from '../patterns/LoopPatternDetector.ts';
import { PeripheralAccessInferrer } from '../patterns/PeripheralAccessInferrer.ts';
import { formatHexAddress } from '../../utils/address.ts';

export class FunctionBoundaryDetector {
  public static detectFunctions(
    instructions: DisassemblyInstruction[],
    architecture: TargetArchitecture,
    xrefTracker?: CrossReferenceTracker
  ): FunctionBoundary[] {
    if (instructions.length === 0) return [];

    const xrefs = xrefTracker || CrossReferenceTracker.buildIndex(instructions);
    const addrToIndex = new Map<number, number>();
    for (let i = 0; i < instructions.length; i++) {
      addrToIndex.set(instructions[i].address, i);
    }

    // Step 1: Collect Candidate Function Entry Points
    interface EntryCandidate {
      address: number;
      reasons: string[];
      baseConfidence: 'verified' | 'high' | 'medium' | 'low';
      baseScore: number;
    }

    const entryCandidates = new Map<number, EntryCandidate>();

    const addCandidate = (
      addr: number,
      reason: string,
      confidence: 'verified' | 'high' | 'medium' | 'low',
      score: number
    ) => {
      if (!addrToIndex.has(addr)) return;
      const existing = entryCandidates.get(addr);
      if (existing) {
        if (!existing.reasons.includes(reason)) {
          existing.reasons.push(reason);
        }
        if (score > existing.baseScore) {
          existing.baseScore = score;
          existing.baseConfidence = confidence;
        }
      } else {
        entryCandidates.set(addr, {
          address: addr,
          reasons: [reason],
          baseConfidence: confidence,
          baseScore: score,
        });
      }
    };

    // 1. Initial instruction is always an entry candidate
    const firstInst = instructions[0];
    if (architecture === 'avr8' && firstInst.address === 0x0000) {
      addCandidate(0x0000, 'AVR Reset Vector Table Entry (0x0000)', 'verified', 0.98);
      // If first instruction is JMP/RJMP, its target is the main initialization routine
      if (firstInst.jumpTargetAddress !== undefined) {
        addCandidate(
          firstInst.jumpTargetAddress,
          'Target of Reset Vector Jump (System Startup / main)',
          'verified',
          0.95
        );
      }
    } else {
      addCandidate(firstInst.address, 'Firmware Image Initial Entry Point', 'high', 0.85);
    }

    // 2. Scan instructions for call targets and post-return boundaries
    for (let i = 0; i < instructions.length; i++) {
      const inst = instructions[i];

      // Direct CALL / RCALL target
      if (inst.isCall && inst.jumpTargetAddress !== undefined) {
        addCandidate(
          inst.jumpTargetAddress,
          `Directly targeted by call instruction at ${formatHexAddress(inst.address, 4)}`,
          'high',
          0.88
        );
      }

      // Check for Xtensa entry instruction (windowed register frame setup)
      if (inst.mnemonic === 'entry') {
        addCandidate(
          inst.address,
          'Xtensa windowed register entry instruction (entry a1, N)',
          'verified',
          0.96
        );
      }

      // Instruction immediately following a RET/RETI
      if (inst.isReturn && i + 1 < instructions.length) {
        const nextInst = instructions[i + 1];
        // Only treat as entry if next instruction is decodable
        if (nextInst.isDecodable) {
          addCandidate(
            nextInst.address,
            `Sequential instruction immediately following return (RET/RETI) at ${formatHexAddress(inst.address, 4)}`,
            'medium',
            0.65
          );
        }
      }
    }

    // Sort candidate entry points by address
    const sortedEntries = Array.from(entryCandidates.values()).sort(
      (a, b) => a.address - b.address
    );

    // Step 2: Establish Function Boundaries (Partition Instruction Ranges)
    const functions: FunctionBoundary[] = [];

    for (let e = 0; e < sortedEntries.length; e++) {
      const entry = sortedEntries[e];
      const startIdx = addrToIndex.get(entry.address);
      if (startIdx === undefined) continue;

      const nextEntryAddr = e + 1 < sortedEntries.length ? sortedEntries[e + 1].address : null;
      let endIdx = instructions.length - 1;

      if (nextEntryAddr !== null && addrToIndex.has(nextEntryAddr)) {
        endIdx = addrToIndex.get(nextEntryAddr)! - 1;
      }

      if (endIdx < startIdx) continue;

      // Extract instructions belonging to this candidate function
      const fnInstructions = instructions.slice(startIdx, endIdx + 1);
      const exitAddresses: number[] = [];
      let undecodableCount = 0;
      let hasPrologue = false;
      let hasEpilogue = false;

      // Check for prologue
      if (
        fnInstructions.length >= 2 &&
        (fnInstructions[0].mnemonic === 'push' || fnInstructions[0].mnemonic === 'entry')
      ) {
        hasPrologue = true;
      }

      // Check for epilogue / exits
      for (const inst of fnInstructions) {
        if (!inst.isDecodable) {
          undecodableCount++;
        }
        if (inst.isReturn) {
          exitAddresses.push(inst.address);
          hasEpilogue = true;
        }
      }

      // Compute callers and callees
      const callers = xrefs.getCallersOf(entry.address);
      const callees: number[] = [];
      for (const inst of fnInstructions) {
        if (inst.isCall && inst.jumpTargetAddress !== undefined) {
          if (!callees.includes(inst.jumpTargetAddress)) {
            callees.push(inst.jumpTargetAddress);
          }
        }
      }

      // Build Control Flow Graph for this function
      const cfg = ControlFlowGraphBuilder.buildGraph(fnInstructions, entry.address);

      // Detect loop patterns in this function
      const loopPatterns = LoopPatternDetector.detectLoops(cfg);

      // Detect peripheral accesses in this function
      const peripheralAccesses = PeripheralAccessInferrer.inferAccesses(
        fnInstructions,
        architecture
      );

      // Finalize Confidence Scoring
      let confidenceScore = entry.baseScore;
      const reasons = [...entry.reasons];

      if (hasEpilogue) {
        confidenceScore = Math.min(1.0, confidenceScore + 0.08);
        reasons.push(`Contains verified return instruction (${exitAddresses.length} return points).`);
      } else {
        confidenceScore = Math.max(0.2, confidenceScore - 0.15);
        reasons.push('Lacks verified return instruction before boundary.');
      }

      if (hasPrologue) {
        confidenceScore = Math.min(1.0, confidenceScore + 0.05);
        reasons.push('Contains standard stack frame prologue sequence.');
      }

      if (callers.length > 0) {
        confidenceScore = Math.min(1.0, confidenceScore + 0.05);
        reasons.push(`Target of ${callers.length} static call site(s).`);
      }

      if (undecodableCount > 0) {
        confidenceScore = Math.max(0.1, confidenceScore - 0.1);
        reasons.push(`Contains ${undecodableCount} undecodable/erased word(s).`);
      }

      confidenceScore = Number(confidenceScore.toFixed(2));

      let confidence: 'verified' | 'high' | 'medium' | 'low' = 'medium';
      if (confidenceScore >= 0.9) confidence = 'verified';
      else if (confidenceScore >= 0.75) confidence = 'high';
      else if (confidenceScore >= 0.5) confidence = 'medium';
      else confidence = 'low';

      // Assign STRICT synthetic name: func_00001234
      const hexAddrStr = formatHexAddress(entry.address, 6).replace('0x', '');
      const syntheticName = `func_${hexAddrStr}`;

      functions.push({
        name: syntheticName,
        entryAddress: entry.address,
        endAddress: fnInstructions[fnInstructions.length - 1].address,
        exitAddresses,
        confidence,
        confidenceScore,
        confidenceReasons: reasons,
        basicBlocks: cfg.blocks,
        cfg,
        callers,
        callees,
        peripheralAccesses,
        loopPatterns,
        conditionalPatterns: [],
        instructionCount: fnInstructions.length,
        undecodableInstructionCount: undecodableCount,
        hasPrologue,
        hasEpilogue,
      });
    }

    return functions;
  }
}

