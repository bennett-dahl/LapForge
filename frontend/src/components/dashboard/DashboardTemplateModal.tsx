import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiDelete } from '../../api/client';
import type { DashboardTemplate, DashboardModule } from '../../types/models';
import Button from '../ui/Button';
import Modal from '../ui/Modal';

interface DashboardTemplateModalProps {
  open: boolean;
  onClose: () => void;
  currentLayout: DashboardModule[];
  onApplyTemplate: (layout: DashboardModule[]) => void;
}

export default function DashboardTemplateModal({
  open,
  onClose,
  currentLayout,
  onApplyTemplate,
}: DashboardTemplateModalProps) {
  const qc = useQueryClient();
  const [saveName, setSaveName] = useState('');

  const { data: templates = [] } = useQuery({
    queryKey: ['dashboard-templates'],
    queryFn: () => apiGet<DashboardTemplate[]>('/api/dashboard-templates'),
    enabled: open,
  });

  const saveMut = useMutation({
    mutationFn: (name: string) =>
      apiPost<DashboardTemplate>('/api/dashboard-templates', { name, layout: currentLayout }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dashboard-templates'] });
      setSaveName('');
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/dashboard-templates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard-templates'] }),
  });

  return (
    <Modal open={open} onClose={onClose} title="Dashboard Templates">
      <div className="template-save">
        <form onSubmit={(e) => { e.preventDefault(); if (saveName.trim()) saveMut.mutate(saveName.trim()); }}>
          <div className="form-row">
            <input
              className="form-input"
              placeholder="Template name..."
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
            />
            <Button type="submit" size="sm" disabled={!saveName.trim()}>Save Current</Button>
          </div>
        </form>
      </div>

      {templates.length > 0 && (
        <div className="template-list">
          <h4>Saved Templates</h4>
          {templates.map((t) => (
            <div key={t.id} className="template-item">
              <span className="template-name">{t.name}</span>
              <div className="template-actions">
                <Button size="sm" variant="ghost" onClick={() => { onApplyTemplate(t.layout); onClose(); }}>
                  Apply
                </Button>
                <Button size="sm" variant="danger" onClick={() => deleteMut.mutate(t.id)}>
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
