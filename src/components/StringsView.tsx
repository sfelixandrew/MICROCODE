/**
 * Extracted Strings Inspector View
 * MICROCODE INSPECTOR — STAGE 7
 *
 * Displays printable ASCII and UTF-8 string sequences extracted from firmware
 * with byte offsets, lengths, and encoding badges.
 */

import React, { useState } from 'react';
import { FileText, Search, Download, Copy, Check } from 'lucide-react';
import type { ExtractedString } from '../parsers/types.ts';
import { formatHexAddress } from '../utils/address.ts';

interface StringsViewProps {
  strings: ExtractedString[];
}

export const StringsView: React.FC<StringsViewProps> = ({ strings }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const filteredStrings = strings.filter((s) =>
    s.value.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const handleCopy = (val: string, idx: number) => {
    navigator.clipboard.writeText(val);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 1500);
  };

  const handleExportTxt = () => {
    const content = filteredStrings
      .map((s) => `[${formatHexAddress(s.offset)}] (${s.encoding}, ${s.length} bytes): ${s.value}`)
      .join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `extracted_strings_${Date.now()}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <FileText size={18} color="#38bdf8" />
          <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#f1f5f9' }}>
            Printable String Extraction ({filteredStrings.length} / {strings.length})
          </h3>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <Search size={14} color="#64748b" style={{ position: 'absolute', left: '10px', top: '9px' }} />
            <input
              type="text"
              placeholder="Search extracted strings..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                background: '#0b1323',
                border: '1px solid #1e293b',
                color: '#f1f5f9',
                borderRadius: '6px',
                padding: '6px 12px 6px 30px',
                fontSize: '12px',
                width: '240px',
              }}
            />
          </div>

          <button
            type="button"
            className="btn-secondary"
            onClick={handleExportTxt}
            disabled={filteredStrings.length === 0}
            style={{ padding: '6px 12px', fontSize: '12px' }}
          >
            <Download size={14} /> Export Strings (.txt)
          </button>
        </div>
      </div>

      {filteredStrings.length === 0 ? (
        <div style={{ padding: '36px', textAlign: 'center', color: '#64748b', fontSize: '13px', background: '#0b1323', borderRadius: '8px' }}>
          {strings.length === 0 ? 'No printable strings extracted.' : 'No strings match search filter.'}
        </div>
      ) : (
        <div style={{ maxHeight: '520px', overflowY: 'auto', background: '#070a12', border: '1px solid #1e293b', borderRadius: '8px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1e293b', color: '#64748b', position: 'sticky', top: 0, background: '#070a12' }}>
                <th style={{ padding: '8px 12px', width: '120px' }}>Offset</th>
                <th style={{ padding: '8px 12px', width: '80px' }}>Encoding</th>
                <th style={{ padding: '8px 12px' }}>String Value</th>
                <th style={{ padding: '8px 12px', width: '60px', textAlign: 'center' }}>Copy</th>
              </tr>
            </thead>
            <tbody>
              {filteredStrings.map((str, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid #0f172a' }}>
                  <td style={{ padding: '6px 12px', fontFamily: 'var(--font-mono)', color: '#93c5fd' }}>
                    {formatHexAddress(str.offset)}
                  </td>
                  <td style={{ padding: '6px 12px' }}>
                    <span
                      className="badge"
                      style={{
                        background: str.encoding === 'ASCII' ? '#3b82f615' : '#8b5cf615',
                        color: str.encoding === 'ASCII' ? '#60a5fa' : '#c084fc',
                        fontSize: '10px',
                      }}
                    >
                      {str.encoding}
                    </span>
                  </td>
                  <td style={{ padding: '6px 12px', fontFamily: 'var(--font-mono)', color: '#f1f5f9', wordBreak: 'break-all' }}>
                    {str.value}
                  </td>
                  <td style={{ padding: '6px 12px', textAlign: 'center' }}>
                    <button
                      type="button"
                      onClick={() => handleCopy(str.value, idx)}
                      style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
                      title="Copy string to clipboard"
                    >
                      {copiedIdx === idx ? <Check size={13} color="#10b981" /> : <Copy size={13} />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

