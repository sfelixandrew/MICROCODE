/**
 * Memory Map & Topology Visualizer
 * MICROCODE INSPECTOR — STAGE 7
 *
 * Renders verified firmware memory regions, partition tables, unmapped address spaces,
 * entropy heuristics, and parser warnings.
 *
 * Non-Negotiable Standard:
 * - Distinguishes VERIFIED findings from HEURISTICS with prominent badges.
 * - Unknown data stays Unknown. Never force a classification.
 */

import React, { useState } from 'react';
import {
  Layers,
  ShieldCheck,
  AlertTriangle,
  HelpCircle,
  Lock,
  FileCode,
  FileSearch,
  CheckCircle2,
  Info,
  FolderOpen,
} from 'lucide-react';
import type { MemoryMapReport, ParsedRegion, ConfidenceLevel } from '../parsers/types.ts';
import { formatHexAddress, formatByteSize } from '../utils/address.ts';

interface MemoryMapViewProps {
  report: MemoryMapReport | null;
  onLoadFile?: (file: File) => void;
  isLoading?: boolean;
}

export const MemoryMapView: React.FC<MemoryMapViewProps> = ({
  report,
  onLoadFile,
  isLoading = false,
}) => {
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string>('all');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onLoadFile) {
      onLoadFile(file);
    }
  };

  if (!report) {
    return (
      <div style={{ textAlign: 'center', padding: '48px 24px', background: '#070a12', borderRadius: '8px', border: '1px dashed #1e293b' }}>
        <Layers size={40} color="#475569" style={{ margin: '0 auto 16px' }} />
        <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#94a3b8', marginBottom: '8px' }}>
          No Firmware Image Loaded for Memory Mapping
        </h3>
        <p style={{ fontSize: '13px', color: '#64748b', maxWidth: '520px', margin: '0 auto 20px' }}>
          Extract firmware over USB from an ESP32 or Arduino Uno, or load a saved raw firmware dump (.bin) or Intel HEX file (.hex) to run offline topology parsing.
        </p>

        <label className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
          <FolderOpen size={16} />
          <span>Load Saved Firmware File (.bin / .hex)</span>
          <input
            type="file"
            accept=".bin,.hex,application/octet-stream,text/plain"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
        </label>
      </div>
    );
  }

  const selectedRegion = report.regions.find((r) => r.id === selectedRegionId);
  const verifiedCount = report.regions.filter((r) => r.confidence === 'verified').length;
  const heuristicCount = report.regions.filter((r) => r.confidence === 'heuristic').length;
  const unknownCount = report.regions.filter((r) => r.confidence === 'unknown').length;

  const getConfidenceBadge = (confidence: ConfidenceLevel) => {
    switch (confidence) {
      case 'verified':
        return (
          <span
            className="badge"
            style={{
              background: '#10b98115',
              color: '#34d399',
              border: '1px solid #10b98140',
              fontWeight: 700,
            }}
          >
            <CheckCircle2 size={11} /> VERIFIED
          </span>
        );
      case 'heuristic':
        return (
          <span
            className="badge"
            style={{
              background: '#f59e0b15',
              color: '#fbbf24',
              border: '1px solid #f59e0b40',
              fontWeight: 700,
            }}
          >
            <AlertTriangle size={11} /> HEURISTIC
          </span>
        );
      case 'high':
      case 'medium':
        return (
          <span
            className="badge"
            style={{
              background: '#3b82f615',
              color: '#60a5fa',
              border: '1px solid #3b82f640',
            }}
          >
            <Info size={11} /> INFERRED ({confidence.toUpperCase()})
          </span>
        );
      default:
        return (
          <span
            className="badge"
            style={{
              background: '#47556920',
              color: '#94a3b8',
              border: '1px solid #47556940',
            }}
          >
            <HelpCircle size={11} /> UNKNOWN
          </span>
        );
    }
  };

  const getTypeColor = (type: string): string => {
    switch (type) {
      case 'bootloader':
        return '#8b5cf6';
      case 'partition_table':
        return '#06b6d4';
      case 'app':
        return '#3b82f6';
      case 'app_ota':
        return '#6366f1';
      case 'data_nvs':
      case 'data_phy':
        return '#10b981';
      case 'data_spiffs':
      case 'data_fat':
        return '#14b8a6';
      case 'vector_table':
        return '#f59e0b';
      case 'eeprom':
        return '#fb923c';
      case 'unprogrammed_padding':
        return '#334155';
      default:
        return '#1e293b';
    }
  };

  const filteredRegions = report.regions.filter((r) => {
    if (filterType === 'all') return true;
    if (filterType === 'verified') return r.confidence === 'verified';
    if (filterType === 'heuristic') return r.confidence === 'heuristic';
    if (filterType === 'app') return r.type === 'app' || r.type === 'app_ota';
    if (filterType === 'data') return r.type.startsWith('data');
    return true;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Banner Summary & Offline File Load Control */}
      <div style={{ background: '#0b1323', border: '1px solid #1e293b', borderRadius: '8px', padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 800, color: '#f1f5f9' }}>
              Memory Topology &amp; Partition Map
            </h3>
            <span className="badge badge-stage" style={{ background: '#3b82f620', color: '#60a5fa' }}>
              Target: {report.targetArchitecture.toUpperCase()}
            </span>
            <span className="badge badge-readonly">Format: {report.detectedFormat.toUpperCase()}</span>
          </div>
          <div style={{ fontSize: '12px', color: '#94a3b8' }}>
            Total Analyzed Span: <strong>{formatByteSize(report.totalSize)}</strong> | Verified Regions: <strong style={{ color: '#34d399' }}>{verifiedCount}</strong> | Heuristic Regions: <strong style={{ color: '#fbbf24' }}>{heuristicCount}</strong> {unknownCount > 0 && `| Unknown: ${unknownCount}`}
          </div>
        </div>

        <label className="btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer', padding: '8px 14px', fontSize: '12px' }}>
          <FolderOpen size={14} />
          <span>Load Offline File (.bin / .hex)</span>
          <input
            type="file"
            accept=".bin,.hex,application/octet-stream,text/plain"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
        </label>
      </div>

      {/* Parser Warnings & Overlaps Banner */}
      {report.overlaps.length > 0 && (
        <div style={{ background: '#ef444415', border: '1px solid #ef444450', borderRadius: '8px', padding: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#f87171', fontWeight: 700, fontSize: '13px', marginBottom: '6px' }}>
            <AlertTriangle size={16} /> Partition Overlaps Detected ({report.overlaps.length})
          </div>
          <div style={{ fontSize: '12px', color: '#fca5a5' }}>
            {report.overlaps.map((ov, i) => (
              <div key={i}>
                • Overlap between &quot;<strong>{ov.regionA}</strong>&quot; and &quot;<strong>{ov.regionB}</strong>&quot; from {formatHexAddress(ov.start)} to {formatHexAddress(ov.end)} ({formatByteSize(ov.length)}).
              </div>
            ))}
          </div>
        </div>
      )}

      {report.warnings.length > 0 && (
        <div style={{ background: '#f59e0b10', border: '1px solid #f59e0b30', borderRadius: '8px', padding: '12px', fontSize: '12px', color: '#fcd34d' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, marginBottom: '4px' }}>
            <Info size={14} /> Parser Integrity Notices ({report.warnings.length}):
          </div>
          {report.warnings.map((w, idx) => (
            <div key={idx} style={{ marginLeft: '22px', marginTop: '2px' }}>
              [{w.code}] {w.message}
            </div>
          ))}
        </div>
      )}

      {/* Memory Topology Bar Visualizer */}
      <div className="card" style={{ padding: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>
            Flash Memory Topology Map (0x00000000 — {formatHexAddress(report.totalSize)})
          </span>
          <span style={{ fontSize: '11px', color: '#64748b' }}>Click region to inspect</span>
        </div>

        {/* Visual Bar */}
        <div
          style={{
            height: '32px',
            background: '#070a12',
            borderRadius: '6px',
            border: '1px solid #1e293b',
            display: 'flex',
            overflow: 'hidden',
            cursor: 'pointer',
          }}
        >
          {report.regions
            .filter((r) => r.type !== 'eeprom')
            .map((reg) => {
              const widthPct = Math.max(1, (reg.length / report.totalSize) * 100);
              const isSelected = reg.id === selectedRegionId;
              return (
                <div
                  key={reg.id}
                  onClick={() => setSelectedRegionId(reg.id)}
                  title={`${reg.name} (${reg.type}) [${formatHexAddress(reg.offset)}..${formatHexAddress(reg.endOffset)}] - ${reg.confidence.toUpperCase()}`}
                  style={{
                    width: `${widthPct}%`,
                    backgroundColor: getTypeColor(reg.type),
                    opacity: isSelected ? 1 : 0.85,
                    borderRight: '1px solid #00000060',
                    borderTop: isSelected ? '3px solid #ffffff' : 'none',
                    borderBottom: isSelected ? '3px solid #ffffff' : 'none',
                    transition: 'all 0.15s',
                  }}
                />
              );
            })}
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginTop: '12px', fontSize: '11px', color: '#94a3b8' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '10px', height: '10px', backgroundColor: '#8b5cf6', borderRadius: '2px' }} /> Bootloader
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '10px', height: '10px', backgroundColor: '#06b6d4', borderRadius: '2px' }} /> Partition Table
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '10px', height: '10px', backgroundColor: '#3b82f6', borderRadius: '2px' }} /> App Image
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '10px', height: '10px', backgroundColor: '#10b981', borderRadius: '2px' }} /> NVS / PHY Data
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '10px', height: '10px', backgroundColor: '#f59e0b', borderRadius: '2px' }} /> Vector Table
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '10px', height: '10px', backgroundColor: '#334155', borderRadius: '2px' }} /> Unprogrammed (0xFF)
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '10px', height: '10px', backgroundColor: '#fb923c', borderRadius: '2px' }} /> EEPROM (Separate Memory)
          </div>
        </div>
      </div>

      {/* Selected Region Detailed Inspector Card */}
      {selectedRegion && (
        <div className="card" style={{ background: '#0b1323', border: '1px solid #3b82f650', padding: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ width: '12px', height: '12px', backgroundColor: getTypeColor(selectedRegion.type), borderRadius: '3px' }} />
              <h4 style={{ fontSize: '15px', fontWeight: 700, color: '#f1f5f9' }}>{selectedRegion.name}</h4>
              <span className="badge badge-stage">{selectedRegion.type}</span>
            </div>
            {getConfidenceBadge(selectedRegion.confidence)}
          </div>

          <div className="meta-grid">
            <div className="meta-item">
              <div className="meta-label">Start Address</div>
              <div className="meta-value">{formatHexAddress(selectedRegion.offset)}</div>
            </div>
            <div className="meta-item">
              <div className="meta-label">End Address (Exclusive)</div>
              <div className="meta-value">{formatHexAddress(selectedRegion.endOffset)}</div>
            </div>
            <div className="meta-item">
              <div className="meta-label">Region Span</div>
              <div className="meta-value">{formatByteSize(selectedRegion.length)}</div>
            </div>
            <div className="meta-item">
              <div className="meta-label">Detection Source</div>
              <div className="meta-value">{selectedRegion.source} (v{selectedRegion.parserVersion})</div>
            </div>
            <div className="meta-item">
              <div className="meta-label">Encryption Flag</div>
              <div className="meta-value" style={{ color: selectedRegion.isEncrypted ? '#ef4444' : '#10b981' }}>
                {selectedRegion.isEncrypted ? 'ENCRYPTED' : 'PLAINTEXT'}
              </div>
            </div>
            <div className="meta-item">
              <div className="meta-label">Evidence &amp; Provenance</div>
              <div className="meta-value" style={{ fontSize: '11px', color: '#cbd5e1' }}>{selectedRegion.confidenceReason}</div>
            </div>
          </div>
        </div>
      )}

      {/* Structured Region Table */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '10px' }}>
          <span className="card-title" style={{ margin: 0 }}>
            <span>Parsed Memory Regions ({filteredRegions.length})</span>
            <Layers size={16} color="#94a3b8" />
          </span>

          {/* Filter Pills */}
          <div style={{ display: 'flex', gap: '6px' }}>
            {['all', 'verified', 'heuristic', 'app', 'data'].map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilterType(f)}
                className="btn-secondary"
                style={{
                  padding: '4px 8px',
                  fontSize: '11px',
                  background: filterType === f ? '#1e293b' : 'transparent',
                  borderColor: filterType === f ? '#3b82f6' : '#1e293b',
                  color: filterType === f ? '#60a5fa' : '#94a3b8',
                }}
              >
                {f.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1e293b', color: '#64748b' }}>
                <th style={{ padding: '8px 10px' }}>Region Name</th>
                <th style={{ padding: '8px 10px' }}>Type</th>
                <th style={{ padding: '8px 10px' }}>Address Range</th>
                <th style={{ padding: '8px 10px' }}>Length</th>
                <th style={{ padding: '8px 10px' }}>Confidence</th>
                <th style={{ padding: '8px 10px' }}>Source Evidence</th>
              </tr>
            </thead>
            <tbody>
              {filteredRegions.map((reg) => (
                <tr
                  key={reg.id}
                  onClick={() => setSelectedRegionId(reg.id)}
                  style={{
                    borderBottom: '1px solid #101626',
                    cursor: 'pointer',
                    background: reg.id === selectedRegionId ? '#162035' : 'transparent',
                  }}
                >
                  <td style={{ padding: '8px 10px', fontWeight: 600, color: '#f1f5f9' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ width: '8px', height: '8px', backgroundColor: getTypeColor(reg.type), borderRadius: '2px' }} />
                      {reg.name}
                    </div>
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    <span className="badge" style={{ background: '#1e293b', color: '#cbd5e1', fontSize: '10px' }}>
                      {reg.type}
                    </span>
                  </td>
                  <td style={{ padding: '8px 10px', fontFamily: 'var(--font-mono)', color: '#93c5fd' }}>
                    {formatHexAddress(reg.offset)} — {formatHexAddress(reg.endOffset)}
                  </td>
                  <td style={{ padding: '8px 10px', fontFamily: 'var(--font-mono)' }}>
                    {formatByteSize(reg.length)}
                  </td>
                  <td style={{ padding: '8px 10px' }}>{getConfidenceBadge(reg.confidence)}</td>
                  <td style={{ padding: '8px 10px', fontSize: '11px', color: '#94a3b8', maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {reg.confidenceReason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Unmapped Ranges & Unknown Data Preservation Notice */}
      {report.unmappedRanges.length > 0 && (
        <div className="card" style={{ background: '#070a12', border: '1px dashed #334155', padding: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#94a3b8', fontWeight: 700, fontSize: '12px', marginBottom: '8px' }}>
            <HelpCircle size={15} /> Unmapped Address Space ({report.unmappedRanges.length} gaps)
            <span className="badge badge-readonly" style={{ background: '#1e293b', color: '#94a3b8', fontSize: '10px' }}>
              Rule: Unknown data stays Unknown
            </span>
          </div>
          <div style={{ fontSize: '12px', color: '#64748b' }}>
            {report.unmappedRanges.map((g, i) => (
              <div key={i} style={{ fontFamily: 'var(--font-mono)', marginBottom: '3px' }}>
                • {formatHexAddress(g.offset)} — {formatHexAddress(g.offset + g.length)} ({formatByteSize(g.length)}): {g.reason}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Heuristic Entropy Summary Card */}
      <div className="card" style={{ padding: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span className="card-title" style={{ margin: 0 }}>
            <span>Heuristic Shannon Entropy Profile</span>
            <FileSearch size={16} color="#94a3b8" />
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#38bdf8' }}>
            Overall Entropy: {report.entropySummary.overallEntropy.toFixed(3)} / 8.0 bits/byte
          </span>
        </div>

        {/* Disclaimer alert */}
        <div style={{ background: '#f59e0b10', border: '1px solid #f59e0b25', borderRadius: '6px', padding: '8px 12px', fontSize: '11px', color: '#fcd34d', marginBottom: '12px' }}>
          <strong>Heuristic Notice:</strong> {report.entropySummary.heuristicNotice}
        </div>

        {/* Chunk visualization bar */}
        <div style={{ display: 'flex', height: '14px', borderRadius: '4px', overflow: 'hidden', background: '#090d16' }}>
          {report.entropySummary.chunks.map((chunk, idx) => {
            const widthPct = 100 / report.entropySummary.chunks.length;
            const color =
              chunk.classification === 'compressed_or_encrypted'
                ? '#f43f5e'
                : chunk.classification === 'plaintext'
                ? '#3b82f6'
                : chunk.classification === 'low_density'
                ? '#10b981'
                : '#334155';
            return (
              <div
                key={idx}
                title={`Offset ${formatHexAddress(chunk.offset)}: Entropy ${chunk.entropy.toFixed(3)} (${chunk.classification})`}
                style={{
                  width: `${widthPct}%`,
                  backgroundColor: color,
                  borderRight: '1px solid #00000030',
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};

