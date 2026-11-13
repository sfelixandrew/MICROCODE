/**
 * Analysis Layer Types & Domain Models
 * MICROCODE INSPECTOR
 *
 * Implements typed interfaces for Control Flow Graphs (CFG), Basic Blocks,
 * Probable Function Boundaries, Cross-References, Pattern Detection,
 * Peripheral Inferences, and Traceable Pseudocode Generation.
 *
 * Non-Negotiable Rules:
 * - Pseudocode is an approximate hypothesis; NEVER claim original source-code recovery.
 * - Always use synthetic identifiers (func_00001234, var_1).
 * - Every reconstructed block links back to exact assembly addresses.
 * - Unknown or undecodable instruction regions strictly remain unknown.
 */

import type { DisassemblyInstruction } from '../disassembly/types.ts';
import type { TargetArchitecture } from '../device/types.ts';

export type TerminatorType =
  | 'branch_conditional'
  | 'jump_unconditional'
  | 'call'
  | 'return'
  | 'fallthrough'
  | 'trap_or_halt'
  | 'unknown';

export interface BasicBlock {
  id: string; // e.g. "block_00000000"
  startAddress: number;
  endAddress: number; // inclusive of last instruction
  instructions: DisassemblyInstruction[];
  predecessorAddresses: number[]; // start addresses of predecessors
  successorAddresses: number[]; // start addresses of successors
  terminatorType: TerminatorType;
  branchCondition?: string;
  isEntryBlock?: boolean;
  isExitBlock?: boolean;
}

export interface ControlFlowEdge {
  fromBlockId: string;
  toBlockId: string;
  fromAddress: number;
  toAddress: number;
  type: 'conditional_true' | 'conditional_false' | 'unconditional' | 'call' | 'return' | 'fallthrough';
}

export interface ControlFlowGraph {
  entryAddress: number;
  blocks: BasicBlock[];
  edges: ControlFlowEdge[];
  hasCycles: boolean;
}

export interface InferredPeripheralAccess {
  instructionAddress: number;
  registerName: string; // e.g. 'PORTB', 'PINB', 'UDR0', 'ADMUX'
  rawRegisterAddress: number;
  accessType: 'read' | 'write' | 'modify_bit_set' | 'modify_bit_clear';
  bitIndex?: number;
  rawMnemonic: string;
  rawOperands: string;
  confirmedFact: string; // Ground truth fact (e.g. "Instruction writes to I/O register 0x05 (PORTB)")
  inferredMeaning: string; // Inferred meaning (e.g. "Sets digital pin output high / LED manipulation")
  confidence: 'confirmed' | 'high' | 'heuristic';
}

export interface CrossReference {
  targetAddress: number;
  targetLabel: string;
  references: Array<{
    fromAddress: number;
    instructionMnemonic: string;
    type: 'call' | 'jump' | 'branch' | 'data_read' | 'data_write';
  }>;
}

export interface LoopPattern {
  headerAddress: number;
  backEdgeSourceAddress: number;
  exitAddress?: number;
  kind: 'infinite_loop' | 'counted_loop' | 'condition_while' | 'condition_do_while';
  confidence: 'high' | 'medium' | 'heuristic';
  confidenceReason: string;
  approximateIterationVariable?: string;
}

export interface ConditionalPattern {
  conditionAddress: number;
  conditionMnemonic: string;
  trueTargetAddress: number;
  falseTargetAddress: number;
  kind: 'if_then' | 'if_then_else';
  confidence: 'high' | 'medium';
}

export interface FunctionBoundary {
  name: string; // Synthetic name: func_00001234
  entryAddress: number;
  endAddress: number;
  exitAddresses: number[];
  confidence: 'verified' | 'high' | 'medium' | 'low';
  confidenceScore: number; // 0.0 to 1.0
  confidenceReasons: string[];
  basicBlocks: BasicBlock[];
  cfg: ControlFlowGraph;
  callers: number[]; // addresses of instructions that call this function
  callees: number[]; // addresses of functions called by this function
  peripheralAccesses: InferredPeripheralAccess[];
  loopPatterns: LoopPattern[];
  conditionalPatterns: ConditionalPattern[];
  instructionCount: number;
  undecodableInstructionCount: number;
  hasPrologue: boolean;
  hasEpilogue: boolean;
}

export interface AssemblyTraceMapping {
  address: number;
  assemblyLine: string;
  pseudocodeLineNumber: number;
  confirmedFact: string;
  inferredMeaning?: string;
}

export interface SyntheticVariable {
  name: string; // var_1, var_r16, arg_0
  registerOrMemory: string;
  inferredType?: string;
  firstUsedAtAddress: number;
  purpose: string;
}

export interface PseudocodeBlock {
  blockId: string;
  functionName: string; // Synthetic name: func_00001234
  label: 'approximate reconstruction' | 'inferred pseudocode'; // Non-negotiable mandatory label
  addressRange: {
    start: number;
    end: number;
  };
  confidence: 'verified' | 'high' | 'medium' | 'low';
  confidenceScore: number;
  confidenceReason: string;
  missingInformation: string[];
  pseudocodeText: string;
  traceMappings: AssemblyTraceMapping[];
  syntheticVariables: SyntheticVariable[];
  peripheralSummary: InferredPeripheralAccess[];
}

export interface AnalysisReport {
  timestamp: string;
  architecture: TargetArchitecture;
  totalInstructionsAnalyzed: number;
  functions: FunctionBoundary[];
  crossReferences: CrossReference[];
  globalPeripheralAccesses: InferredPeripheralAccess[];
  pseudocodeBlocks: PseudocodeBlock[];
  limitations: string[];
  warnings: string[];
}

