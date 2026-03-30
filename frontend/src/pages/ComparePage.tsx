import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { apiGet, apiPost, apiDelete } from '../api/client';
import type { SavedComparison, SessionListItem } from '../types/models';
import type { ComparisonCreateResponse } from '../types/api';
import Button from '../components/ui/Button';

export default function ComparePage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const preselectedIds = params.get('ids')?.split(',').filter(Boolean) ?? [];

  useEffect(() => {
    document.title = 'LapForge - Compare';
  }, []);

  const { data: comparisons = [] } = useQuery({
    queryKey: ['comparisons'],
    queryFn: () => apiGet<SavedComparison[]>('/api/comparisons'),
  });

  const { data: sessions = [] } = useQuery({
    queryKey: ['sessions-list'],
    queryFn: () => apiGet<SessionListItem[]>('/api/sessions/list'),
  });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(preselectedIds));
  const [name, setName] = useState('');

  const createMut = useMutation({
    mutationFn: (data: { name: string; session_ids: string[] }) =>
      apiPost<ComparisonCreateResponse>('/api/comparisons', data),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['comparisons'] });
      navigate(`/compare/${res.id}`);
    },
  });

  const emptyComparisonMut = useMutation({
    mutationFn: () =>
      apiPost<ComparisonCreateResponse>('/api/comparisons', {
        name: 'New Comparison',
        session_ids: [],
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['comparisons'] });
      navigate(`/compare/${res.id}`);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/comparisons/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['comparisons'] }),
  });

  function toggleSession(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handleCreate() {
    const ids = [...selectedIds];
    createMut.mutate({ name: name.trim() || 'New Comparison', session_ids: ids });
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>Compare</h1>
        <div className="page-header-actions">
          <Button
            variant="secondary"
            onClick={() => emptyComparisonMut.mutate()}
            disabled={emptyComparisonMut.isPending}
          >
            New Comparison
          </Button>
        </div>
      </div>

      {comparisons.length > 0 && (
        <section className="compare-saved">
          <h2>Saved Comparisons</h2>
          <div className="card-grid">
            {comparisons.map((c) => (
              <div key={c.id} className="card">
                <Link to={`/compare/${c.id}`} className="card-link">
                  <div className="card-title">{c.name}</div>
                  <div className="card-subtitle">{c.session_ids.length} sessions</div>
                </Link>
                <Button variant="danger" size="sm" onClick={() => {
                  if (confirm(`Delete "${c.name}"?`)) deleteMut.mutate(c.id);
                }}>Delete</Button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="compare-create card">
        <h2>Create New Comparison</h2>
        <p className="muted">Select one or more sessions to compare.</p>

        <div className="compare-session-picker compare-session-picker-scroll">
          {sessions.map((s) => (
            <label key={s.id} className="compare-session-item">
              <input
                type="checkbox"
                checked={selectedIds.has(s.id)}
                onChange={() => toggleSession(s.id)}
              />
              <span>{s.label}</span>
            </label>
          ))}
        </div>

        <div className="form-row">
          <input
            className="form-input"
            placeholder="Comparison name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button onClick={handleCreate} disabled={createMut.isPending}>
            Compare ({selectedIds.size})
          </Button>
        </div>
      </section>
    </div>
  );
}
