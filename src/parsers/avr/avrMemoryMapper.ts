/**
 * ATmega328P / 8-bit AVR Memory Topology Mapper
 * MICROCODE INSPECTOR — STAGE 7
 *
 * Implements strict offline memory mapping for ATmega328P / Arduino Uno R3.
 * Preserves Flash and EEPROM memory type separation, detects vector table,
 * maps application space, accurately qualifies bootloader boundary confidence,
 * and tracks trailing unprogrammed Flash padding without inventing data.
 */

import type { ParsedRegion, ParserWarning, ConfidenceLevel } from '../types.ts';
import type { MemoryRegionType } from '../../types/memory.ts';

export interface AvrFuseSettings {
  lowFuse?: number;
  highFuse?: number; // Contains BOOTSZ1, BOOTSZ0
  extendedFuse?: number;
  lockBits?: number;
}

export interface AvrMemoryMapResult {
  flashSize: number;
  eepromSize: number;
  vectorTableEnd: number;
  bootloaderStart: number;
  bootloaderSize: number;
  bootloaderConfidence: ConfidenceLevel;
  bootloaderReason: string;
  regions: ParsedRegion[];
  eepromRegion: ParsedRegion;
  warnings: ParserWarning[];
}

export class AvrMemoryMapper {
  static readonly PARSER_VERSION = '1.0.0';

  static readonly FLASH_TOTAL_BYTES = 32768; // 32 KiB
  static readonly EEPROM_TOTAL_BYTES = 1024; // 1 KiB
  static readonly VECTOR_TABLE_BYTES = 104; // 26 vectors * 4 bytes (2 instructions)

  // Standard Vector names for ATmega328P
  static readonly VECTOR_NAMES: string[] = [
    'RESET',
    'INT0',
    'INT1',
    'PCINT0',
    'PCINT1',
    'PCINT2',
    'WDT',
    'TIMER2_COMPA',
    'TIMER2_COMPB',
    'TIMER2_OVF',
    'TIMER1_CAPT',
    'TIMER1_COMPA',
    'TIMER1_COMPB',
    'TIMER1_OVF',
    'TIMER0_COMPA',
    'TIMER0_COMPB',
    'TIMER0_OVF',
    'SPI_STC',
    'USART_RX',
    'USART_UDRE',
    'USART_TX',
    'ADC',
    'EE_READY',
    'ANALOG_COMP',
    'TWI',
    'SPM_READY',
  ];

  /**
   * Generates a memory map for an ATmega328P Flash image.
   */
  static mapFlashImage(
    data: Uint8Array,
    fuses?: AvrFuseSettings,
  ): AvrMemoryMapResult {
    const warnings: ParserWarning[] = [];
    const regions: ParsedRegion[] = [];
    const len = data.length;

    // 1. Determine Bootloader Boundary & Confidence
    let bootloaderSize = 512; // Standard Optiboot 512 bytes
    let bootloaderStart = 0x7e00;
    let bootloaderConfidence: ConfidenceLevel = 'heuristic';
    let bootloaderReason =
      'Assumed standard Optiboot 512-byte size (0x7E00..0x7FFF). Hardware bootloader boundary requires high fuse (BOOTSZ) verification.';

    if (fuses?.highFuse !== undefined) {
      // High fuse bits 2:1 are BOOTSZ1:BOOTSZ0 (0 = programmed)
      // 0b11: 256 words (512 bytes)  -> start 0x7E00
      // 0b10: 512 words (1024 bytes) -> start 0x7C00
      // 0b01: 1024 words (2048 bytes) -> start 0x7800
      // 0b00: 2048 words (4096 bytes) -> start 0x7000
      const bootsz = (fuses.highFuse >> 1) & 0x03;
      bootloaderConfidence = 'verified';

      if (bootsz === 0x03) {
        bootloaderSize = 512;
        bootloaderStart = 0x7e00;
        bootloaderReason = 'Verified by high fuse BOOTSZ=0b11 (512 bytes / 256 words at 0x7E00).';
      } else if (bootsz === 0x02) {
        bootloaderSize = 1024;
        bootloaderStart = 0x7c00;
        bootloaderReason = 'Verified by high fuse BOOTSZ=0b10 (1024 bytes / 512 words at 0x7C00).';
      } else if (bootsz === 0x01) {
        bootloaderSize = 2048;
        bootloaderStart = 0x7800;
        bootloaderReason = 'Verified by high fuse BOOTSZ=0b01 (2048 bytes / 1024 words at 0x7800).';
      } else {
        bootloaderSize = 4096;
        bootloaderStart = 0x7000;
        bootloaderReason = 'Verified by high fuse BOOTSZ=0b00 (4096 bytes / 2048 words at 0x7000).';
      }
    }

    // 2. Map Interrupt Vector Table (0x0000 .. 0x0068)
    const vectorEnd = Math.min(len, this.VECTOR_TABLE_BYTES);
    let vectorConfidence: ConfidenceLevel = 'heuristic';
    let vectorReason = 'Standard ATmega328P 26-entry interrupt vector table range.';

    if (len >= 4) {
      // Check for JMP or RJMP at vector 0 (Reset vector)
      if (data[0] === 0x0c && data[1] === 0x94) {
        vectorConfidence = 'verified';
        const target = data[2] | (data[3] << 8);
        vectorReason = `Verified ATmega Reset Vector (JMP 0x${target.toString(16).toUpperCase().padStart(4, '0')}).`;
      } else if ((data[1] & 0xf0) === 0xc0) {
        vectorConfidence = 'verified';
        vectorReason = 'Verified ATmega Reset Vector (RJMP relative branch).';
      }
    }

    regions.push({
      id: 'avr_vector_table',
      name: 'Interrupt Vector Table',
      type: 'vector_table',
      offset: 0,
      length: vectorEnd,
      endOffset: vectorEnd,
      confidence: vectorConfidence,
      confidenceReason: vectorReason,
      source: 'avr_vector_table',
      parserVersion: this.PARSER_VERSION,
      warnings: [],
      metadata: {
        vectorCount: 26,
        vectorSizeWords: 2,
      },
    });

    // 3. Scan for End of Application / Start of Trailing Erased Padding
    let appEnd = vectorEnd;
    let paddingStart = -1;

    for (let i = vectorEnd; i < Math.min(len, bootloaderStart); i++) {
      if (data[i] !== 0xff) {
        appEnd = i + 1;
        paddingStart = -1; // Reset padding if programmed data found
      } else if (paddingStart === -1) {
        paddingStart = i;
      }
    }

    // Round appEnd to nearest even address (AVR instructions are 16-bit word aligned)
    if (appEnd % 2 !== 0) appEnd++;

    // Add Application Firmware Region
    if (appEnd > vectorEnd) {
      regions.push({
        id: 'avr_application_code',
        name: 'Application Firmware',
        type: 'app',
        offset: vectorEnd,
        length: appEnd - vectorEnd,
        endOffset: appEnd,
        confidence: 'verified',
        confidenceReason: 'Programmed machine code and initialized constants following vector table.',
        source: 'avr_code_scan',
        parserVersion: this.PARSER_VERSION,
        warnings: [],
      });
    }

    // Add Unprogrammed Padding Region (if any exists between App and Bootloader)
    if (appEnd < bootloaderStart) {
      const padLen = bootloaderStart - appEnd;
      regions.push({
        id: 'avr_unprogrammed_padding',
        name: 'Unprogrammed Flash (0xFF)',
        type: 'unprogrammed_padding',
        offset: appEnd,
        length: padLen,
        endOffset: bootloaderStart,
        confidence: 'verified',
        confidenceReason: 'Erased default Flash memory cells (0xFF) between application and bootloader.',
        source: 'omitted_trailing_flash',
        parserVersion: this.PARSER_VERSION,
        warnings: [],
      });
    }

    // 4. Add Bootloader Region
    if (len >= bootloaderStart) {
      const availableBootloaderLen = Math.min(bootloaderSize, len - bootloaderStart);
      regions.push({
        id: 'avr_bootloader',
        name: 'Optiboot Bootloader',
        type: 'bootloader',
        offset: bootloaderStart,
        length: availableBootloaderLen,
        endOffset: bootloaderStart + availableBootloaderLen,
        confidence: bootloaderConfidence,
        confidenceReason: bootloaderReason,
        source: 'avr_bootloader_spec',
        parserVersion: this.PARSER_VERSION,
        warnings: [],
      });
    }

    // 5. Explicitly Isolated EEPROM Region (Kept separate from Flash)
    const eepromRegion: ParsedRegion = {
      id: 'avr_internal_eeprom',
      name: 'Internal EEPROM',
      type: 'eeprom',
      offset: 0,
      length: this.EEPROM_TOTAL_BYTES,
      endOffset: this.EEPROM_TOTAL_BYTES,
      confidence: 'verified',
      confidenceReason: 'Distinct non-volatile EEPROM memory space (separate address space from Flash).',
      source: 'atmega328p_datasheet',
      parserVersion: this.PARSER_VERSION,
      warnings: [],
      metadata: {
        memorySpace: 'EEPROM',
        enduranceCycles: 100000,
      },
    };

    return {
      flashSize: this.FLASH_TOTAL_BYTES,
      eepromSize: this.EEPROM_TOTAL_BYTES,
      vectorTableEnd: vectorEnd,
      bootloaderStart,
      bootloaderSize,
      bootloaderConfidence,
      bootloaderReason,
      regions,
      eepromRegion,
      warnings,
    };
  }
}

