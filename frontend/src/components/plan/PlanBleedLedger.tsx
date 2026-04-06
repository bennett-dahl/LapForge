import { useState } from 'react';
import { apiPatch } from '../../api/client';
import type { BoardSession, BleedEvent } from '../../types/models';
import Button from '../ui/Button';

interface Props {
  sessions: BoardSession[];
  refetchBoard: () => void;
}

export default function PlanBleedLedger({ sessions, refetchBoard }: Props) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    sessionId: '',
    corner: 'fl',
    bleed_type: 'hot',
    psi_removed: '',
    lap_number: '',
    tpms_before: '',
    tpms_after: '',
    notes: '',
  });

  const allBleeds: Array<BleedEvent & { sessionId: string; sessionLabel: string }> = [];
  for (const s of sessions) {
    for (const b of s.bleed_events || []) {
      allBleeds.push({ ...b, sessionId: s.id, sessionLabel: s.label });
    }
  }

  async function handleAdd() {
    if (!form.sessionId || !form.psi_removed) return;
    const sess = sessions.find(s => s.id === form.sessionId);
    if (!sess) return;

    const newBleed: BleedEvent = {
      corner: form.corner,
      bleed_type: form.bleed_type,
      psi_removed: parseFloat(form.psi_removed),
      lap_number: form.lap_number ? parseInt(form.lap_number) : null,
      tpms_before: form.tpms_before ? parseFloat(form.tpms_before) : null,
      tpms_after: form.tpms_after ? parseFloat(form.tpms_after) : null,
      notes: form.notes,
      timestamp: new Date().toISOString(),
    };

    const updatedBleeds = [...(sess.bleed_events || []), newBleed];
    await apiPatch(`/api/sessions/${form.sessionId}`, { bleed_events: updatedBleeds });
    refetchBoard();
    setAdding(false);
    setForm(f => ({ ...f, psi_removed: '', lap_number: '', tpms_before: '', tpms_after: '', notes: '' }));
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14, flex: 1 }}>Bleed Ledger</h3>
        <Button size="sm" variant="secondary" onClick={() => setAdding(!adding)}>
          {adding ? 'Cancel' : '+ Add Bleed'}
        </Button>
      </div>

      {adding && (
        <div className="card" style={{ padding: 12, marginBottom: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Session</span>
            <select className="input" value={form.sessionId}
              onChange={e => setForm(f => ({ ...f, sessionId: e.target.value }))}>
              <option value="">Select...</option>
              {sessions.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Corner</span>
            <select className="input" value={form.corner}
              onChange={e => setForm(f => ({ ...f, corner: e.target.value }))}>
              {['fl', 'fr', 'rl', 'rr'].map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Type</span>
            <select className="input" value={form.bleed_type}
              onChange={e => setForm(f => ({ ...f, bleed_type: e.target.value }))}>
              <option value="hot">Hot</option>
              <option value="cold">Cold</option>
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>PSI removed</span>
            <input className="input" type="number" step="0.1" style={{ width: 70 }}
              value={form.psi_removed} onChange={e => setForm(f => ({ ...f, psi_removed: e.target.value }))} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Lap</span>
            <input className="input" type="number" style={{ width: 50 }}
              value={form.lap_number} onChange={e => setForm(f => ({ ...f, lap_number: e.target.value }))} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>TPMS before</span>
            <input className="input" type="number" step="0.1" style={{ width: 70 }}
              value={form.tpms_before} onChange={e => setForm(f => ({ ...f, tpms_before: e.target.value }))} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>TPMS after</span>
            <input className="input" type="number" step="0.1" style={{ width: 70 }}
              value={form.tpms_after} onChange={e => setForm(f => ({ ...f, tpms_after: e.target.value }))} />
          </label>
          <Button size="sm" onClick={handleAdd} disabled={!form.sessionId || !form.psi_removed}>
            Save
          </Button>
        </div>
      )}

      {allBleeds.length === 0 ? (
        <div className="card" style={{ padding: 16, textAlign: 'center' }}>
          <span className="text-muted">No bleeds recorded yet.</span>
        </div>
      ) : (
        <div className="card" style={{ overflow: 'auto' }}>
          <table className="data-table" style={{ width: '100%', fontSize: 13 }}>
            <thead>
              <tr>
                <th>Session</th>
                <th>Corner</th>
                <th>Type</th>
                <th>PSI</th>
                <th>Lap</th>
                <th>TPMS before</th>
                <th>TPMS after</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {allBleeds.map((b, i) => (
                <tr key={`${b.sessionId}-${i}`}>
                  <td className="text-muted" style={{ fontSize: 12 }}>{b.sessionLabel}</td>
                  <td style={{ textTransform: 'uppercase', fontWeight: 600 }}>{b.corner}</td>
                  <td>{b.bleed_type}</td>
                  <td style={{ fontFamily: 'monospace' }}>{b.psi_removed}</td>
                  <td>{b.lap_number ?? '—'}</td>
                  <td style={{ fontFamily: 'monospace' }}>{b.tpms_before ?? '—'}</td>
                  <td style={{ fontFamily: 'monospace' }}>{b.tpms_after ?? '—'}</td>
                  <td className="text-muted">{b.notes || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
