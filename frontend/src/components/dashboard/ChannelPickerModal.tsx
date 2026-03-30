import { useCallback, useEffect, useState } from 'react';

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
  onApply: (channels: string[]) => void;
}

export default function ChannelPickerModal({
  open,
  onClose,
  channelsByCategory,
  channelMeta,
  selected,
  onApply,
}: ChannelPickerModalProps) {
  const [picked, setPicked] = useState<string[]>(selected);

  useEffect(() => {
    if (open) setPicked([...selected]);
  }, [open, selected]);

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
    onApply(picked);
    onClose();
  }, [picked, onApply, onClose]);

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
                          checked={picked.includes(key)}
                          onChange={() => toggle(key)}
                        />
                        <span>{label}{unit}</span>
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
