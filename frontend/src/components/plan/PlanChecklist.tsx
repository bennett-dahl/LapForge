import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiGet, apiPatch } from '../../api/client';
import type { Plan, ChecklistStep, SessionListItem } from '../../types/models';
import Button from '../ui/Button';

interface Props {
  plan: Plan;
  carDriverId: string;
  onUpdate: (fields: Partial<Plan>) => void;
  refetchBoard: () => void;
}

export default function PlanChecklist({ plan, carDriverId, onUpdate, refetchBoard }: Props) {
  const [expandedStep, setExpandedStep] = useState<string | null>(
    plan.checklist.find(s => s.status === 'not_started')?.key ?? null,
  );

  function updateStep(key: string, patch: Partial<ChecklistStep>) {
    const updatedChecklist = plan.checklist.map(s =>
      s.key === key ? { ...s, ...patch } : s,
    );
    onUpdate({ checklist: updatedChecklist } as Partial<Plan>);
  }

  async function linkSessionToStep(stepKey: string, sessionId: string) {
    const step = plan.checklist.find(s => s.key === stepKey);
    if (!step) return;

    const newStepSids = [...new Set([...step.session_ids, sessionId])];
    const newPlanSids = [...new Set([...plan.session_ids, sessionId])];

    const updatedChecklist = plan.checklist.map(s =>
      s.key === stepKey ? { ...s, session_ids: newStepSids, status: 'linked' as const } : s,
    );

    onUpdate({
      checklist: updatedChecklist,
      session_ids: newPlanSids,
    } as Partial<Plan>);

    await apiPatch(`/api/sessions/${sessionId}`, { planning_tag: stepKey });
    refetchBoard();
  }

  function unlinkSessionFromStep(stepKey: string, sessionId: string) {
    const step = plan.checklist.find(s => s.key === stepKey);
    if (!step) return;

    const newStepSids = step.session_ids.filter(id => id !== sessionId);
    const updatedChecklist = plan.checklist.map(s =>
      s.key === stepKey ? {
        ...s,
        session_ids: newStepSids,
        status: newStepSids.length > 0 ? 'linked' as const : 'not_started' as const,
      } : s,
    );
    onUpdate({ checklist: updatedChecklist } as Partial<Plan>);
  }

  return (
    <div>
      <h4 style={{ margin: '0 0 8px', fontSize: 13, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
        Checklist
      </h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {plan.checklist.map(step => {
          const isExpanded = expandedStep === step.key;
          return (
            <div key={step.key}>
              <button
                onClick={() => setExpandedStep(isExpanded ? null : step.key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  padding: '6px 8px', background: 'none', border: 'none', cursor: 'pointer',
                  borderRadius: 4, textAlign: 'left', color: 'var(--text)',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
              >
                <StatusIcon status={step.status} required={step.required} />
                <span style={{ flex: 1, fontSize: 13 }}>{step.label}</span>
                {step.session_ids.length > 0 && (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {step.session_ids.length}
                  </span>
                )}
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  {isExpanded ? '▾' : '▸'}
                </span>
              </button>

              {isExpanded && (
                <ExpandedStep
                  step={step}
                  carDriverId={carDriverId}
                  onLink={(sid) => linkSessionToStep(step.key, sid)}
                  onUnlink={(sid) => unlinkSessionFromStep(step.key, sid)}
                  onNotesChange={(notes) => updateStep(step.key, { notes })}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusIcon({ status, required }: { status: string; required: boolean }) {
  if (status === 'reviewed') return <span style={{ color: '#10b981', fontSize: 14 }}>✓</span>;
  if (status === 'linked') return <span style={{ color: '#3b82f6', fontSize: 14 }}>●</span>;
  if (required) return <span style={{ color: '#f59e0b', fontSize: 14 }}>○</span>;
  return <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>○</span>;
}

function ExpandedStep({ step, carDriverId, onLink, onUnlink, onNotesChange }: {
  step: ChecklistStep;
  carDriverId: string;
  onLink: (sid: string) => void;
  onUnlink: (sid: string) => void;
  onNotesChange: (notes: string) => void;
}) {
  const [showPicker, setShowPicker] = useState(false);

  const { data: allSessions = [] } = useQuery({
    queryKey: ['sessions-list'],
    queryFn: () => apiGet<SessionListItem[]>('/api/sessions/list'),
    enabled: showPicker,
  });

  const available = allSessions.filter(s => !step.session_ids.includes(s.id));

  return (
    <div style={{ padding: '4px 8px 8px 28px', fontSize: 12 }}>
      {step.session_ids.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          {step.session_ids.map(sid => (
            <div key={sid} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <Link to={`/sessions/${sid}`} style={{ color: 'var(--primary)', fontSize: 12 }}>
                {sid.slice(0, 8)}...
              </Link>
              <button
                onClick={() => onUnlink(sid)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 11 }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        <Button size="sm" variant="ghost" onClick={() => setShowPicker(!showPicker)}>
          {showPicker ? 'Cancel' : 'Pick session'}
        </Button>
        <Link to={`/upload?car_driver_id=${carDriverId}&checklist_step=${step.key}`}>
          <Button size="sm" variant="ghost">Upload</Button>
        </Link>
        {step.key === 'baseline' && (
          <Link to="/tire-sets">
            <Button size="sm" variant="ghost">Tire Sets</Button>
          </Link>
        )}
      </div>

      {showPicker && (
        <div style={{ maxHeight: 120, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 4, marginBottom: 6 }}>
          {available.length === 0 ? (
            <div style={{ padding: 8, color: 'var(--text-muted)' }}>No sessions available</div>
          ) : (
            available.map(s => (
              <div
                key={s.id}
                onClick={() => { onLink(s.id); setShowPicker(false); }}
                style={{ padding: '4px 8px', cursor: 'pointer', fontSize: 12 }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                {s.label || `${s.track} — ${s.id.slice(0, 8)}`}
              </div>
            ))
          )}
        </div>
      )}

      <textarea
        className="input"
        rows={2}
        style={{ width: '100%', fontSize: 12, resize: 'vertical' }}
        placeholder="Notes..."
        value={step.notes}
        onChange={e => onNotesChange(e.target.value)}
      />
    </div>
  );
}
