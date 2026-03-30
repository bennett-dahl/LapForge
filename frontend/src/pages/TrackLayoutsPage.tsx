import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiDelete, apiPatch } from '../api/client';
import type { TrackLayoutsResponse } from '../types/api';
import Button from '../components/ui/Button';
import { useState } from 'react';

export default function TrackLayoutsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['track-layouts'],
    queryFn: () => apiGet<TrackLayoutsResponse>('/api/track-layouts'),
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

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');

  const layouts = data?.layouts ?? [];
  const sessionMap = data?.session_map ?? {};

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>Track Maps</h1>
      </div>

      {isLoading ? (
        <p className="text-muted">Loading...</p>
      ) : layouts.length === 0 ? (
        <p className="text-muted">No track layouts yet. Create one from a session's track map tool.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr><th>Name</th><th>Track</th><th>Source Session</th><th>Created</th><th></th></tr>
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
                <td>{tl.created_at ? new Date(tl.created_at).toLocaleDateString() : '—'}</td>
                <td className="actions">
                  <Button variant="danger" size="sm" onClick={() => {
                    if (confirm(`Delete layout "${tl.name}"?`)) deleteMut.mutate(tl.id);
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
