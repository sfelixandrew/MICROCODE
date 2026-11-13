/**
 * Loop Pattern Detector
 * MICROCODE INSPECTOR
 *
 * Statically analyzes control flow graphs and back-edges to detect loop patterns:
 * infinite loops, counted loops, while loops, and do-while structures.
 */

import type { ControlFlowGraph, LoopPattern, BasicBlock } from '../types.ts';
import { formatHexAddress } from '../../utils/address.ts';

export class LoopPatternDetector {
  public static detectLoops(cfg: ControlFlowGraph): LoopPattern[] {
    const patterns: LoopPattern[] = [];
    const blockMap = new Map<number, BasicBlock>();
    for (const b of cfg.blocks) {
      blockMap.set(b.startAddress, b);
    }

    // Inspect each back-edge in the CFG (where toAddress <= fromAddress)
    for (const edge of cfg.edges) {
      if (edge.toAddress <= edge.fromAddress) {
        const headerBlock = blockMap.get(edge.toAddress);
        const sourceBlock = cfg.blocks.find(
          (b) => b.instructions.some((i) => i.address === edge.fromAddress)
        );

        if (!sourceBlock) continue;

        const lastInst = sourceBlock.instructions[sourceBlock.instructions.length - 1];

        // Case 1: Infinite loop (unconditional jump back to header with no exits)
        if (
          edge.type === 'unconditional' &&
          (sourceBlock.startAddress === edge.toAddress || sourceBlock.successorAddresses.length === 1)
        ) {
          patterns.push({
            headerAddress: edge.toAddress,
            backEdgeSourceAddress: edge.fromAddress,
            kind: 'infinite_loop',
            confidence: 'high',
            confidenceReason: `Unconditional jump from ${formatHexAddress(edge.fromAddress, 4)} back to ${formatHexAddress(edge.toAddress, 4)} with no alternate branch exit.`,
          });
          continue;
        }

        // Case 2: Counted loop (decrement instruction before branch)
        let isCounted = false;
        let counterVar: string | undefined = undefined;

        if (sourceBlock.instructions.length >= 2) {
          const prevInst = sourceBlock.instructions[sourceBlock.instructions.length - 2];
          if (
            prevInst.mnemonic === 'dec' ||
            prevInst.mnemonic === 'sbiw' ||
            prevInst.mnemonic === 'subi'
          ) {
            isCounted = true;
            counterVar = prevInst.operands.split(',')[0].trim();
          }
        }

        if (isCounted) {
          patterns.push({
            headerAddress: edge.toAddress,
            backEdgeSourceAddress: edge.fromAddress,
            exitAddress: sourceBlock.endAddress + 2, // approximate fallthrough
            kind: 'counted_loop',
            confidence: 'high',
            confidenceReason: `Counter decrement (${counterVar}) controlling conditional back-edge at ${formatHexAddress(edge.fromAddress, 4)}.`,
            approximateIterationVariable: counterVar,
          });
          continue;
        }

        // Case 3: While / Do-While conditional loop
        if (edge.type === 'conditional_true' || edge.type === 'conditional_false') {
          // If the branch is at the end of the loop body jumping back to header, it's do-while
          // If the header itself tested a condition jumping over the body, it's while
          const isDoWhile = edge.toAddress <= sourceBlock.startAddress;

          patterns.push({
            headerAddress: edge.toAddress,
            backEdgeSourceAddress: edge.fromAddress,
            kind: isDoWhile ? 'condition_do_while' : 'condition_while',
            confidence: 'medium',
            confidenceReason: `Conditional branch ${lastInst.mnemonic} at ${formatHexAddress(edge.fromAddress, 4)} creates a cyclic back-edge to ${formatHexAddress(edge.toAddress, 4)}.`,
          });
        }
      }
    }

    return patterns;
  }
}

