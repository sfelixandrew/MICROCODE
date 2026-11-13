/**
 * Cross-Reference (XRef) Tracker
 * MICROCODE INSPECTOR
 *
 * Statically indexes all code and data cross-references (calls, jumps, branches, memory accesses).
 */

import type { DisassemblyInstruction } from '../../disassembly/types.ts';
import type { CrossReference } from '../types.ts';
import { formatHexAddress } from '../../utils/address.ts';

export class CrossReferenceTracker {
  private xrefMap = new Map<number, CrossReference>();

  public static buildIndex(instructions: DisassemblyInstruction[]): CrossReferenceTracker {
    const tracker = new CrossReferenceTracker();

    for (const inst of instructions) {
      // 1. Jump / Call targets
      if (inst.jumpTargetAddress !== undefined) {
        let type: 'call' | 'jump' | 'branch' = 'jump';
        if (inst.isCall) {
          type = 'call';
        } else if (inst.isBranch) {
          type = inst.mnemonic.startsWith('br') || inst.mnemonic.startsWith('b') ? 'branch' : 'jump';
        }

        tracker.addReference(inst.jumpTargetAddress, {
          fromAddress: inst.address,
          instructionMnemonic: inst.mnemonic,
          type,
        });
      }

      // 2. Direct memory data references (e.g. LDS / STS on AVR)
      if (inst.mnemonic === 'lds' || inst.mnemonic === 'sts') {
        const hexMatch = inst.operands.match(/0x[0-9a-fA-F]+/);
        if (hexMatch) {
          const targetMem = parseInt(hexMatch[0], 16);
          if (!isNaN(targetMem)) {
            tracker.addReference(targetMem, {
              fromAddress: inst.address,
              instructionMnemonic: inst.mnemonic,
              type: inst.mnemonic === 'lds' ? 'data_read' : 'data_write',
            });
          }
        }
      }
    }

    return tracker;
  }

  public addReference(
    targetAddress: number,
    ref: {
      fromAddress: number;
      instructionMnemonic: string;
      type: 'call' | 'jump' | 'branch' | 'data_read' | 'data_write';
    }
  ): void {
    let entry = this.xrefMap.get(targetAddress);
    if (!entry) {
      entry = {
        targetAddress,
        targetLabel: formatHexAddress(targetAddress, 6),
        references: [],
      };
      this.xrefMap.set(targetAddress, entry);
    }

    // Avoid duplicate fromAddress & type entries
    if (
      !entry.references.some(
        (r) => r.fromAddress === ref.fromAddress && r.type === ref.type
      )
    ) {
      entry.references.push(ref);
    }
  }

  public getReferencesTo(targetAddress: number): CrossReference | undefined {
    return this.xrefMap.get(targetAddress);
  }

  public getCallersOf(functionAddress: number): number[] {
    const entry = this.xrefMap.get(functionAddress);
    if (!entry) return [];
    return entry.references
      .filter((r) => r.type === 'call')
      .map((r) => r.fromAddress);
  }

  public getAllCrossReferences(): CrossReference[] {
    return Array.from(this.xrefMap.values()).sort(
      (a, b) => a.targetAddress - b.targetAddress
    );
  }
}
