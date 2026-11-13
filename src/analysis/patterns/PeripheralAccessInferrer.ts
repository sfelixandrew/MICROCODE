/**
 * Peripheral Access Inference Engine
 * MICROCODE INSPECTOR
 *
 * Infers microcontroller peripheral hardware access ONLY when instruction patterns
 * and architecture-specific hardware registers definitively support the claim.
 *
 * Non-Negotiable Rule:
 * Strictly separate confirmed instruction facts from inferred high-level meanings.
 */

import type { DisassemblyInstruction } from '../../disassembly/types.ts';
import type { InferredPeripheralAccess } from '../types.ts';
import type { TargetArchitecture } from '../../device/types.ts';

interface KnownRegisterInfo {
  name: string;
  category: 'GPIO' | 'USART' | 'ADC' | 'TIMER' | 'INTERRUPT' | 'SYSTEM';
  description: string;
  inferredWriteMeaning?: string;
  inferredReadMeaning?: string;
  inferredBitSetMeaning?: (bit: number) => string;
  inferredBitClearMeaning?: (bit: number) => string;
}

export class PeripheralAccessInferrer {
  // ATmega328P I/O Space (0x00 to 0x3F for IN/OUT/SBI/CBI)
  private static readonly AVR_IO_REGISTERS: Record<number, KnownRegisterInfo> = {
    0x03: {
      name: 'PINB',
      category: 'GPIO',
      description: 'Port B Input Pins Address',
      inferredReadMeaning: 'Reads digital logic levels on Port B (Arduino Uno digital pins 8–13).',
    },
    0x04: {
      name: 'DDRB',
      category: 'GPIO',
      description: 'Port B Data Direction Register',
      inferredWriteMeaning: 'Configures pin direction (input/output) for Port B pins.',
      inferredBitSetMeaning: (b) =>
        `Configures Port B pin ${b} as OUTPUT${b === 5 ? ' (Arduino Uno LED_BUILTIN pin 13)' : ''}.`,
      inferredBitClearMeaning: (b) => `Configures Port B pin ${b} as INPUT.`,
    },
    0x05: {
      name: 'PORTB',
      category: 'GPIO',
      description: 'Port B Data Register',
      inferredWriteMeaning: 'Sets digital output states on Port B.',
      inferredBitSetMeaning: (b) =>
        `Sets Port B pin ${b} HIGH${b === 5 ? ' (turns ON Arduino Uno onboard LED pin 13)' : ''}.`,
      inferredBitClearMeaning: (b) =>
        `Sets Port B pin ${b} LOW${b === 5 ? ' (turns OFF Arduino Uno onboard LED pin 13)' : ''}.`,
    },
    0x06: {
      name: 'PINC',
      category: 'GPIO',
      description: 'Port C Input Pins Address',
      inferredReadMeaning: 'Reads digital logic levels on Port C (Arduino Uno analog pins A0–A5 used as digital).',
    },
    0x07: {
      name: 'DDRC',
      category: 'GPIO',
      description: 'Port C Data Direction Register',
      inferredWriteMeaning: 'Configures pin direction for Port C (A0–A5).',
    },
    0x08: {
      name: 'PORTC',
      category: 'GPIO',
      description: 'Port C Data Register',
      inferredWriteMeaning: 'Sets digital output states on Port C (A0–A5).',
    },
    0x09: {
      name: 'PIND',
      category: 'GPIO',
      description: 'Port D Input Pins Address',
      inferredReadMeaning: 'Reads digital logic levels on Port D (Arduino Uno digital pins 0–7).',
    },
    0x0a: {
      name: 'DDRD',
      category: 'GPIO',
      description: 'Port D Data Direction Register',
      inferredWriteMeaning: 'Configures pin direction for Port D (pins 0–7, including Serial RX/TX).',
    },
    0x0b: {
      name: 'PORTD',
      category: 'GPIO',
      description: 'Port D Data Register',
      inferredWriteMeaning: 'Sets digital output states on Port D (pins 0–7).',
    },
    0x2e: {
      name: 'UDR0',
      category: 'USART',
      description: 'USART0 I/O Data Register',
      inferredWriteMeaning: 'Transmits byte over hardware Serial port (Serial.write / Serial.print).',
      inferredReadMeaning: 'Reads received byte from hardware Serial port (Serial.read).',
    },
    0x24: {
      name: 'TCCR0A',
      category: 'TIMER',
      description: 'Timer/Counter 0 Control Register A',
      inferredWriteMeaning: 'Configures Timer0 waveform generation / PWM modes.',
    },
    0x25: {
      name: 'TCCR0B',
      category: 'TIMER',
      description: 'Timer/Counter 0 Control Register B',
      inferredWriteMeaning: 'Configures Timer0 prescaler / clock source.',
    },
    0x26: {
      name: 'TCNT0',
      category: 'TIMER',
      description: 'Timer/Counter 0 Register',
      inferredWriteMeaning: 'Initializes or resets Timer0 counter value.',
      inferredReadMeaning: 'Reads current Timer0 counter value.',
    },
    0x3f: {
      name: 'SREG',
      category: 'SYSTEM',
      description: 'AVR Status Register',
      inferredWriteMeaning: 'Restores ALU flags and global interrupt enable bit.',
      inferredReadMeaning: 'Preserves ALU status flags and interrupt state.',
    },
  };

  public static inferAccesses(
    instructions: DisassemblyInstruction[],
    architecture: TargetArchitecture
  ): InferredPeripheralAccess[] {
    const results: InferredPeripheralAccess[] = [];

    if (architecture === 'avr8') {
      for (const inst of instructions) {
        // IN Rd, A (1011 0AAd dddd AAAA)
        if (inst.mnemonic === 'in') {
          const match = inst.operands.match(/r\d+,\s*0x([0-9a-fA-F]+)/);
          if (match) {
            const regAddr = parseInt(match[1], 16);
            const regInfo = this.AVR_IO_REGISTERS[regAddr];
            if (regInfo) {
              results.push({
                instructionAddress: inst.address,
                registerName: regInfo.name,
                rawRegisterAddress: regAddr,
                accessType: 'read',
                rawMnemonic: inst.mnemonic,
                rawOperands: inst.operands,
                confirmedFact: `Instruction 'IN ${inst.operands}' reads from I/O register 0x${regAddr.toString(16).padStart(2, '0').toUpperCase()} (${regInfo.name}).`,
                inferredMeaning:
                  regInfo.inferredReadMeaning ||
                  `Reads data from ${regInfo.name} (${regInfo.description}).`,
                confidence: 'confirmed',
              });
            }
          }
        }

        // OUT A, Rr (1011 1AAr rrrr AAAA)
        if (inst.mnemonic === 'out') {
          const match = inst.operands.match(/0x([0-9a-fA-F]+),\s*r\d+/);
          if (match) {
            const regAddr = parseInt(match[1], 16);
            const regInfo = this.AVR_IO_REGISTERS[regAddr];
            if (regInfo) {
              results.push({
                instructionAddress: inst.address,
                registerName: regInfo.name,
                rawRegisterAddress: regAddr,
                accessType: 'write',
                rawMnemonic: inst.mnemonic,
                rawOperands: inst.operands,
                confirmedFact: `Instruction 'OUT ${inst.operands}' writes to I/O register 0x${regAddr.toString(16).padStart(2, '0').toUpperCase()} (${regInfo.name}).`,
                inferredMeaning:
                  regInfo.inferredWriteMeaning ||
                  `Writes data to ${regInfo.name} (${regInfo.description}).`,
                confidence: 'confirmed',
              });
            }
          }
        }

        // SBI A, b (Set Bit in I/O Register)
        if (inst.mnemonic === 'sbi') {
          const match = inst.operands.match(/0x([0-9a-fA-F]+),\s*(\d+)/);
          if (match) {
            const regAddr = parseInt(match[1], 16);
            const bit = parseInt(match[2], 10);
            const regInfo = this.AVR_IO_REGISTERS[regAddr];
            if (regInfo) {
              results.push({
                instructionAddress: inst.address,
                registerName: regInfo.name,
                rawRegisterAddress: regAddr,
                accessType: 'modify_bit_set',
                bitIndex: bit,
                rawMnemonic: inst.mnemonic,
                rawOperands: inst.operands,
                confirmedFact: `Instruction 'SBI ${inst.operands}' sets bit ${bit} in I/O register 0x${regAddr.toString(16).padStart(2, '0').toUpperCase()} (${regInfo.name}).`,
                inferredMeaning: regInfo.inferredBitSetMeaning
                  ? regInfo.inferredBitSetMeaning(bit)
                  : `Sets bit ${bit} in ${regInfo.name} (${regInfo.description}).`,
                confidence: 'confirmed',
              });
            }
          }
        }

        // CBI A, b (Clear Bit in I/O Register)
        if (inst.mnemonic === 'cbi') {
          const match = inst.operands.match(/0x([0-9a-fA-F]+),\s*(\d+)/);
          if (match) {
            const regAddr = parseInt(match[1], 16);
            const bit = parseInt(match[2], 10);
            const regInfo = this.AVR_IO_REGISTERS[regAddr];
            if (regInfo) {
              results.push({
                instructionAddress: inst.address,
                registerName: regInfo.name,
                rawRegisterAddress: regAddr,
                accessType: 'modify_bit_clear',
                bitIndex: bit,
                rawMnemonic: inst.mnemonic,
                rawOperands: inst.operands,
                confirmedFact: `Instruction 'CBI ${inst.operands}' clears bit ${bit} in I/O register 0x${regAddr.toString(16).padStart(2, '0').toUpperCase()} (${regInfo.name}).`,
                inferredMeaning: regInfo.inferredBitClearMeaning
                  ? regInfo.inferredBitClearMeaning(bit)
                  : `Clears bit ${bit} in ${regInfo.name} (${regInfo.description}).`,
                confidence: 'confirmed',
              });
            }
          }
        }
      }
    }

    return results;
  }
}

