import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../../api/client';
import type { TrackSection } from '../../types/models';
import TrackMap from '../maps/TrackMap';
import TelemetryChart from '../charts/TelemetryChart';
import Button from '../ui/Button';

interface SectionEditorProps {
  sessionId: string;
  trackName: string;
  points: { lat: number; lng: number; distance?: number }[];
  xValues: number[];
  xLabel: string;
  channels: { label: string; data: number[] }[];
  sections: TrackSection[];
  onSectionsChange?: (sections: TrackSection[]) => void;
}

export default function SectionEditor({
  sessionId,
  trackName,
  points,
  xValues,
  xLabel,
  channels,
  sections: initialSections,
  onSectionsChange,
}: SectionEditorProps) {
  const qc = useQueryClient();
  const [sections, setSections] = useState<TrackSection[]>(initialSections);
  const [editName, setEditName] = useState<Record<string, string>>({});

  const saveMut = useMutation({
    mutationFn: () =>
      apiPost<{ ok: boolean; sections: TrackSection[] }>(
        `/api/sections/${trackName}`,
        { sections: sections.map((s) => s) },
      ),
    onSuccess: (data) => {
      setSections(data.sections);
      onSectionsChange?.(data.sections);
      qc.invalidateQueries({ queryKey: ['session-detail', sessionId] });
    },
  });

  const autoMut = useMutation({
    mutationFn: () => apiGet<TrackSection[]>(`/api/sections/${trackName}/auto-detect?session_id=${sessionId}`),
    onSuccess: (data) => setSections(data),
  });

  function updateSection(id: string, field: string, value: unknown) {
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
  }

  function removeSection(id: string) {
    setSections((prev) => prev.filter((s) => s.id !== id));
  }

  const sectionOverlays = sections.map((s) => ({
    name: s.name,
    start: s.start_distance,
    end: s.end_distance,
    color: `hsla(${(s.sort_order * 47) % 360},60%,50%,0.15)`,
  }));

  return (
    <div className="section-editor">
      <div className="section-editor-viz">
        <TrackMap points={points} sections={sectionOverlays} height={250} />
        <TelemetryChart
          xValues={xValues}
          xLabel={xLabel}
          channels={channels}
          sections={sectionOverlays}
          height={150}
        />
      </div>

      <div className="section-editor-list">
        <div className="section-editor-header">
          <h4>Sections</h4>
          <div className="form-actions">
            <Button size="sm" variant="secondary" onClick={() => autoMut.mutate()}>Auto-detect</Button>
            <Button size="sm" onClick={() => saveMut.mutate()}>Save</Button>
          </div>
        </div>
        <table className="data-table data-table-sm">
          <thead><tr><th>Name</th><th>Start</th><th>End</th><th></th></tr></thead>
          <tbody>
            {sections.map((s) => (
              <tr key={s.id}>
                <td>
                  <input
                    className="form-input form-input-sm"
                    value={editName[s.id] ?? s.name}
                    onChange={(e) => { setEditName({ ...editName, [s.id]: e.target.value }); }}
                    onBlur={() => {
                      if (editName[s.id] != null) updateSection(s.id, 'name', editName[s.id]);
                    }}
                  />
                </td>
                <td>
                  <input
                    className="form-input form-input-sm"
                    type="number"
                    value={s.start_distance}
                    onChange={(e) => updateSection(s.id, 'start_distance', parseFloat(e.target.value) || 0)}
                  />
                </td>
                <td>
                  <input
                    className="form-input form-input-sm"
                    type="number"
                    value={s.end_distance}
                    onChange={(e) => updateSection(s.id, 'end_distance', parseFloat(e.target.value) || 0)}
                  />
                </td>
                <td><Button variant="danger" size="sm" onClick={() => removeSection(s.id)}>×</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
