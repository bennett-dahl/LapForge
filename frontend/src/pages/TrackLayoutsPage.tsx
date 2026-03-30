import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiDelete, apiPatch, apiPost } from '../api/client';
import type { TrackLayoutsResponse, TrackLayoutCreateResponse } from '../types/api';
import type { SessionListItem } from '../types/models';
import Button from '../components/ui/Button';
import { useRef, useState, useEffect, type FormEvent } from 'react';

export default function TrackLayoutsPage() {
  const qc = useQueryClient();
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = 'LapForge - Track Maps';
  }, []);
  const { data, isLoading } = useQuery({
    queryKey: ['track-layouts'],
    queryFn: () => apiGet<TrackLayoutsResponse>('/api/track-layouts'),
  });

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [sourceSessionId, setSourceSessionId] = useState('');

  const { data: sessions = [], isLoading: sessionsLoading } = useQuery({
    queryKey: ['sessions-list'],
    queryFn: () => apiGet<SessionListItem[]>('/api/sessions/list'),
    enabled: createModalOpen,
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/track-layouts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['track-layouts'] }),
  });

  const renameMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiPatch<{ ok: boolean }>(`/api/track-layouts/${id}`, { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['track-layouts'] }),
  });

  const createMut = useMutation({
    mutationFn: (body: { name: string; source_session_id: string }) =>
      apiPost<TrackLayoutCreateResponse>('/api/track-layouts', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['track-layouts'] });
      setCreateModalOpen(false);
      setNewName('');
      setSourceSessionId('');
    },
  });

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');

  const layouts = data?.layouts ?? [];
  const sessionMap = data?.session_map ?? {};

  function closeCreateModal() {
    setCreateModalOpen(false);
    setNewName('');
    setSourceSessionId('');
    createMut.reset();
  }

  function handleCreateSubmit(e: FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name || !sourceSessionId) return;
    createMut.mutate({ name, source_session_id: sourceSessionId });
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>Track Maps</h1>
        <div className="page-header-actions">
          <Button onClick={() => setCreateModalOpen(true)}>Create New Track Map</Button>
        </div>
      </div>

      <p className="muted" style={{ marginBottom: '1rem' }}>
        Define track sections for lap-by-section analysis. Create from any session with GPS data.
      </p>

      {createModalOpen && (
        <div
          className="modal-overlay"
          ref={overlayRef}
          role="presentation"
          onClick={(e) => {
            if (e.target === overlayRef.current) closeCreateModal();
          }}
        >
          <div className="modal-dialog" role="dialog" aria-labelledby="create-track-map-title">
            <h3 id="create-track-map-title">Create New Track Map</h3>
            <form onSubmit={handleCreateSubmit}>
              <label className="form-label">
                Name
                <input
                  className="form-input"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  autoFocus
                  required
                />
              </label>
              <label className="form-label">
                Source Session
                <select
                  className="form-select"
                  value={sourceSessionId}
                  onChange={(e) => setSourceSessionId(e.target.value)}
                  required
                  disabled={sessionsLoading}
                >
                  <option value="">{sessionsLoading ? 'Loading…' : 'Select a session'}</option>
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                      {s.track ? ` — ${s.track}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              {createMut.isError && (
                <p className="muted" style={{ color: 'var(--danger, #f87171)' }}>
                  {(createMut.error as Error).message}
                </p>
              )}
              <div className="modal-actions">
                <Button type="button" variant="secondary" onClick={closeCreateModal}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createMut.isPending || !newName.trim() || !sourceSessionId}>
                  Create
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="muted">Loading...</p>
      ) : layouts.length === 0 ? (
        <p className="muted">No track layouts yet. Create one from a session&apos;s track map tool or use Create New Track Map above.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Track</th>
              <th>Source Session</th>
              <th>Lap</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {layouts.map((tl) => (
              <tr key={tl.id}>
                <td>
                  {renamingId === tl.id ? (
                    <form
                      className="inline-form"
                      onSubmit={(e) => { e.preventDefault(); renameMut.mutate({ id: tl.id, name: renameVal }); setRenamingId(null); }}
                    >
                      <input className="form-input form-input-sm" value={renameVal} onChange={(e) => setRenameVal(e.target.value)} autoFocus />
                      <Button size="sm" type="submit">Save</Button>
                    </form>
                  ) : (
                    <span className="clickable" onClick={() => { setRenamingId(tl.id); setRenameVal(tl.name); }}>{tl.name}</span>
                  )}
                </td>
                <td>{tl.track_name}</td>
                <td>{tl.source_session_id ? (sessionMap[tl.id] ?? tl.source_session_id.slice(0, 8)) : '—'}</td>
                <td>{tl.source_lap_index != null ? tl.source_lap_index : '—'}</td>
                <td>{tl.created_at ? new Date(tl.created_at).toLocaleDateString() : '—'}</td>
                <td className="actions">
                  <Button variant="danger" size="sm" onClick={() => {
                    if (confirm(`Delete layout "${tl.name}"? Sessions using it will revert to auto-detection.`)) deleteMut.mutate(tl.id);
                  }}>Delete</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
