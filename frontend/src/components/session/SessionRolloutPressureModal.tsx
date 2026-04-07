import { useState, useEffect } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { apiPatch } from '../../api/client';
import { convertPressure, pressureDecimals, type PressureUnit } from '../../utils/units';

export interface RolloutCorners {
  fl: number | null;
  fr: number | null;
  rl: number | null;
  rr: number | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  sessionId: string;
  sessionLabel?: string;
  displayUnit: PressureUnit;
  initialCorners: RolloutCorners;
}

const CORNERS = ['fl', 'fr', 'rl', 'rr'] as const;

function toStr(v: number | null, decimals = 1): string {
  if (v == null || !Number.isFinite(v)) return '';
  return v.toFixed(decimals);
}

export default function SessionRolloutPressureModal({
  open,
  onClose,
  onSuccess,
  sessionId,
  sessionLabel,
  displayUnit,
  initialCorners,
}: Props) {
  const [fields, setFields] = useState({ fl: '', fr: '', rl: '', rr: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      const dec = pressureDecimals(displayUnit);
      setFields({
        fl: toStr(initialCorners.fl, dec),
        fr: toStr(initialCorners.fr, dec),
        rl: toStr(initialCorners.rl, dec),
        rr: toStr(initialCorners.rr, dec),
      });
      setError(null);
      setSaving(false);
    }
  }, [open, initialCorners.fl, initialCorners.fr, initialCorners.rl, initialCorners.rr]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, number | null> = {};
      for (const c of CORNERS) {
        const raw = fields[c].trim();
        if (raw === '') {
          body[`roll_out_pressure_${c}`] = null;
        } else {
          const val = parseFloat(raw);
          if (!Number.isFinite(val)) {
            setError(`Invalid number for ${c.toUpperCase()}`);
            setSaving(false);
            return;
          }
          body[`roll_out_pressure_${c}`] = convertPressure(val, displayUnit, 'bar');
        }
      }
      await apiPatch(`/api/sessions/${sessionId}`, body);
      onSuccess?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={sessionLabel ? `Roll-out — ${sessionLabel}` : 'Roll-out Pressures'}
    >
      <p className="text-muted" style={{ margin: '0 0 12px', fontSize: 12 }}>
        Enter pressures as set at roll-out ({displayUnit}).
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {CORNERS.map(c => (
          <label key={c} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase' }}>{c}</span>
            <input
              type="number"
              step={displayUnit === 'bar' ? '0.01' : '0.1'}
              className="form-input form-input-sm"
              placeholder="—"
              value={fields[c]}
              onChange={e => setFields(prev => ({ ...prev, [c]: e.target.value }))}
            />
          </label>
        ))}
      </div>
      {error && (
        <p style={{ color: 'var(--danger, #e74c3c)', fontSize: 12, margin: '8px 0 0' }}>{error}</p>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </Modal>
  );
}
