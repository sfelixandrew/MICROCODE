/**
 * Traceable Approximate Pseudocode Viewer
 * MICROCODE INSPECTOR
 *
 * Renders reconstructed approximate control-flow pseudocode linked directly to assembly addresses.
 *
 * Strict Non-Negotiable Standards:
 * 1. Prominently labeled "APPROXIMATE RECONSTRUCTION / INFERRED PSEUDOCODE".
 * 2. Never claims exact source-code recovery or original .ino retrieval.
 * 3. Shows side-by-side assembly traceability for every statement.
 * 4. Strictly uses synthetic names (func_00001234, var_r16).
 * 5. Optional LLM explainer is strictly opt-in, discloses text sent, redacts secrets, and labels outputs as hypotheses.
 */

import React, { useState, useMemo } from 'react';
import {
  Code,
  ShieldAlert,
  Cpu,
  Layers,
  ArrowRight,
  Info,
  Check,
  Copy,
  Download,
  Terminal,
  Bot,
  AlertTriangle,
  Lock,
  Search,
  CheckCircle2,
  HelpCircle,
} from 'lucide-react';
import type { AnalysisReport, FunctionBoundary, PseudocodeBlock } from '../analysis/types.ts';
import { OptionalLlmExplainer, type LlmExplanationResult } from '../analysis/llm/OptionalLlmExplainer.ts';
import { formatHexAddress } from '../utils/address.ts';

interface PseudocodeViewProps {
  report: AnalysisReport | null;
  isLoading?: boolean;
}

export const PseudocodeView: React.FC<PseudocodeViewProps> = ({
  report,
  isLoading = false,
}) => {
  const [selectedFunctionName, setSelectedFunctionName] = useState<string | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<'pseudocode' | 'trace' | 'cfg' | 'peripherals' | 'llm'>('pseudocode');
  const [copied, setCopied] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Optional LLM State
  const [llmOptIn, setLlmOptIn] = useState(false);
  const [llmMode, setLlmMode] = useState<'local_only' | 'custom_endpoint'>('local_only');
  const [endpointUrl, setEndpointUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [llmResult, setLlmResult] = useState<LlmExplanationResult | null>(null);
  const [isLlmLoading, setIsLlmLoading] = useState(false);

  // Active selected function and block
  const activeFunction = useMemo(() => {
    if (!report || report.functions.length === 0) return null;
    if (selectedFunctionName) {
      const match = report.functions.find((f) => f.name === selectedFunctionName);
      if (match) return match;
    }
    return report.functions[0];
  }, [report, selectedFunctionName]);

  const activeBlock = useMemo(() => {
    if (!report || !activeFunction) return null;
    return (
      report.pseudocodeBlocks.find((p) => p.functionName === activeFunction.name) ||
      report.pseudocodeBlocks[0] ||
      null
    );
  }, [report, activeFunction]);

  // Filtered function list
  const filteredFunctions = useMemo(() => {
    if (!report) return [];
    if (!searchTerm.trim()) return report.functions;
    const term = searchTerm.toLowerCase().trim();
    return report.functions.filter(
      (f) =>
        f.name.toLowerCase().includes(term) ||
        formatHexAddress(f.entryAddress, 6).toLowerCase().includes(term) ||
        f.peripheralAccesses.some((p) => p.registerName.toLowerCase().includes(term))
    );
  }, [report, searchTerm]);

  const handleCopyCode = () => {
    if (!activeBlock) return;
    navigator.clipboard.writeText(activeBlock.pseudocodeText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExportPseudocode = () => {
    if (!activeBlock) return;
    const blob = new Blob([activeBlock.pseudocodeText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${activeBlock.functionName}_reconstruction.c`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleTriggerLlm = async () => {
    if (!activeFunction || !llmOptIn) return;
    setIsLlmLoading(true);
    try {
      const res = await OptionalLlmExplainer.explain(activeFunction, {
        optInConfirmed: llmOptIn,
        mode: llmMode,
        endpointUrl: endpointUrl.trim() || undefined,
        apiKey: apiKey.trim() || undefined,
      });
      setLlmResult(res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setLlmResult({
        isOptedIn: true,
        provider: 'Error',
        disclosedPayload: '',
        redactedSecretsCount: 0,
        explanationText: `Explanation failed: ${msg}`,
        isHypothesis: true,
        hypothesisNotice: OptionalLlmExplainer.HYPOTHESIS_NOTICE,
        warning: msg,
      });
    } finally {
      setIsLlmLoading(false);
    }
  };

  if (!report || report.functions.length === 0) {
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
          No Disassembly Available for Pseudocode Reconstruction
        </h3>
        <p style={{ fontSize: '13px', color: '#64748b', maxWidth: '520px', margin: '0 auto 20px' }}>
          Run firmware extraction or load a firmware file (.bin / .hex), then run architecture disassembly
          to generate approximate control-flow pseudocode with explicit assembly traceability.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Non-Negotiable Transparency Banner */}
      <div
        style={{
          background: 'rgba(56, 189, 248, 0.05)',
          border: '1px solid rgba(56, 189, 248, 0.25)',
          borderRadius: '8px',
          padding: '14px 18px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
          <ShieldAlert size={18} color="#38bdf8" />
          <h4 style={{ fontSize: '14px', fontWeight: 700, color: '#f1f5f9', margin: 0 }}>
            APPROXIMATE RECONSTRUCTION / INFERRED PSEUDOCODE
          </h4>
          <span
            style={{
              fontSize: '10px',
              fontWeight: 700,
              padding: '2px 6px',
              borderRadius: '4px',
              background: 'rgba(234, 179, 8, 0.15)',
              color: '#facc15',
              border: '1px solid rgba(234, 179, 8, 0.3)',
              textTransform: 'uppercase',
            }}
          >
            Hypothesis Only
          </span>
        </div>
        <p style={{ fontSize: '12px', color: '#94a3b8', margin: 0, lineHeight: 1.5 }}>
          <strong>Decompilation vs. Source Recovery:</strong> Reconstructed control-flow is an approximate hypothesis.
          Original C / Arduino <code style={{ color: '#38bdf8' }}>.ino</code> variable names, local types, struct layouts, comments,
          and preprocessor directives (<code style={{ color: '#38bdf8' }}>#define</code>, <code style={{ color: '#38bdf8' }}>F()</code>)
          were permanently lost during compilation and cannot be recovered from Flash.
          All statements are traceable to ground-truth assembly below.
        </p>
      </div>

      {/* Main Workspace: Left Function List, Right Pseudocode & Traceability */}
      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '16px', minHeight: '620px' }}>
        {/* Left Sidebar: Detected Subroutines */}
        <div
          className="card"
          style={{
            padding: '12px',
            background: '#070a12',
            border: '1px solid #1e293b',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
            <Search size={14} color="#64748b" />
            <input
              type="text"
              placeholder="Search functions (e.g. PORTB)..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                background: '#0f172a',
                border: '1px solid #334155',
                borderRadius: '4px',
                color: '#e2e8f0',
                padding: '4px 8px',
                fontSize: '11px',
                width: '100%',
              }}
            />
          </div>

          <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>
            Detected Functions ({filteredFunctions.length})
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', overflowY: 'auto', maxHeight: '550px' }}>
            {filteredFunctions.map((fn) => {
              const isSelected = activeFunction?.name === fn.name;
              let badgeColor = '#64748b';
              let badgeBg = 'rgba(100, 116, 139, 0.15)';
              if (fn.confidence === 'verified') {
                badgeColor = '#4ade80';
                badgeBg = 'rgba(34, 197, 94, 0.15)';
              } else if (fn.confidence === 'high') {
                badgeColor = '#38bdf8';
                badgeBg = 'rgba(56, 189, 248, 0.15)';
              } else if (fn.confidence === 'medium') {
                badgeColor = '#facc15';
                badgeBg = 'rgba(234, 179, 8, 0.15)';
              }

              return (
                <div
                  key={fn.name}
                  onClick={() => setSelectedFunctionName(fn.name)}
                  style={{
                    padding: '8px 10px',
                    borderRadius: '6px',
                    background: isSelected ? 'rgba(56, 189, 248, 0.1)' : '#0b1120',
                    border: isSelected ? '1px solid #38bdf8' : '1px solid #1e293b',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, fontFamily: 'monospace', color: isSelected ? '#38bdf8' : '#e2e8f0' }}>
                      {fn.name}
                    </span>
                    <span
                      style={{
                        fontSize: '9px',
                        fontWeight: 700,
                        padding: '1px 5px',
                        borderRadius: '4px',
                        background: badgeBg,
                        color: badgeColor,
                        textTransform: 'uppercase',
                      }}
                    >
                      {fn.confidence}
                    </span>
                  </div>

                  <div style={{ fontSize: '10px', color: '#64748b', marginTop: '2px', display: 'flex', justifyContent: 'space-between' }}>
                    <span>{formatHexAddress(fn.entryAddress, 4)} – {formatHexAddress(fn.endAddress, 4)}</span>
                    <span>{fn.instructionCount} inst</span>
                  </div>

                  {fn.peripheralAccesses.length > 0 && (
                    <div style={{ display: 'flex', gap: '4px', marginTop: '4px', flexWrap: 'wrap' }}>
                      {fn.peripheralAccesses.slice(0, 3).map((p, idx) => (
                        <span
                          key={idx}
                          style={{
                            fontSize: '9px',
                            background: '#020617',
                            color: '#22c55e',
                            padding: '1px 4px',
                            borderRadius: '3px',
                            fontFamily: 'monospace',
                          }}
                        >
                          {p.registerName}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Content Pane: Pseudocode, Trace, CFG, Peripherals, AI Explainer */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Subroutine Header */}
          {activeFunction && (
            <div
              className="card"
              style={{
                padding: '14px 18px',
                background: '#070a12',
                border: '1px solid #1e293b',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '12px',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <h3 style={{ fontSize: '16px', fontWeight: 700, fontFamily: 'monospace', color: '#f1f5f9', margin: 0 }}>
                    {activeFunction.name}
                  </h3>
                  <span style={{ fontSize: '11px', color: '#64748b' }}>
                    ({formatHexAddress(activeFunction.entryAddress, 6)} – {formatHexAddress(activeFunction.endAddress, 6)})
                  </span>
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 700,
                      padding: '2px 6px',
                      borderRadius: '4px',
                      background: 'rgba(34, 197, 94, 0.15)',
                      color: '#4ade80',
                      textTransform: 'uppercase',
                    }}
                  >
                    Score: {(activeFunction.confidenceScore * 100).toFixed(0)}%
                  </span>
                </div>

                <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
                  {activeFunction.confidenceReasons.join(' • ')}
                </div>
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleCopyCode}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px' }}
                >
                  {copied ? <Check size={13} color="#4ade80" /> : <Copy size={13} />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>

                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleExportPseudocode}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px' }}
                >
                  <Download size={13} />
                  <span>Export .c</span>
                </button>
              </div>
            </div>
          )}

          {/* Sub-tab navigation */}
          <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid #1e293b', paddingBottom: '8px' }}>
            <button
              type="button"
              className={`tab-btn ${activeSubTab === 'pseudocode' ? 'active' : ''}`}
              onClick={() => setActiveSubTab('pseudocode')}
              style={{ fontSize: '12px', padding: '6px 12px' }}
            >
              Inferred Pseudocode
            </button>
            <button
              type="button"
              className={`tab-btn ${activeSubTab === 'trace' ? 'active' : ''}`}
              onClick={() => setActiveSubTab('trace')}
              style={{ fontSize: '12px', padding: '6px 12px' }}
            >
              Assembly Traceability ({activeBlock?.traceMappings.length || 0})
            </button>
            <button
              type="button"
              className={`tab-btn ${activeSubTab === 'peripherals' ? 'active' : ''}`}
              onClick={() => setActiveSubTab('peripherals')}
              style={{ fontSize: '12px', padding: '6px 12px' }}
            >
              Peripherals ({activeFunction?.peripheralAccesses.length || 0})
            </button>
            <button
              type="button"
              className={`tab-btn ${activeSubTab === 'cfg' ? 'active' : ''}`}
              onClick={() => setActiveSubTab('cfg')}
              style={{ fontSize: '12px', padding: '6px 12px' }}
            >
              CFG &amp; Loops ({activeFunction?.basicBlocks.length || 0} blocks)
            </button>
            <button
              type="button"
              className={`tab-btn ${activeSubTab === 'llm' ? 'active' : ''}`}
              onClick={() => setActiveSubTab('llm')}
              style={{ fontSize: '12px', padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <Bot size={13} />
              <span>AI Explainer (Opt-In)</span>
            </button>
          </div>

          {/* Tab Content 1: Reconstructed Pseudocode */}
          {activeSubTab === 'pseudocode' && activeBlock && (
            <div
              className="card"
              style={{
                padding: '16px',
                background: '#030712',
                border: '1px solid #1e293b',
                borderRadius: '8px',
                fontFamily: 'monospace',
                fontSize: '12px',
                color: '#e2e8f0',
                overflowX: 'auto',
                whiteSpace: 'pre',
                lineHeight: 1.6,
                maxHeight: '520px',
              }}
            >
              {activeBlock.pseudocodeText}
            </div>
          )}

          {/* Tab Content 2: Assembly Traceability */}
          {activeSubTab === 'trace' && activeBlock && (
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
              <div style={{ overflowX: 'auto', maxHeight: '520px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', fontFamily: 'monospace' }}>
                  <thead>
                    <tr style={{ background: '#0b1120', borderBottom: '1px solid #1e293b', color: '#64748b', textAlign: 'left' }}>
                      <th style={{ padding: '8px 12px', width: '90px' }}>Address</th>
                      <th style={{ padding: '8px 12px', width: '220px' }}>Ground-Truth Assembly</th>
                      <th style={{ padding: '8px 12px', width: '240px' }}>Confirmed Machine Fact</th>
                      <th style={{ padding: '8px 12px' }}>Inferred High-Level Meaning</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeBlock.traceMappings.map((m, idx) => (
                      <tr
                        key={idx}
                        style={{
                          background: idx % 2 === 0 ? '#030712' : '#070b19',
                          borderBottom: '1px solid #0f172a',
                        }}
                      >
                        <td style={{ padding: '6px 12px', color: '#38bdf8' }}>
                          {formatHexAddress(m.address, 6)}
                        </td>
                        <td style={{ padding: '6px 12px', color: '#f1f5f9' }}>
                          {m.assemblyLine}
                        </td>
                        <td style={{ padding: '6px 12px', color: '#94a3b8' }}>
                          {m.confirmedFact}
                        </td>
                        <td style={{ padding: '6px 12px', color: m.inferredMeaning ? '#4ade80' : '#475569' }}>
                          {m.inferredMeaning || 'Direct register / ALU operation'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Tab Content 3: Hardware Peripheral Accesses */}
          {activeSubTab === 'peripherals' && activeFunction && (
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
              {activeFunction.peripheralAccesses.length === 0 ? (
                <div style={{ padding: '32px', textAlign: 'center', color: '#64748b', fontSize: '12px' }}>
                  No hardware I/O peripheral accesses detected in this subroutine.
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ background: '#0b1120', borderBottom: '1px solid #1e293b', color: '#64748b' }}>
                      <th style={{ padding: '8px 12px', width: '90px' }}>Address</th>
                      <th style={{ padding: '8px 12px', width: '100px' }}>Register</th>
                      <th style={{ padding: '8px 12px', width: '90px' }}>Access</th>
                      <th style={{ padding: '8px 12px' }}>Confirmed Hardware Fact</th>
                      <th style={{ padding: '8px 12px' }}>Inferred Meaning</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeFunction.peripheralAccesses.map((p, idx) => (
                      <tr
                        key={idx}
                        style={{
                          background: idx % 2 === 0 ? '#030712' : '#070b19',
                          borderBottom: '1px solid #0f172a',
                        }}
                      >
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: '#38bdf8' }}>
                          {formatHexAddress(p.instructionAddress, 6)}
                        </td>
                        <td style={{ padding: '8px 12px', fontWeight: 700, color: '#22c55e', fontFamily: 'monospace' }}>
                          {p.registerName}
                        </td>
                        <td style={{ padding: '8px 12px', textTransform: 'uppercase', color: '#94a3b8' }}>
                          {p.accessType}
                        </td>
                        <td style={{ padding: '8px 12px', color: '#cbd5e1' }}>
                          {p.confirmedFact}
                        </td>
                        <td style={{ padding: '8px 12px', color: '#4ade80' }}>
                          {p.inferredMeaning}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Tab Content 4: CFG & Loop Patterns */}
          {activeSubTab === 'cfg' && activeFunction && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* Loop summary */}
              {activeFunction.loopPatterns.length > 0 && (
                <div className="card" style={{ padding: '12px 16px', background: '#070a12', border: '1px solid #1e293b' }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#c084fc', marginBottom: '6px' }}>
                    Detected Loop Patterns ({activeFunction.loopPatterns.length})
                  </div>
                  {activeFunction.loopPatterns.map((l, idx) => (
                    <div key={idx} style={{ fontSize: '11px', color: '#94a3b8', lineHeight: 1.5 }}>
                      • <strong>{l.kind.replace('_', ' ').toUpperCase()}</strong> at {formatHexAddress(l.headerAddress, 4)}: {l.confidenceReason}
                    </div>
                  ))}
                </div>
              )}

              {/* Blocks */}
              <div
                className="card"
                style={{
                  padding: '12px',
                  background: '#030712',
                  border: '1px solid #1e293b',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  maxHeight: '400px',
                  overflowY: 'auto',
                }}
              >
                {activeFunction.basicBlocks.map((b) => (
                  <div
                    key={b.id}
                    style={{
                      padding: '8px 12px',
                      background: '#0b1120',
                      border: '1px solid #1e293b',
                      borderRadius: '6px',
                      fontSize: '11px',
                      fontFamily: 'monospace',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#38bdf8', fontWeight: 700 }}>
                      <span>{b.id} ({formatHexAddress(b.startAddress, 4)} – {formatHexAddress(b.endAddress, 4)})</span>
                      <span style={{ color: '#94a3b8' }}>Terminator: {b.terminatorType}</span>
                    </div>
                    <div style={{ color: '#64748b', marginTop: '4px' }}>
                      Successors: {b.successorAddresses.map((a) => formatHexAddress(a, 4)).join(', ') || 'none (exit)'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tab Content 5: Optional AI Logic Explainer */}
          {activeSubTab === 'llm' && activeFunction && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div
                className="card"
                style={{
                  padding: '16px',
                  background: '#070a12',
                  border: '1px solid #1e293b',
                  borderRadius: '8px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <Bot size={18} color="#c084fc" />
                  <h4 style={{ fontSize: '14px', fontWeight: 700, color: '#f1f5f9', margin: 0 }}>
                    Optional AI Logic Explanation (Strictly Opt-In)
                  </h4>
                </div>

                <div
                  style={{
                    background: 'rgba(192, 132, 252, 0.08)',
                    border: '1px solid rgba(192, 132, 252, 0.25)',
                    borderRadius: '6px',
                    padding: '10px 14px',
                    fontSize: '11px',
                    color: '#cbd5e1',
                    marginBottom: '12px',
                  }}
                >
                  <strong>Privacy &amp; Security Guardrails:</strong>
                  <ul style={{ margin: '4px 0 0', paddingLeft: '18px', lineHeight: 1.5 }}>
                    <li>Disabled by default. Never runs without your explicit toggle.</li>
                    <li>Zero firmware binaries are ever transmitted.</li>
                    <li>Only sanitized disassembly instruction text is analyzed.</li>
                    <li>Likely secrets, API tokens, and Wi-Fi credentials are automatically redacted locally.</li>
                    <li>AI output is presented strictly as an unverified hypothesis, NOT ground truth.</li>
                  </ul>
                </div>

                {/* Opt-in toggle */}
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#f1f5f9', cursor: 'pointer', marginBottom: '12px' }}>
                  <input
                    type="checkbox"
                    checked={llmOptIn}
                    onChange={(e) => setLlmOptIn(e.target.checked)}
                  />
                  <span>I understand that AI output is an approximate hypothesis and opt-in to generate explanations.</span>
                </label>

                {llmOptIn && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '8px' }}>
                    <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                      <label style={{ fontSize: '11px', color: '#94a3b8' }}>Mode:</label>
                      <label style={{ fontSize: '11px', color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <input
                          type="radio"
                          name="llmMode"
                          checked={llmMode === 'local_only'}
                          onChange={() => setLlmMode('local_only')}
                        />
                        <span>Local-Only Mode (Offline Rule Synthesizer, 0 Network Calls)</span>
                      </label>
                      <label style={{ fontSize: '11px', color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <input
                          type="radio"
                          name="llmMode"
                          checked={llmMode === 'custom_endpoint'}
                          onChange={() => setLlmMode('custom_endpoint')}
                        />
                        <span>Custom Endpoint</span>
                      </label>
                    </div>

                    {llmMode === 'custom_endpoint' && (
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <input
                          type="text"
                          placeholder="Endpoint URL (e.g. http://127.0.0.1:11434/api/generate)..."
                          value={endpointUrl}
                          onChange={(e) => setEndpointUrl(e.target.value)}
                          style={{
                            background: '#0f172a',
                            border: '1px solid #334155',
                            borderRadius: '4px',
                            color: '#e2e8f0',
                            padding: '6px 10px',
                            fontSize: '11px',
                            flex: 1,
                          }}
                        />
                        <input
                          type="password"
                          placeholder="Optional API Key..."
                          value={apiKey}
                          onChange={(e) => setApiKey(e.target.value)}
                          style={{
                            background: '#0f172a',
                            border: '1px solid #334155',
                            borderRadius: '4px',
                            color: '#e2e8f0',
                            padding: '6px 10px',
                            fontSize: '11px',
                            width: '180px',
                          }}
                        />
                      </div>
                    )}

                    <button
                      type="button"
                      className="btn-primary"
                      onClick={handleTriggerLlm}
                      disabled={isLlmLoading}
                      style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px' }}
                    >
                      <Bot size={14} />
                      <span>{isLlmLoading ? 'Synthesizing...' : `Explain ${activeFunction.name}`}</span>
                    </button>
                  </div>
                )}
              </div>

              {/* LLM Result Box */}
              {llmResult && (
                <div
                  className="card"
                  style={{
                    padding: '16px',
                    background: '#030712',
                    border: '1px solid #c084fc',
                    borderRadius: '8px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: '#c084fc', textTransform: 'uppercase' }}>
                      {llmResult.provider}
                    </span>
                    <span
                      style={{
                        fontSize: '9px',
                        fontWeight: 700,
                        padding: '1px 5px',
                        borderRadius: '4px',
                        background: 'rgba(234, 179, 8, 0.15)',
                        color: '#facc15',
                      }}
                    >
                      UNVERIFIED HYPOTHESIS
                    </span>
                  </div>

                  <div style={{ fontSize: '11px', color: '#facc15', marginBottom: '10px' }}>
                    {llmResult.hypothesisNotice}
                  </div>

                  <div
                    style={{
                      fontSize: '12px',
                      color: '#e2e8f0',
                      lineHeight: 1.6,
                      whiteSpace: 'pre-wrap',
                      background: '#0b1120',
                      padding: '12px',
                      borderRadius: '6px',
                      border: '1px solid #1e293b',
                    }}
                  >
                    {llmResult.explanationText}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

