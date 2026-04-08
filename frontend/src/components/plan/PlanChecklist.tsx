import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiGet, apiPatch, apiPost } from '../../api/client';
import type { Plan, ChecklistStep, SessionListItem, SetupListItem, Setup } from '../../types/models';
import { setupLabel } from '../../utils/setup';
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
    const newSetupIds = step.setup_ids ?? [];
    const updatedChecklist = plan.checklist.map(s =>
      s.key === stepKey ? {
        ...s,
        session_ids: newStepSids,
        status: (newStepSids.length > 0 || newSetupIds.length > 0) ? 'linked' as const : 'not_started' as const,
      } : s,
    );
    onUpdate({ checklist: updatedChecklist } as Partial<Plan>);
  }

  function linkSetupToStep(stepKey: string, setupId: string) {
    const step = plan.checklist.find(s => s.key === stepKey);
    if (!step) return;
    const newSetupIds = [...new Set([...(step.setup_ids ?? []), setupId])];
    const updatedChecklist = plan.checklist.map(s =>
      s.key === stepKey ? { ...s, setup_ids: newSetupIds, status: 'linked' as const } : s,
    );
    onUpdate({ checklist: updatedChecklist } as Partial<Plan>);
  }

  function unlinkSetupFromStep(stepKey: string, setupId: string) {
    const step = plan.checklist.find(s => s.key === stepKey);
    if (!step) return;
    const newSetupIds = (step.setup_ids ?? []).filter(id => id !== setupId);
    const updatedChecklist = plan.checklist.map(s =>
      s.key === stepKey ? {
        ...s,
        setup_ids: newSetupIds,
        status: (step.session_ids.length > 0 || newSetupIds.length > 0) ? 'linked' as const : 'not_started' as const,
      } : s,
    );
    onUpdate({ checklist: updatedChecklist } as Partial<Plan>);
  }

  function stepCountLabel(step: ChecklistStep): string | null {
    const sc = step.session_ids.length;
    const su = (step.setup_ids ?? []).length;
    if (sc === 0 && su === 0) return null;
    if (sc > 0 && su === 0) return `${sc}`;
    if (sc === 0 && su > 0) return `${su} setup${su > 1 ? 's' : ''}`;
    return `${sc} · ${su}`;
  }

  return (
    <div>
      <h4 style={{ margin: '0 0 8px', fontSize: 13, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
        Checklist
      </h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {plan.checklist.map(step => {
          const isExpanded = expandedStep === step.key;
          const countLabel = stepCountLabel(step);
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
                {countLabel && (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {countLabel}
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
                  onLinkSession={(sid) => linkSessionToStep(step.key, sid)}
                  onUnlinkSession={(sid) => unlinkSessionFromStep(step.key, sid)}
                  onLinkSetup={(sid) => linkSetupToStep(step.key, sid)}
                  onUnlinkSetup={(sid) => unlinkSetupFromStep(step.key, sid)}
                  onNotesChange={(notes) => updateStep(step.key, { notes })}
                />
              )}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 16 }}>
        <h4 style={{ margin: '0 0 8px', fontSize: 13, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          Notes
        </h4>
        <textarea
          className="input"
          rows={4}
          style={{ width: '100%', fontSize: 12, resize: 'vertical' }}
          placeholder="Notes for this plan..."
          value={plan.notes ?? ''}
          onChange={e => onUpdate({ notes: e.target.value } as Partial<Plan>)}
        />
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

function ExpandedStep({ step, carDriverId, onLinkSession, onUnlinkSession, onLinkSetup, onUnlinkSetup, onNotesChange }: {
  step: ChecklistStep;
  carDriverId: string;
  onLinkSession: (sid: string) => void;
  onUnlinkSession: (sid: string) => void;
  onLinkSetup: (sid: string) => void;
  onUnlinkSetup: (sid: string) => void;
  onNotesChange: (notes: string) => void;
}) {
  const navigate = useNavigate();
  const [showSessionPicker, setShowSessionPicker] = useState(false);
  const [showSetupPicker, setShowSetupPicker] = useState(false);

  const { data: allSessions = [] } = useQuery({
    queryKey: ['sessions-list'],
    queryFn: () => apiGet<SessionListItem[]>('/api/sessions/list'),
    enabled: showSessionPicker,
  });

  const { data: allSetups = [] } = useQuery({
    queryKey: ['setups-list', carDriverId],
    queryFn: () => apiGet<SetupListItem[]>(`/api/setups/list?car_driver_id=${carDriverId}`),
  });

  const availableSessions = allSessions.filter(s => !step.session_ids.includes(s.id));
  const setupIds = step.setup_ids ?? [];
  const availableSetups = allSetups.filter(s => !setupIds.includes(s.id));

  async function handleModifySetup() {
    let sourceId: string | undefined;
    if (setupIds.length > 0) {
      sourceId = setupIds[setupIds.length - 1];
    } else if (allSetups.length > 0) {
      sourceId = allSetups[0].id;
    }
    if (!sourceId) return;
    const res = await apiPost<{ ok: boolean; setup: Setup }>(`/api/setups/${sourceId}/fork`, {});
    if (res.ok && res.setup) {
      onLinkSetup(res.setup.id);
      navigate(`/setups/${res.setup.id}`);
    }
  }

  return (
    <div style={{ padding: '4px 8px 8px 28px', fontSize: 12 }}>
      {/* Linked sessions */}
      {step.session_ids.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          {step.session_ids.map(sid => (
            <div key={sid} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <Link to={`/sessions/${sid}`} style={{ color: 'var(--primary)', fontSize: 12 }}>
                {sid.slice(0, 8)}...
              </Link>
              <button
                onClick={() => onUnlinkSession(sid)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 11 }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Linked setups */}
      {setupIds.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          {setupIds.map(sid => {
            const s = allSetups.find(x => x.id === sid);
            const label = s ? setupLabel(s, allSessions) : sid.slice(0, 8);
            return (
              <div key={sid} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                {s?.parent_id && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>↳</span>}
                <Link to={`/setups/${sid}`} style={{ color: 'var(--primary)', fontSize: 12 }}>
                  {label}
                </Link>
                <button
                  onClick={() => onUnlinkSetup(sid)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 11 }}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Session buttons */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
        <Button size="sm" variant="ghost" onClick={() => { setShowSessionPicker(!showSessionPicker); setShowSetupPicker(false); }}>
          {showSessionPicker ? 'Cancel' : 'Pick session'}
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

      {/* Session picker */}
      {showSessionPicker && (
        <div style={{ maxHeight: 120, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 4, marginBottom: 6 }}>
          {availableSessions.length === 0 ? (
            <div style={{ padding: 8, color: 'var(--text-muted)' }}>No sessions available</div>
          ) : (
            availableSessions.map(s => (
              <div
                key={s.id}
                onClick={() => { onLinkSession(s.id); setShowSessionPicker(false); }}
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

      {/* Setup buttons */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
        <Button size="sm" variant="ghost" onClick={() => { setShowSetupPicker(!showSetupPicker); setShowSessionPicker(false); }}>
          {showSetupPicker ? 'Cancel' : 'Pick setup'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleModifySetup}
          disabled={allSetups.length === 0}
        >
          Modify setup
        </Button>
        <Link to={`/setups/new?car_driver_id=${carDriverId}`}>
          <Button size="sm" variant="ghost">New setup</Button>
        </Link>
      </div>

      {/* Setup picker */}
      {showSetupPicker && (
        <div style={{ maxHeight: 120, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 4, marginBottom: 6 }}>
          {availableSetups.length === 0 ? (
            <div style={{ padding: 8, color: 'var(--text-muted)' }}>No setups available</div>
          ) : (
            availableSetups.map(s => (
              <div
                key={s.id}
                onClick={() => { onLinkSetup(s.id); setShowSetupPicker(false); }}
                style={{ padding: '4px 8px', cursor: 'pointer', fontSize: 12 }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                {setupLabel(s, allSessions)}
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
