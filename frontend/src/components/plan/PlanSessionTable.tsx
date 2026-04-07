import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet } from '../../api/client';
import type { Plan, BoardSession, SessionListItem, LapBandSummary } from '../../types/models';
import { convertPressure, pressureDecimals, type PressureUnit } from '../../utils/units';
import Button from '../ui/Button';
import SessionRolloutPressureModal from '../session/SessionRolloutPressureModal';

interface Props {
  plan: Plan;
  sessions: BoardSession[];
  pressureUnit: PressureUnit;
  onAddSession: (sid: string) => void;
  onRemoveSession: (sid: string) => void;
}

const LS_COL_WIDTHS = 'planSessionTable:colWidths';

interface ColDef {
  key: string;
  label: string;
  title?: string;
  defaultWidth: number;
  minWidth?: number;
}

const COLUMNS: ColDef[] = [
  { key: 'session', label: 'Session', defaultWidth: 130, minWidth: 70 },
  { key: 'role', label: 'Role', defaultWidth: 60, minWidth: 36 },
  { key: 'tgt', label: 'Tgt', defaultWidth: 50, minWidth: 36 },
  { key: 'rollout', label: 'Roll-out', defaultWidth: 90, minWidth: 60 },
  { key: 'acceptable', label: 'Acceptable', title: 'First and last lap where the average of all 4 corners is within acceptable tolerance', defaultWidth: 90, minWidth: 60 },
  { key: 'optimal', label: 'Optimal', title: 'First and last lap where the average of all 4 corners is within optimal tolerance', defaultWidth: 80, minWidth: 60 },
  { key: 'out', label: 'Out', title: 'Laps outside optimal after first entering the window (worst-corner)', defaultWidth: 40, minWidth: 30 },
  { key: 'deltaTarget', label: 'Δ @ Target', title: 'Per-corner delta from target when the 4-tire average is closest to target', defaultWidth: 90, minWidth: 60 },
  { key: 'deltaSustained', label: 'Δ Sustained', title: 'Average per-corner delta from optimal entry through end of session', defaultWidth: 90, minWidth: 60 },
  { key: 'deltaMax', label: 'Δ Max', title: 'Maximum per-corner delta from target after the 4-tire average reaches target', defaultWidth: 90, minWidth: 60 },
  { key: 'menu', label: '', defaultWidth: 40, minWidth: 32 },
];

function loadColWidths(): Record<string, number> {
  try {
    const raw = localStorage.getItem(LS_COL_WIDTHS);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

function saveColWidths(w: Record<string, number>) {
  try { localStorage.setItem(LS_COL_WIDTHS, JSON.stringify(w)); } catch { /* ignore */ }
}

export default function PlanSessionTable({ plan, sessions, pressureUnit, onAddSession, onRemoveSession }: Props) {
  const qc = useQueryClient();
  const [showPicker, setShowPicker] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [rolloutSession, setRolloutSession] = useState<BoardSession | null>(null);
  const [colWidths, setColWidths] = useState<Record<string, number>>(loadColWidths);

  const getW = useCallback((key: string) => {
    const col = COLUMNS.find(c => c.key === key);
    return colWidths[key] ?? col?.defaultWidth ?? 80;
  }, [colWidths]);

  const onResizeStart = useCallback((colKey: string, e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = getW(colKey);
    const minW = COLUMNS.find(c => c.key === colKey)?.minWidth ?? 30;
    const onMove = (ev: MouseEvent) => {
      const w = Math.max(minW, startW + ev.clientX - startX);
      setColWidths(prev => ({ ...prev, [colKey]: w }));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setColWidths(prev => { saveColWidths(prev); return prev; });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [getW]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
        <h3 style={{ margin: 0, fontSize: 14, flex: 1 }}>Sessions</h3>
        <Button size="sm" variant="secondary" onClick={() => setShowPicker(!showPicker)}>
          {showPicker ? 'Cancel' : '+ Add Session'}
        </Button>
      </div>
      <p className="text-muted" style={{ margin: '0 0 8px', fontSize: 12 }}>
        Pressure charts below show full-session TPMS traces for these sessions.
      </p>

      {showPicker && (
        <SessionPicker
          excludeIds={plan.session_ids}
          onSelect={(sid) => { onAddSession(sid); setShowPicker(false); }}
        />
      )}

      {sessions.length === 0 ? (
        <div className="card" style={{ padding: 24, textAlign: 'center' }}>
          <span className="text-muted">No sessions linked yet. Add sessions to begin analysis.</span>
        </div>
      ) : (
        <div className="card" style={{ overflow: 'auto' }}>
          <table className="data-table" style={{ width: '100%', fontSize: 12, tableLayout: 'fixed', borderCollapse: 'collapse' }}>
            <colgroup>
              {COLUMNS.map(c => <col key={c.key} style={{ width: getW(c.key) }} />)}
            </colgroup>
            <thead>
              <tr>
                {COLUMNS.map(c => (
                  <th
                    key={c.key}
                    title={c.title}
                    style={{ position: 'relative', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: c.key === 'role' ? 11 : undefined }}
                  >
                    {c.label}
                    {c.key !== 'menu' && (
                      <span
                        onMouseDown={e => onResizeStart(c.key, e)}
                        style={{
                          position: 'absolute', right: 0, top: 0, bottom: 0, width: 5,
                          cursor: 'col-resize', userSelect: 'none',
                        }}
                      />
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sessions.map(s => {
                const ro = s.roll_out_psi;
                const dec = pressureDecimals(pressureUnit);
                const cv = (v: number | null | undefined) => v != null ? convertPressure(v, 'psi', pressureUnit) : v;
                const hasRollout = [ro.fl, ro.fr, ro.rl, ro.rr].some(v => v != null);

                const band = getBand(s, plan);
                const cd = band?.corner_delta_psi;
                const sd = band?.sustained_delta_psi;
                const md = band?.max_delta_psi;
                const fmtD = (src: Record<string, number | null> | null | undefined, c: string) => {
                  const d = src && src[c] != null ? cv(src[c] as number) : null;
                  if (d == null) return '—';
                  return `${d > 0 ? '+' : ''}${d.toFixed(dec)}`;
                };

                const shortLabel = s.label.replace(/\s*\(.*?\)\s*$/, '');
                const cellClip: React.CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

                return (
                  <tr key={s.id} style={{ borderBottom: '6px solid transparent' }}>
                    <td style={cellClip}>
                      <button
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)', textAlign: 'left', padding: 0, fontSize: 12, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        onClick={() => setExpandedRow(expandedRow === s.id ? null : s.id)}
                        title={s.label}
                      >
                        {expandedRow === s.id ? '▾' : '▸'} {shortLabel}
                      </button>
                      {expandedRow === s.id && (
                        <div style={{ padding: '8px 0 4px 16px', fontSize: 11, whiteSpace: 'normal' }}>
                          <ExpandedRow session={s} pressureUnit={pressureUnit} />
                        </div>
                      )}
                    </td>
                    <td style={{ ...cellClip, fontSize: 10 }}>
                      {s.planning_tag ? (
                        <span style={{
                          display: 'inline-block', padding: '0px 6px', borderRadius: 8,
                          fontSize: 10, background: 'var(--bg)', border: '1px solid var(--border)',
                        }}>
                          {s.planning_tag}
                        </span>
                      ) : ''}
                    </td>
                    <td style={cellClip}>{s.target_pressure_psi != null ? cv(s.target_pressure_psi)!.toFixed(dec) : '—'}</td>
                    <td style={{ padding: '2px 6px' }}>
                      {hasRollout ? (
                        <CornerGrid fl={fmt(cv(ro.fl), dec)} fr={fmt(cv(ro.fr), dec)} rl={fmt(cv(ro.rl), dec)} rr={fmt(cv(ro.rr), dec)} />
                      ) : '—'}
                    </td>
                    <td style={{ ...cellClip, fontSize: 11 }}>{fmtLapRange(band?.avg_first_acceptable_lap, band?.avg_last_acceptable_lap)}</td>
                    <td style={{ ...cellClip, fontSize: 11 }}>{fmtLapRange(band?.avg_first_optimal_lap, band?.avg_last_optimal_lap)}</td>
                    <td style={{ ...cellClip, fontSize: 11 }}>{band?.laps_outside_optimal_after_entry != null ? band.laps_outside_optimal_after_entry : '—'}</td>
                    <td style={{
                      padding: '2px 6px',
                      ...(cd && band?.avg_first_optimal_lap == null ? { background: 'rgba(239,68,68,0.1)' } : {}),
                    }}>
                      {cd ? (
                        <CornerGrid fl={fmtD(cd, 'fl')} fr={fmtD(cd, 'fr')} rl={fmtD(cd, 'rl')} rr={fmtD(cd, 'rr')} />
                      ) : '—'}
                    </td>
                    <td style={{ padding: '2px 6px' }}>
                      {sd ? (
                        <CornerGrid fl={fmtD(sd, 'fl')} fr={fmtD(sd, 'fr')} rl={fmtD(sd, 'rl')} rr={fmtD(sd, 'rr')} />
                      ) : '—'}
                    </td>
                    <td style={{ padding: '2px 6px' }}>
                      {md ? (
                        <CornerGrid fl={fmtD(md, 'fl')} fr={fmtD(md, 'fr')} rl={fmtD(md, 'rl')} rr={fmtD(md, 'rr')} />
                      ) : '—'}
                    </td>
                    <td>
                      <SessionRowMenu
                        sessionId={s.id}
                        open={menuOpen === s.id}
                        onToggle={() => setMenuOpen(menuOpen === s.id ? null : s.id)}
                        onClose={() => setMenuOpen(null)}
                        onEditRollout={() => { setRolloutSession(s); setMenuOpen(null); }}
                        onRemove={() => { onRemoveSession(s.id); setMenuOpen(null); }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <SessionRolloutPressureModal
        open={rolloutSession != null}
        onClose={() => setRolloutSession(null)}
        onSuccess={() => qc.invalidateQueries({ queryKey: ['plan-board-data', plan.id] })}
        sessionId={rolloutSession?.id ?? ''}
        sessionLabel={rolloutSession?.label}
        displayUnit={pressureUnit}
        initialCorners={rolloutSession ? {
          fl: rolloutSession.roll_out_psi.fl != null ? convertPressure(rolloutSession.roll_out_psi.fl, 'psi', pressureUnit) : null,
          fr: rolloutSession.roll_out_psi.fr != null ? convertPressure(rolloutSession.roll_out_psi.fr, 'psi', pressureUnit) : null,
          rl: rolloutSession.roll_out_psi.rl != null ? convertPressure(rolloutSession.roll_out_psi.rl, 'psi', pressureUnit) : null,
          rr: rolloutSession.roll_out_psi.rr != null ? convertPressure(rolloutSession.roll_out_psi.rr, 'psi', pressureUnit) : null,
        } : { fl: null, fr: null, rl: null, rr: null }}
      />
    </div>
  );
}

function CornerGrid({ fl, fr, rl, rr }: { fl: string; fr: string; rl: string; rr: string }) {
  const divColor = 'rgba(255,255,255,0.18)';
  return (
    <div style={{ display: 'inline-grid', gridTemplateColumns: 'auto auto auto', fontFamily: 'monospace', fontSize: 10, lineHeight: 1.5, whiteSpace: 'nowrap' }}>
      <span style={{ textAlign: 'right', padding: '0 4px 0 0' }}>{fl}</span>
      <span style={{ borderLeft: `1px solid ${divColor}`, borderRight: `1px solid ${divColor}`, width: 0 }} />
      <span style={{ padding: '0 0 0 4px' }}>{fr}</span>
      <span style={{ gridColumn: '1 / -1', borderTop: `1px solid ${divColor}`, margin: '1px 0' }} />
      <span style={{ textAlign: 'right', padding: '0 4px 0 0' }}>{rl}</span>
      <span style={{ borderLeft: `1px solid ${divColor}`, borderRight: `1px solid ${divColor}`, width: 0 }} />
      <span style={{ padding: '0 0 0 4px' }}>{rr}</span>
    </div>
  );
}

function ExpandedRow({ session, pressureUnit }: { session: BoardSession; pressureUnit: PressureUnit }) {
  const ts = session.tire_summary as Record<string, Record<string, number>> | null;
  const ro = session.roll_out_psi;
  const dec = pressureDecimals(pressureUnit);
  const cv = (v: number) => convertPressure(v, 'psi', pressureUnit);
  const cornerVals = [ro.fl, ro.fr, ro.rl, ro.rr].filter((v): v is number => v != null).map(cv);
  const cornerMean = cornerVals.length > 0 ? cornerVals.reduce((a, b) => a + b, 0) / cornerVals.length : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {session.tire_set_name && <div>Tire set: <strong>{session.tire_set_name}</strong></div>}
      {session.bleed_events.length > 0 && <div>Bleeds: {session.bleed_events.length}</div>}
      {cornerMean != null && (
        <div style={{ fontSize: 12, marginTop: 2 }}>
          <strong>Corner spread (roll-out):</strong>{' '}
          {(['fl', 'fr', 'rl', 'rr'] as const).map(c => {
            const v = ro[c];
            if (v == null) return `${c.toUpperCase()}: —`;
            const delta = cv(v) - cornerMean;
            return `${c.toUpperCase()}: ${delta > 0 ? '+' : ''}${delta.toFixed(dec)}`;
          }).join('  ')}
        </div>
      )}
      {ts && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 4 }}>
          {['fl', 'fr', 'rl', 'rr'].map(corner => {
            const c = ts[corner];
            if (!c) return <div key={corner}>{corner.toUpperCase()}: —</div>;
            return (
              <div key={corner}>
                <div style={{ fontWeight: 600, textTransform: 'uppercase' }}>{corner}</div>
                <div className="text-muted">
                  min {cv(c.min)?.toFixed(dec)} / avg {cv(c.avg)?.toFixed(dec)} / max {cv(c.max)?.toFixed(dec)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SessionRowMenu({
  sessionId,
  open,
  onToggle,
  onClose,
  onEditRollout,
  onRemove,
}: {
  sessionId: string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onEditRollout: () => void;
  onRemove: () => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, left: rect.right });
  }, [open]);

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (
      menuRef.current && !menuRef.current.contains(e.target as Node) &&
      btnRef.current && !btnRef.current.contains(e.target as Node)
    ) {
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open, handleClickOutside]);

  return (
    <>
      <button
        ref={btnRef}
        onClick={onToggle}
        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--text-muted)' }}
      >
        ⋯
      </button>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            transform: 'translateX(-100%)',
            zIndex: 10000,
            background: 'var(--bg, #1a1a1e)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
            minWidth: 180,
            padding: '4px 0',
          }}
        >
          <Link
            to={`/sessions/${sessionId}`}
            className="ctx-menu-item"
            onClick={onClose}
          >
            View detail
          </Link>
          <button className="ctx-menu-item" onClick={onEditRollout}>
            Edit roll-out pressures
          </button>
          <button className="ctx-menu-item ctx-menu-danger" onClick={onRemove}>
            Remove from plan
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}

function SessionPicker({ excludeIds, onSelect }: {
  excludeIds: string[];
  onSelect: (sid: string) => void;
}) {
  const { data: allSessions = [] } = useQuery({
    queryKey: ['sessions-list'],
    queryFn: () => apiGet<SessionListItem[]>('/api/sessions/list'),
  });

  const available = allSessions.filter(s => !excludeIds.includes(s.id));

  return (
    <div className="card" style={{ padding: 12, marginBottom: 8, maxHeight: 200, overflowY: 'auto' }}>
      {available.length === 0 ? (
        <span className="text-muted">No available sessions</span>
      ) : (
        available.map(s => (
          <div
            key={s.id}
            onClick={() => onSelect(s.id)}
            style={{ padding: '4px 8px', cursor: 'pointer', borderRadius: 4, fontSize: 13 }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            {s.label || `${s.track} — ${s.id.slice(0, 8)}`}
          </div>
        ))
      )}
    </div>
  );
}

function getBand(s: BoardSession, plan: Plan): LapBandSummary | null {
  const mode = plan.planning_mode ?? 'race';
  return mode === 'qual' ? s.qual_lap_band : s.race_lap_band;
}

function fmtLapRange(first: number | null | undefined, last: number | null | undefined): string {
  if (first == null || last == null) return '—';
  if (first === last) return `Lap ${first}`;
  return `Laps ${first}–${last}`;
}

function fmt(v: number | null | undefined, decimals = 1): string {
  if (v == null) return '—';
  return v.toFixed(decimals);
}
