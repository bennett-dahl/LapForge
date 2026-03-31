import { useCallback, useEffect, useState } from 'react';

const LINE_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#a855f7',
  '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1',
  '#14b8a6', '#e879f9', '#eab308', '#0ea5e9', '#f43f5e',
];

export interface ChannelPickerMeta {
  label: string;
  unit?: string;
}

interface ChannelPickerModalProps {
  open: boolean;
  onClose: () => void;
  channelsByCategory: Record<string, string[]>;
  channelMeta: Record<string, ChannelPickerMeta>;
  selected: string[];
  channelColors?: Record<string, string>;
  onApply: (channels: string[], channelColors: Record<string, string>) => void;
}

function defaultColorForIndex(i: number): string {
  return LINE_COLORS[i % LINE_COLORS.length];
}

export default function ChannelPickerModal({
  open,
  onClose,
  channelsByCategory,
  channelMeta,
  selected,
  channelColors,
  onApply,
}: ChannelPickerModalProps) {
  const [picked, setPicked] = useState<string[]>(selected);
  const [draftColors, setDraftColors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      setPicked([...selected]);
      setDraftColors({ ...(channelColors ?? {}) });
    }
  }, [open, selected, channelColors]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const toggle = useCallback((key: string) => {
    setPicked((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }, []);

  const handleApply = useCallback(() => {
    const compact: Record<string, string> = {};
    picked.forEach((k, i) => {
      const custom = draftColors[k];
      if (custom && custom !== defaultColorForIndex(i)) {
        compact[k] = custom;
      }
    });
    onApply(picked, compact);
    onClose();
  }, [picked, draftColors, onApply, onClose]);

  if (!open) return null;

  const categories = Object.entries(channelsByCategory).filter(([, keys]) => keys.length);

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="channel-picker-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="channel-picker-title" style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>
          Channels
        </h3>
        <div style={{ overflowY: 'auto', flex: 1, minHeight: 0, marginBottom: '0.5rem' }}>
          {categories.length === 0 ? (
            <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>No channels available.</p>
          ) : (
            categories.map(([category, keys]) => (
              <div key={category} style={{ marginBottom: '0.75rem' }}>
                <div
                  style={{
                    fontSize: '0.72rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    color: 'var(--muted)',
                    marginBottom: '0.35rem',
                  }}
                >
                  {category}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  {keys.map((key) => {
                    const meta = channelMeta[key];
                    const label = meta?.label ?? key;
                    const unit = meta?.unit ? ` (${meta.unit})` : '';
                    const isChecked = picked.includes(key);
                    const pickedIdx = picked.indexOf(key);
                    const currentColor =
                      draftColors[key] ??
                      (pickedIdx >= 0 ? defaultColorForIndex(pickedIdx) : defaultColorForIndex(0));
                    return (
                      <label
                        key={key}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          fontSize: '0.82rem',
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggle(key)}
                        />
                        {isChecked && (
                          <input
                            type="color"
                            className="channel-color-picker"
                            value={currentColor}
                            title={`Color for ${label}`}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              setDraftColors((prev) => ({ ...prev, [key]: e.target.value }));
                            }}
                          />
                        )}
                        <span style={isChecked ? { color: currentColor } : undefined}>
                          {label}{unit}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="panel-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="panel-btn btn-active" onClick={handleApply}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
