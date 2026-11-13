/**
 * Architecture-Specific Disassembly Viewer
 * MICROCODE INSPECTOR — STAGE 8
 *
 * Renders verified architecture disassembly, hardware register annotations,
 * load-address context, confidence levels, and technical reverse-engineering limitations.
 *
 * Strict Non-Negotiable Standards:
 * - Distinguishes VERIFIED disassembly from UNSUPPORTED toolchains.
 * - Displays addresses accurately; undecodable bytes as .word / .byte.
 * - Never invents variable names or function symbols.
 * - Provides one-click standard .asm export with provenance headers.
 */

import React, { useState, useMemo } from 'react';
import {
  Code,
  ShieldCheck,
  AlertTriangle,
  Download,
  Copy,
  Check,
  Search,
  Filter,
  Layers,
  ArrowRight,
  Info,
  Terminal,
  Cpu,
  RefreshCw,
} from 'lucide-react';
import type { DisassemblyResult, DisassemblyInstruction } from '../disassembly/types.ts';
import type { TargetArchitecture } from '../device/types.ts';
import { formatHexAddress } from '../utils/address.ts';
import {
  formatAssemblyListing,
  downloadAssemblyListing,
} from '../disassembly/exporters/assemblyExporter.ts';

interface AssemblyViewerProps {
  result: DisassemblyResult | null;
  currentArchitecture?: TargetArchitecture;
  firmwareData?: Uint8Array | null;
  sourceFileName?: string;
  sha256?: string;
  onDisassemble?: (baseAddress: number, offset?: number, length?: number) => void;
  isLoading?: boolean;
}

const PAGE_SIZE = 150;

export const AssemblyViewer: React.FC<AssemblyViewerProps> = ({
  result,
  currentArchitecture = 'avr8',
  firmwareData,
  sourceFileName,
  sha256,
  onDisassemble,
  isLoading = false,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [onlyJumpTargets, setOnlyJumpTargets] = useState(false);
  const [onlyUndecodable, setOnlyUndecodable] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [copied, setCopied] = useState(false);

  // Address basis input
  const defaultBaseAddr = currentArchitecture === 'xtensa-lx6' ? '0x40080000' : '0x0000';
  const [customBaseAddr, setCustomBaseAddr] = useState(defaultBaseAddr);

  // Filter instructions
  const filteredInstructions = useMemo(() => {
    if (!result || !result.instructions) return [];

    let list = result.instructions;

    if (onlyJumpTargets) {
      list = list.filter((i) => i.isJumpTarget);
    }

    if (onlyUndecodable) {
      list = list.filter((i) => !i.isDecodable);
    }

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase().trim();
      list = list.filter(
        (i) =>
          formatHexAddress(i.address, 6).toLowerCase().includes(term) ||
          i.mnemonic.toLowerCase().includes(term) ||
          i.operands.toLowerCase().includes(term) ||
          i.rawBytesHex.toLowerCase().includes(term) ||
          (i.comment && i.comment.toLowerCase().includes(term))
      );
    }

    return list;
  }, [result, searchTerm, onlyJumpTargets, onlyUndecodable]);

  const totalPages = Math.ceil(filteredInstructions.length / PAGE_SIZE) || 1;
  const pagedInstructions = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredInstructions.slice(start, start + PAGE_SIZE);
  }, [filteredInstructions, currentPage]);

  const handleCopy = () => {
    if (!result) return;
    const text = formatAssemblyListing(result, { sourceFileName, sha256 });
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExport = () => {
    if (!result) return;
    const filename = sourceFileName
      ? `${sourceFileName.replace(/\.[^/.]+$/, '')}_disassembly.asm`
      : `firmware_${result.architecture}_disassembly.asm`;
    downloadAssemblyListing(result, filename, { sourceFileName, sha256 });
  };

  const handleTriggerDisassemble = () => {
    if (!onDisassemble) return;
    let base = parseInt(customBaseAddr, 16);
    if (isNaN(base)) base = currentArchitecture === 'xtensa-lx6' ? 0x40080000 : 0x0000;
    onDisassemble(base);
    setCurrentPage(1);
  };

  // If no disassembly result yet
  if (!result) {
    return (
      <div
        className="card"
        style={{
          textAlign: 'center',
          padding: '48px 24px',
          background: '#070a12',
          borderRadius: '8px',
          border: '1px dashed #1e293b',
        }}
      >
        <Code size={40} color="#475569" style={{ margin: '0 auto 16px' }} />
        <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#94a3b8', marginBottom: '8px' }}>
          No Disassembly Available Yet
        </h3>
        <p style={{ fontSize: '13px', color: '#64748b', maxWidth: '520px', margin: '0 auto 20px' }}>
          Firmware must be extracted over USB or loaded from a saved .bin or .hex dump to perform
          architecture-specific offline disassembly.
        </p>

        {firmwareData && firmwareData.length > 0 && onDisassemble && (
          <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>Load Address:</span>
              <input
                type="text"
                value={customBaseAddr}
                onChange={(e) => setCustomBaseAddr(e.target.value)}
                style={{
                  background: '#0f172a',
                  border: '1px solid #334155',
                  borderRadius: '4px',
                  color: '#e2e8f0',
                  padding: '4px 8px',
                  fontSize: '12px',
                  fontFamily: 'monospace',
                  width: '120px',
                }}
              />
            </div>
            <button
              type="button"
              className="btn-primary"
              onClick={handleTriggerDisassemble}
              disabled={isLoading}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
            >
              <Cpu size={16} />
              <span>{isLoading ? 'Disassembling...' : `Disassemble for ${currentArchitecture}`}</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  // Unsupported Architecture / Toolchain Notice
  if (!result.success || result.confidence === 'unsupported') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Banner */}
        <div
          style={{
            background: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid #ef4444',
            borderRadius: '8px',
            padding: '20px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            <AlertTriangle size={24} color="#ef4444" style={{ flexShrink: 0, marginTop: '2px' }} />
            <div>
              <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#f87171', margin: '0 0 6px' }}>
                Disassembly Unavailable for {result.architecture.toUpperCase()}
              </h3>
              <p style={{ fontSize: '13px', color: '#cbd5e1', margin: '0 0 12px' }}>
                {result.confidenceReason}
              </p>

              <div style={{ background: '#020617', borderRadius: '6px', padding: '12px', border: '1px solid #1e293b', marginBottom: '12px' }}>
                <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px', fontWeight: 600 }}>
                  Offline Toolchain Command Requirement
                </div>
                {result.errors.map((err, idx) => (
                  <div key={idx} style={{ fontSize: '12px', fontFamily: 'monospace', color: '#e2e8f0', wordBreak: 'break-all' }}>
                    {err}
                  </div>
                ))}
              </div>

              <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                <strong>Architecture Memory Model Realities:</strong> {result.addressBasisExplanation}
              </div>
            </div>
          </div>
        </div>

        {/* Limitations Card */}
        <div className="card" style={{ padding: '16px', background: '#070a12', border: '1px solid #1e293b' }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: '#94a3b8', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Info size={14} color="#38bdf8" />
            <span>Architecture & Toolchain Boundaries</span>
          </div>
          <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '12px', color: '#64748b', lineHeight: 1.6 }}>
            {result.limitations.map((lim, idx) => (
              <li key={idx}>{lim}</li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Backend & Provenance Header */}
      <div
        className="card"
        style={{
          padding: '16px 20px',
          background: '#070a12',
          border: '1px solid #1e293b',
          borderRadius: '8px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <Cpu size={18} color="#38bdf8" />
              <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#f1f5f9', margin: 0 }}>
                {result.architecture === 'avr8'
                  ? 'ATmega328P / 8-bit AVR Assembly'
                  : 'ESP32 / Xtensa LX6 Assembly'}
              </h3>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: '12px',
                  background: 'rgba(34, 197, 94, 0.15)',
                  color: '#4ade80',
                  border: '1px solid rgba(34, 197, 94, 0.3)',
                  textTransform: 'uppercase',
                }}
              >
                {result.confidence}
              </span>
            </div>

            <div style={{ fontSize: '12px', color: '#64748b' }}>
              Backend: <span style={{ color: '#94a3b8' }}>{result.backendName}</span> ({result.backendVersion})
            </div>
            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
              Address Basis: <span style={{ color: '#38bdf8', fontFamily: 'monospace' }}>{formatHexAddress(result.baseAddress, 6)}</span> — {result.addressBasisExplanation}
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={handleCopy}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}
              title="Copy assembly listing to clipboard"
            >
              {copied ? <Check size={14} color="#4ade80" /> : <Copy size={14} />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>

            <button
              type="button"
              className="btn-primary"
              onClick={handleExport}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}
              title="Download formatted .asm listing file"
            >
              <Download size={14} />
              <span>Export .asm</span>
            </button>
          </div>
        </div>

        {/* Limitations Banner */}
        <div
          style={{
            marginTop: '12px',
            padding: '8px 12px',
            background: 'rgba(56, 189, 248, 0.05)',
            border: '1px solid rgba(56, 189, 248, 0.2)',
            borderRadius: '6px',
            fontSize: '11px',
            color: '#94a3b8',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <Info size={14} color="#38bdf8" style={{ flexShrink: 0 }} />
          <span>
            <strong>Ground Truth Truths:</strong> Assembly recovered from machine instructions.
            Original C variable names, comments, and preprocessor macros are permanently lost in compilation.
            Flash padding (0xFF) represents erased Flash cells.
          </span>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          background: '#070a12',
          padding: '12px 16px',
          borderRadius: '8px',
          border: '1px solid #1e293b',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: '220px' }}>
          <Search size={14} color="#64748b" />
          <input
            type="text"
            placeholder="Search address, mnemonic, operand, or comment (e.g. 'PORTB', 'jmp', '0x0034')..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(1);
            }}
            style={{
              background: '#0f172a',
              border: '1px solid #334155',
              borderRadius: '4px',
              color: '#e2e8f0',
              padding: '6px 10px',
              fontSize: '12px',
              width: '100%',
            }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#94a3b8', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={onlyJumpTargets}
              onChange={(e) => {
                setOnlyJumpTargets(e.target.checked);
                setCurrentPage(1);
              }}
            />
            <span>Jump Targets Only</span>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#94a3b8', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={onlyUndecodable}
              onChange={(e) => {
                setOnlyUndecodable(e.target.checked);
                setCurrentPage(1);
              }}
            />
            <span>Undecodable / Erased Only</span>
          </label>

          <div style={{ fontSize: '12px', color: '#64748b' }}>
            Showing <strong>{filteredInstructions.length}</strong> of {result.totalInstructions} instructions ({result.undecodableCount} raw/erased)
          </div>
        </div>
      </div>

      {/* Assembly Instruction Table */}
      <div
        className="card"
        style={{
          padding: 0,
          background: '#030712',
          border: '1px solid #1e293b',
          borderRadius: '8px',
          overflow: 'hidden',
        }}
      >
        <div style={{ overflowX: 'auto', maxHeight: '600px' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '12px',
              fontFamily: 'monospace',
              textAlign: 'left',
            }}
          >
            <thead>
              <tr style={{ background: '#0b1120', borderBottom: '1px solid #1e293b', color: '#64748b' }}>
                <th style={{ padding: '8px 12px', width: '100px' }}>Address</th>
                {result.architecture === 'avr8' && (
                  <th style={{ padding: '8px 12px', width: '80px' }}>PC Word</th>
                )}
                <th style={{ padding: '8px 12px', width: '110px' }}>Hex Bytes</th>
                <th style={{ padding: '8px 12px', width: '40px', textAlign: 'center' }}>Tag</th>
                <th style={{ padding: '8px 12px', width: '100px' }}>Mnemonic</th>
                <th style={{ padding: '8px 12px', width: '180px' }}>Operands</th>
                <th style={{ padding: '8px 12px' }}>Decoded Comment / Register</th>
              </tr>
            </thead>
            <tbody>
              {pagedInstructions.length === 0 ? (
                <tr>
                  <td colSpan={result.architecture === 'avr8' ? 7 : 6} style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>
                    No instructions match the search criteria.
                  </td>
                </tr>
              ) : (
                pagedInstructions.map((inst, idx) => {
                  const isUndecodable = !inst.isDecodable;
                  const rowBg = inst.isJumpTarget
                    ? 'rgba(56, 189, 248, 0.04)'
                    : idx % 2 === 0
                      ? '#030712'
                      : '#070b19';

                  let mnemonicColor = '#e2e8f0';
                  if (inst.isBranch) mnemonicColor = '#c084fc'; // Purple for branches
                  else if (inst.isCall) mnemonicColor = '#38bdf8'; // Cyan for calls
                  else if (inst.isReturn) mnemonicColor = '#fb923c'; // Orange for returns
                  else if (isUndecodable) mnemonicColor = '#64748b'; // Muted for undecodables

                  return (
                    <tr
                      key={inst.address}
                      style={{
                        background: rowBg,
                        borderBottom: '1px solid #0f172a',
                        borderLeft: inst.isJumpTarget ? '3px solid #38bdf8' : '3px solid transparent',
                      }}
                    >
                      {/* Byte Address */}
                      <td style={{ padding: '6px 12px', color: '#94a3b8' }}>
                        {formatHexAddress(inst.address, 6)}
                      </td>

                      {/* PC Word Address for AVR */}
                      {result.architecture === 'avr8' && (
                        <td style={{ padding: '6px 12px', color: '#64748b' }}>
                          {inst.wordAddress !== undefined
                            ? formatHexAddress(inst.wordAddress, 4)
                            : '-'}
                        </td>
                      )}

                      {/* Raw Bytes */}
                      <td style={{ padding: '6px 12px', color: '#64748b' }}>
                        {inst.rawBytesHex}
                      </td>

                      {/* Jump Target Tag */}
                      <td style={{ padding: '6px 12px', textAlign: 'center' }}>
                        {inst.isJumpTarget && (
                          <span
                            title="Jump Destination Target"
                            style={{
                              display: 'inline-block',
                              fontSize: '10px',
                              fontWeight: 700,
                              color: '#38bdf8',
                              background: 'rgba(56, 189, 248, 0.1)',
                              padding: '1px 4px',
                              borderRadius: '3px',
                            }}
                          >
                            -&gt;
                          </span>
                        )}
                      </td>

                      {/* Mnemonic */}
                      <td style={{ padding: '6px 12px', fontWeight: 600, color: mnemonicColor }}>
                        {inst.mnemonic}
                      </td>

                      {/* Operands */}
                      <td style={{ padding: '6px 12px', color: '#f1f5f9' }}>
                        {inst.operands}
                      </td>

                      {/* Comment */}
                      <td style={{ padding: '6px 12px', color: inst.comment ? '#22c55e' : '#475569' }}>
                        {inst.comment ? `; ${inst.comment}` : ''}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination controls */}
        {totalPages > 1 && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '10px 16px',
              background: '#0b1120',
              borderTop: '1px solid #1e293b',
              fontSize: '12px',
              color: '#94a3b8',
            }}
          >
            <div>
              Page <strong>{currentPage}</strong> of <strong>{totalPages}</strong>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="btn-secondary"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                style={{ padding: '4px 8px', fontSize: '11px' }}
              >
                Previous
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                style={{ padding: '4px 8px', fontSize: '11px' }}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

