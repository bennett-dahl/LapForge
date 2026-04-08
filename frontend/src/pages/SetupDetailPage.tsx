import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch, apiDelete } from '../api/client';
import type { Setup, SetupData, SetupSnapshot, SetupCorner, CarDriver, SessionListItem } from '../types/models';
import { setupLabel } from '../utils/setup';
import Button from '../components/ui/Button';

const CORNERS = ['fl', 'fr', 'rl', 'rr'] as const;
type CornerKey = (typeof CORNERS)[number];

function emptyCorner(): SetupCorner {
  return { camber: null, toe: null, ride_height: null, weight_lbs: null, sway_bar: null };
}

function emptySnapshot(): SetupSnapshot {
  return {};
}

function emptyData(): SetupData {
  return {};
}

function numVal(v: string): number | null {
  if (v.trim() === '') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function fmtNum(v: number | null | undefined): string {
  if (v == null) return '';
  return String(v);
}

export default function SetupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isNew = !id;

  const [name, setName] = useState('');
  const [carDriverId, setCarDriverId] = useState(searchParams.get('car_driver_id') ?? '');
  const [weekendId, setWeekendId] = useState<string>(searchParams.get('weekend_id') ?? '');
  const [sessionId, setSessionId] = useState<string>(searchParams.get('session_id') ?? '');
  const [data, setData] = useState<SetupData>(emptyData());
  const [parentId, setParentId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: existing, isLoading } = useQuery({
    queryKey: ['setup', id],
    queryFn: () => apiGet<Setup>(`/api/setups/${id}`),
    enabled: !!id,
  });

  const { data: carDrivers = [] } = useQuery({
    queryKey: ['car-drivers'],
    queryFn: () => apiGet<CarDriver[]>('/api/car-drivers'),
  });

  const { data: sessions = [] } = useQuery({
    queryKey: ['sessions-list'],
    queryFn: () => apiGet<SessionListItem[]>('/api/sessions/list'),
  });

  useEffect(() => {
    if (existing) {
      setName(existing.name);
      setCarDriverId(existing.car_driver_id);
      setWeekendId(existing.weekend_id ?? '');
      setSessionId(existing.session_id ?? '');
      setData(existing.data ?? emptyData());
      setParentId(existing.parent_id);
    }
  }, [existing]);

  const updateSnapshot = useCallback(
    (phase: 'before' | 'after', patch: Partial<SetupSnapshot>) => {
      setData(prev => ({
        ...prev,
        [phase]: { ...(prev[phase] ?? emptySnapshot()), ...patch },
      }));
    },
    [],
  );

  const updateCorner = useCallback(
    (phase: 'before' | 'after', corner: CornerKey, field: keyof SetupCorner, value: string) => {
      setData(prev => {
        const snap = prev[phase] ?? emptySnapshot();
        const c = snap[corner] ?? emptyCorner();
        return {
          ...prev,
          [phase]: {
            ...snap,
            [corner]: { ...c, [field]: numVal(value) },
          },
        };
      });
    },
    [],
  );

  async function handleSave() {
    setSaving(true);
    try {
      if (isNew) {
        if (!carDriverId) return;
        const res = await apiPost<{ ok: boolean; setup: Setup }>('/api/setups', {
          car_driver_id: carDriverId,
          name,
          data,
          weekend_id: weekendId || null,
          session_id: sessionId || null,
        });
        if (res.ok) {
          queryClient.invalidateQueries({ queryKey: ['setups-list'] });
          navigate(`/setups/${res.setup.id}`, { replace: true });
        }
      } else {
        await apiPatch(`/api/setups/${id}`, {
          name,
          data,
          weekend_id: weekendId || null,
          session_id: sessionId || null,
        });
        queryClient.invalidateQueries({ queryKey: ['setup', id] });
        queryClient.invalidateQueries({ queryKey: ['setups-list'] });
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    await apiDelete(`/api/setups/${id}`);
    queryClient.invalidateQueries({ queryKey: ['setups-list'] });
    navigate('/setups');
  }

  async function handleFork() {
    const res = await apiPost<{ ok: boolean; setup: Setup }>(`/api/setups/${id}/fork`, {});
    if (res.ok) {
      queryClient.invalidateQueries({ queryKey: ['setups-list'] });
      navigate(`/setups/${res.setup.id}`);
    }
  }

  if (!isNew && isLoading) {
    return <div style={{ padding: 24, color: 'var(--text-muted)' }}>Loading...</div>;
  }

  const derivedLabel = existing ? setupLabel(existing, sessions) : 'New Setup';

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Link to="/setups" style={{ color: 'var(--text-muted)', fontSize: 13 }}>← Setups</Link>
        <h2 style={{ margin: 0, flex: 1 }}>{isNew ? 'New Setup' : derivedLabel}</h2>
        {!isNew && (
          <Button variant="ghost" onClick={handleFork}>Fork this setup</Button>
        )}
      </div>

      {parentId && (
        <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--text-muted)' }}>
          Forked from: <Link to={`/setups/${parentId}`} style={{ color: 'var(--primary)' }}>{parentId.slice(0, 8)}...</Link>
        </div>
      )}

      {/* Meta fields */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
        <div>
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Name (optional)</label>
          <input
            className="input"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={derivedLabel}
            style={{ width: '100%' }}
          />
        </div>
        <div>
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Car / Driver</label>
          <select
            className="input"
            value={carDriverId}
            onChange={e => setCarDriverId(e.target.value)}
            style={{ width: '100%' }}
            disabled={!isNew}
          >
            <option value="">Select...</option>
            {carDrivers.map(cd => (
              <option key={cd.id} value={cd.id}>
                {cd.car_identifier} / {cd.driver_name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Snapshot grids */}
      {(['before', 'after'] as const).map(phase => (
        <div key={phase} style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 14, textTransform: 'capitalize', marginBottom: 8 }}>
            {phase}
          </h3>
          <CornerGrid
            snapshot={data[phase] ?? emptySnapshot()}
            onCornerChange={(corner, field, value) => updateCorner(phase, corner, field, value)}
          />
          <VehicleLevelFields
            snapshot={data[phase] ?? emptySnapshot()}
            onChange={patch => updateSnapshot(phase, patch)}
          />
        </div>
      ))}

      {/* Intermediate steps */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <h3 style={{ fontSize: 14, margin: 0 }}>Intermediate Steps</h3>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setData(prev => ({
                ...prev,
                intermediate_steps: [
                  ...(prev.intermediate_steps ?? []),
                  { label: '', snapshot: emptySnapshot() },
                ],
              }))
            }
          >
            + Add step
          </Button>
        </div>
        {(data.intermediate_steps ?? []).map((step, idx) => (
          <div key={idx} style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 12, marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <input
                className="input"
                value={step.label ?? ''}
                onChange={e => {
                  const steps = [...(data.intermediate_steps ?? [])];
                  steps[idx] = { ...steps[idx], label: e.target.value };
                  setData(prev => ({ ...prev, intermediate_steps: steps }));
                }}
                placeholder={`Step ${idx + 1} label`}
                style={{ flex: 1 }}
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const steps = (data.intermediate_steps ?? []).filter((_, i) => i !== idx);
                  setData(prev => ({ ...prev, intermediate_steps: steps }));
                }}
              >
                Remove
              </Button>
            </div>
            <CornerGrid
              snapshot={step.snapshot}
              onCornerChange={(corner, field, value) => {
                const steps = [...(data.intermediate_steps ?? [])];
                const snap = steps[idx].snapshot ?? emptySnapshot();
                const c = snap[corner] ?? emptyCorner();
                steps[idx] = {
                  ...steps[idx],
                  snapshot: { ...snap, [corner]: { ...c, [field]: numVal(value) } },
                };
                setData(prev => ({ ...prev, intermediate_steps: steps }));
              }}
            />
          </div>
        ))}
      </div>

      {/* Notes */}
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 14, marginBottom: 8 }}>Notes</h3>
        <textarea
          className="input"
          rows={4}
          style={{ width: '100%', resize: 'vertical' }}
          value={data.notes ?? ''}
          onChange={e => setData(prev => ({ ...prev, notes: e.target.value }))}
          placeholder="Setup notes..."
        />
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button onClick={handleSave} disabled={saving || (!isNew && isLoading) || (isNew && !carDriverId)}>
          {saving ? 'Saving...' : isNew ? 'Create' : 'Save'}
        </Button>
        {!isNew && !confirmDelete && (
          <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
        )}
        {confirmDelete && (
          <>
            <Button variant="ghost" onClick={handleDelete} style={{ color: '#ef4444' }}>
              Confirm Delete
            </Button>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function CornerGrid({
  snapshot,
  onCornerChange,
}: {
  snapshot: SetupSnapshot;
  onCornerChange: (corner: CornerKey, field: keyof SetupCorner, value: string) => void;
}) {
  return (
    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', marginBottom: 8 }}>
      <thead>
        <tr>
          <th style={{ textAlign: 'left', padding: '4px 6px', color: 'var(--text-muted)', fontWeight: 500 }}>Corner</th>
          <th style={{ textAlign: 'right', padding: '4px 6px', color: 'var(--text-muted)', fontWeight: 500 }}>Camber (°)</th>
          <th style={{ textAlign: 'right', padding: '4px 6px', color: 'var(--text-muted)', fontWeight: 500 }}>Toe</th>
          <th style={{ textAlign: 'right', padding: '4px 6px', color: 'var(--text-muted)', fontWeight: 500 }}>Ride Height</th>
          <th style={{ textAlign: 'right', padding: '4px 6px', color: 'var(--text-muted)', fontWeight: 500 }}>Weight (lbs)</th>
          <th style={{ textAlign: 'right', padding: '4px 6px', color: 'var(--text-muted)', fontWeight: 500 }}>Sway Bar</th>
        </tr>
      </thead>
      <tbody>
        {CORNERS.map(corner => {
          const c = snapshot[corner] ?? emptyCorner();
          return (
            <tr key={corner}>
              <td style={{ padding: '2px 6px', fontWeight: 600, textTransform: 'uppercase' }}>{corner}</td>
              {(['camber', 'toe', 'ride_height', 'weight_lbs', 'sway_bar'] as const).map(field => (
                <td key={field} style={{ padding: '2px 4px' }}>
                  <input
                    className="input"
                    type="number"
                    step="any"
                    value={fmtNum(c[field])}
                    onChange={e => onCornerChange(corner, field, e.target.value)}
                    style={{ width: '100%', textAlign: 'right', fontSize: 12, padding: '2px 6px' }}
                  />
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function VehicleLevelFields({
  snapshot,
  onChange,
}: {
  snapshot: SetupSnapshot;
  onChange: (patch: Partial<SetupSnapshot>) => void;
}) {
  const fields: { key: keyof SetupSnapshot; label: string; editable: boolean }[] = [
    { key: 'total_weight_lbs', label: 'Total Weight (lbs)', editable: true },
    { key: 'track_width_front', label: 'Track Width Front', editable: true },
    { key: 'track_width_rear', label: 'Track Width Rear', editable: true },
    { key: 'wing_angle_front_deg', label: 'Front Wing (°)', editable: true },
    { key: 'wing_angle_rear_deg', label: 'Rear Wing (°)', editable: true },
    { key: 'front_axle_percent', label: 'Front Axle %', editable: false },
    { key: 'rear_axle_percent', label: 'Rear Axle %', editable: false },
    { key: 'left_side_percent', label: 'Left Side %', editable: false },
    { key: 'right_side_percent', label: 'Right Side %', editable: false },
    { key: 'cross_fl_rr_percent', label: 'Cross FL-RR %', editable: false },
    { key: 'cross_fr_rl_percent', label: 'Cross FR-RL %', editable: false },
  ];

  const derived = derivePercentages(snapshot);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
      {fields.map(f => {
        const val = f.editable
          ? (snapshot[f.key] as number | null | undefined)
          : (derived[f.key] as number | null | undefined);
        return (
          <div key={f.key}>
            <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>{f.label}</label>
            {f.editable ? (
              <input
                className="input"
                type="number"
                step="any"
                value={fmtNum(val)}
                onChange={e => onChange({ [f.key]: numVal(e.target.value) } as Partial<SetupSnapshot>)}
                style={{ width: '100%', fontSize: 12 }}
              />
            ) : (
              <div style={{ fontSize: 12, padding: '4px 0', color: val != null ? 'var(--text)' : 'var(--text-muted)' }}>
                {val != null ? `${val.toFixed(1)}%` : '—'}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function derivePercentages(snap: SetupSnapshot): Partial<SetupSnapshot> {
  const fl = snap.fl?.weight_lbs ?? 0;
  const fr = snap.fr?.weight_lbs ?? 0;
  const rl = snap.rl?.weight_lbs ?? 0;
  const rr = snap.rr?.weight_lbs ?? 0;
  const total = snap.total_weight_lbs ?? (fl + fr + rl + rr);
  if (!total) return {};
  return {
    front_axle_percent: ((fl + fr) / total) * 100,
    rear_axle_percent: ((rl + rr) / total) * 100,
    left_side_percent: ((fl + rl) / total) * 100,
    right_side_percent: ((fr + rr) / total) * 100,
    cross_fl_rr_percent: ((fl + rr) / total) * 100,
    cross_fr_rl_percent: ((fr + rl) / total) * 100,
  };
}
