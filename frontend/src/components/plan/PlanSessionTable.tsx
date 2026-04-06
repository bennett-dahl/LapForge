import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../api/client';
import type { Plan, BoardSession, SessionListItem, WindowStats } from '../../types/models';
import Button from '../ui/Button';

interface Props {
  plan: Plan;
  sessions: BoardSession[];
  onAddSession: (sid: string) => void;
  onRemoveSession: (sid: string) => void;
}

export default function PlanSessionTable({ plan, sessions, onAddSession, onRemoveSession }: Props) {
  const [showPicker, setShowPicker] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14, flex: 1 }}>Sessions</h3>
        <Button size="sm" variant="secondary" onClick={() => setShowPicker(!showPicker)}>
          {showPicker ? 'Cancel' : '+ Add Session'}
        </Button>
      </div>

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
          <table className="data-table" style={{ width: '100%', fontSize: 13 }}>
            <thead>
              <tr>
                <th>Label</th>
                <th>Role</th>
                <th>Target</th>
                <th>Roll-out (FL/FR-RL/RR)</th>
                <th>Temp</th>
                <th>Δ Target</th>
                <th>Stat</th>
                <th style={{ width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {sessions.map(s => {
                const ro = s.roll_out_psi;
                const rolloutStr = [ro.fl, ro.fr, ro.rl, ro.rr].some(v => v != null)
                  ? `${fmt(ro.fl)}/${fmt(ro.fr)}-${fmt(ro.rl)}/${fmt(ro.rr)}`
                  : '—';

                const deltaTarget = calcDeltaTarget(s, plan);

                return (
                  <tr key={s.id}>
                    <td>
                      <button
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)', textAlign: 'left', padding: 0 }}
                        onClick={() => setExpandedRow(expandedRow === s.id ? null : s.id)}
                      >
                        {expandedRow === s.id ? '▾' : '▸'} {s.label}
                      </button>
                      {expandedRow === s.id && (
                        <div style={{ padding: '8px 0 4px 16px', fontSize: 12 }}>
                          <ExpandedRow session={s} />
                        </div>
                      )}
                    </td>
                    <td>
                      {s.planning_tag ? (
                        <span style={{
                          display: 'inline-block', padding: '1px 8px', borderRadius: 10,
                          fontSize: 11, background: 'var(--bg)', border: '1px solid var(--border)',
                        }}>
                          {s.planning_tag}
                        </span>
                      ) : '—'}
                    </td>
                    <td>{s.target_pressure_psi ?? '—'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{rolloutStr}</td>
                    <td className="text-muted" style={{ fontSize: 12 }}>
                      {s.ambient_temp_c != null ? `${s.ambient_temp_c}°` : '—'} / {s.track_temp_c != null ? `${s.track_temp_c}°` : '—'}
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{deltaTarget}</td>
                    <td style={{ fontSize: 12 }}>{formatWindowStat(s, plan)}</td>
                    <td style={{ position: 'relative' }}>
                      <button
                        onClick={() => setMenuOpen(menuOpen === s.id ? null : s.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--text-muted)' }}
                      >
                        ⋯
                      </button>
                      {menuOpen === s.id && (
                        <div style={{
                          position: 'absolute', right: 0, top: '100%', zIndex: 10,
                          background: 'var(--surface)', border: '1px solid var(--border)',
                          borderRadius: 6, boxShadow: '0 2px 8px rgba(0,0,0,0.15)', minWidth: 160,
                        }}>
                          <Link
                            to={`/sessions/${s.id}`}
                            style={{ display: 'block', padding: '8px 12px', fontSize: 13, color: 'var(--text)', textDecoration: 'none' }}
                            onClick={() => setMenuOpen(null)}
                          >
                            View detail
                          </Link>
                          <button
                            onClick={() => { onRemoveSession(s.id); setMenuOpen(null); }}
                            style={{
                              display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px',
                              fontSize: 13, border: 'none', background: 'none', cursor: 'pointer',
                              color: 'var(--danger, #e74c3c)',
                            }}
                          >
                            Remove from plan
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ExpandedRow({ session }: { session: BoardSession }) {
  const ts = session.tire_summary as Record<string, Record<string, number>> | null;
  const ro = session.roll_out_psi;
  const cornerVals = [ro.fl, ro.fr, ro.rl, ro.rr].filter((v): v is number => v != null);
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
            const delta = v - cornerMean;
            return `${c.toUpperCase()}: ${delta > 0 ? '+' : ''}${delta.toFixed(1)}`;
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
                  min {c.min?.toFixed(1)} / avg {c.avg?.toFixed(1)} / max {c.max?.toFixed(1)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
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

function formatWindowStat(s: BoardSession, plan: Plan): string {
  const stats: WindowStats | null =
    plan.planning_mode === 'qual' ? s.qual_window_stats
    : plan.planning_mode === 'race' ? s.race_window_stats
    : s.qual_window_stats ?? s.race_window_stats;
  if (!stats?._summary) return '—';
  const pct = stats._summary.pct_in_band;
  const delta = stats._summary.avg_delta;
  return `${pct.toFixed(0)}% in band (Δ${delta > 0 ? '+' : ''}${delta.toFixed(1)})`;
}

function fmt(v: number | null | undefined): string {
  if (v == null) return '—';
  return v.toFixed(1);
}

function calcDeltaTarget(s: BoardSession, plan: Plan): string {
  const mode = plan.planning_mode;
  const ref = mode === 'qual' ? plan.qual_plan : plan.race_plan;
  const target = ref?.target;
  if (target == null) return '—';

  const ro = s.roll_out_psi;
  const corners = [ro.fl, ro.fr, ro.rl, ro.rr].filter((v): v is number => v != null);
  if (corners.length === 0) return '—';
  const avg = corners.reduce((a, b) => a + b, 0) / corners.length;
  const delta = avg - target;
  return `${delta > 0 ? '+' : ''}${delta.toFixed(1)}`;
}
