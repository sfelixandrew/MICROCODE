/**
 * Basic-Block & Control-Flow Graph Builder
 * MICROCODE INSPECTOR
 *
 * Partitions linear disassembly instruction sequences into discrete basic blocks
 * and computes directed control-flow edges.
 *
 * Non-Negotiable Standard:
 * - Every instruction belongs to exactly one basic block.
 * - No instructions are dropped, skipped, or invented.
 * - Confirmed jump targets become block leaders.
 */

import type { DisassemblyInstruction } from '../../disassembly/types.ts';
import type { BasicBlock, ControlFlowEdge, ControlFlowGraph, TerminatorType } from '../types.ts';
import { formatHexAddress } from '../../utils/address.ts';

export class ControlFlowGraphBuilder {
  /**
   * Builds basic blocks and a complete CFG from an array of disassembly instructions.
   */
  public static buildGraph(
    instructions: DisassemblyInstruction[],
    entryAddress?: number
  ): ControlFlowGraph {
    if (instructions.length === 0) {
      return {
        entryAddress: entryAddress ?? 0,
        blocks: [],
        edges: [],
        hasCycles: false,
      };
    }

    const effectiveEntry = entryAddress ?? instructions[0].address;

    // Map instruction address to its index
    const addrToIndex = new Map<number, number>();
    for (let i = 0; i < instructions.length; i++) {
      addrToIndex.set(instructions[i].address, i);
    }

    // Step 1: Identify all block leader addresses
    const leaders = new Set<number>();
    leaders.add(instructions[0].address);
    if (addrToIndex.has(effectiveEntry)) {
      leaders.add(effectiveEntry);
    }

    for (let i = 0; i < instructions.length; i++) {
      const inst = instructions[i];

      // Jump, call, or branch targets are leaders
      if (inst.jumpTargetAddress !== undefined && addrToIndex.has(inst.jumpTargetAddress)) {
        leaders.add(inst.jumpTargetAddress);
      }

      // Instructions explicitly marked as jump targets are leaders
      if (inst.isJumpTarget) {
        leaders.add(inst.address);
      }

      // The instruction immediately following a branch, jump, call, or return is a leader
      if (inst.isBranch || inst.isCall || inst.isReturn) {
        if (i + 1 < instructions.length) {
          leaders.add(instructions[i + 1].address);
        }
      }
    }

    // Convert leaders to a sorted list of addresses
    const sortedLeaderAddrs = Array.from(leaders).sort((a, b) => a - b);

    // Step 2: Partition instructions into basic blocks
    const blocks: BasicBlock[] = [];
    const blockMap = new Map<number, BasicBlock>();

    for (let l = 0; l < sortedLeaderAddrs.length; l++) {
      const startAddr = sortedLeaderAddrs[l];
      const startIdx = addrToIndex.get(startAddr);
      if (startIdx === undefined) continue;

      const nextLeaderAddr = l + 1 < sortedLeaderAddrs.length ? sortedLeaderAddrs[l + 1] : null;
      const endIdx =
        nextLeaderAddr !== null && addrToIndex.has(nextLeaderAddr)
          ? addrToIndex.get(nextLeaderAddr)! - 1
          : instructions.length - 1;

      if (endIdx < startIdx) continue;

      const blockInsts = instructions.slice(startIdx, endIdx + 1);
      const lastInst = blockInsts[blockInsts.length - 1];

      let terminatorType: TerminatorType = 'fallthrough';
      let branchCondition: string | undefined = undefined;

      if (lastInst.isReturn) {
        terminatorType = 'return';
      } else if (lastInst.isBranch) {
        if (
          lastInst.mnemonic.startsWith('br') ||
          lastInst.mnemonic.startsWith('b') ||
          lastInst.mnemonic === 'loop' ||
          lastInst.mnemonic === 'loopnez'
        ) {
          terminatorType = 'branch_conditional';
          branchCondition = lastInst.mnemonic;
        } else {
          terminatorType = 'jump_unconditional';
        }
      } else if (lastInst.isCall) {
        terminatorType = 'call';
      } else if (lastInst.mnemonic === 'sleep' || lastInst.mnemonic === 'wdr') {
        terminatorType = 'trap_or_halt';
      } else if (!lastInst.isDecodable) {
        terminatorType = 'unknown';
      }

      const block: BasicBlock = {
        id: `block_${formatHexAddress(startAddr, 6).replace('0x', '')}`,
        startAddress: startAddr,
        endAddress: lastInst.address,
        instructions: blockInsts,
        predecessorAddresses: [],
        successorAddresses: [],
        terminatorType,
        branchCondition,
        isEntryBlock: startAddr === effectiveEntry,
        isExitBlock: terminatorType === 'return' || terminatorType === 'trap_or_halt',
      };

      blocks.push(block);
      blockMap.set(startAddr, block);
    }

    // Step 3: Compute directed edges and predecessor/successor links
    const edges: ControlFlowEdge[] = [];
    let hasCycles = false;

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const lastInst = block.instructions[block.instructions.length - 1];
      const lastIdx = addrToIndex.get(lastInst.address)!;
      const nextSequentialAddr =
        lastIdx + 1 < instructions.length ? instructions[lastIdx + 1].address : null;

      const addEdge = (
        toAddr: number,
        type: ControlFlowEdge['type']
      ) => {
        const targetBlock = blockMap.get(toAddr);
        if (targetBlock) {
          if (!block.successorAddresses.includes(toAddr)) {
            block.successorAddresses.push(toAddr);
          }
          if (!targetBlock.predecessorAddresses.includes(block.startAddress)) {
            targetBlock.predecessorAddresses.push(block.startAddress);
          }
          edges.push({
            fromBlockId: block.id,
            toBlockId: targetBlock.id,
            fromAddress: lastInst.address,
            toAddress: toAddr,
            type,
          });

          // Cycle detection: back-edge to an earlier or equal address
          if (toAddr <= block.startAddress) {
            hasCycles = true;
          }
        }
      };

      switch (block.terminatorType) {
        case 'branch_conditional': {
          // True branch -> Jump target
          if (lastInst.jumpTargetAddress !== undefined) {
            addEdge(lastInst.jumpTargetAddress, 'conditional_true');
          }
          // False branch -> Fallthrough to next sequential block
          if (nextSequentialAddr !== null) {
            addEdge(nextSequentialAddr, 'conditional_false');
          }
          break;
        }

        case 'jump_unconditional': {
          // Unconditional jump goes exclusively to target
          if (lastInst.jumpTargetAddress !== undefined) {
            addEdge(lastInst.jumpTargetAddress, 'unconditional');
          }
          break;
        }

        case 'call': {
          // Call jumps to target subroutine (call edge)
          if (lastInst.jumpTargetAddress !== undefined) {
            addEdge(lastInst.jumpTargetAddress, 'call');
          }
          // And execution resumes at next sequential block upon return
          if (nextSequentialAddr !== null) {
            addEdge(nextSequentialAddr, 'fallthrough');
          }
          break;
        }

        case 'fallthrough': {
          if (nextSequentialAddr !== null) {
            addEdge(nextSequentialAddr, 'fallthrough');
          }
          break;
        }

        case 'return':
        case 'trap_or_halt':
        case 'unknown':
          // Control flow terminates or returns to caller
          break;
      }
    }

    return {
      entryAddress: effectiveEntry,
      blocks,
      edges,
      hasCycles,
    };
  }
}
