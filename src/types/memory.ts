/**
 * Memory region and topological layout models.
 */

export type MemoryRegionType = 
  | 'bootloader'
  | 'partition_table'
  | 'app'
  | 'app_ota'
  | 'data_nvs'
  | 'data_spiffs'
  | 'data_fat'
  | 'data_phy'
  | 'vector_table'
  | 'eeprom'
  | 'unprogrammed_padding'
  | 'unknown';

export interface AddressRange {
  start: number;
  end: number;       // Exclusive end address: length = end - start
  length: number;
}

export interface MemoryRegion {
  id: string;
  name: string;
  type: MemoryRegionType;
  range: AddressRange;
  isReadable: boolean;
  isEncrypted: boolean;
  description: string;
  provenance: 'detected' | 'inferred' | 'standard_default';
}

export interface MemoryMap {
  totalBytes: number;
  regions: MemoryRegion[];
}

