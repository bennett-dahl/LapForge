import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch } from '../api/client';
import type { SettingsResponse } from '../types/api';
import Button from '../components/ui/Button';
import SyncPanel from '../components/SyncPanel';

type Tab = 'preferences' | 'data' | 'sync' | 'account';

export default function SettingsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('preferences');

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiGet<SettingsResponse>('/api/settings'),
  });

  const [prefs, setPrefs] = useState<Record<string, string>>({});
  const prefsLoaded = Object.keys(prefs).length > 0;

  if (settings && !prefsLoaded) {
    const p = settings.preferences;
    setPrefs({
      default_target_pressure_psi: String(p.default_target_pressure_psi ?? ''),
      default_pressure_unit: String(p.default_pressure_unit ?? 'psi'),
      default_temp_unit: String(p.default_temp_unit ?? 'F'),
      default_distance_unit: String(p.default_distance_unit ?? 'meters'),
    });
  }

  const saveMut = useMutation({
    mutationFn: (data: Record<string, unknown>) => apiPatch<{ ok: boolean }>('/api/settings', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });

  function handleSavePrefs(e: React.FormEvent) {
    e.preventDefault();
    saveMut.mutate({
      default_target_pressure_psi: parseFloat(prefs.default_target_pressure_psi) || null,
      default_pressure_unit: prefs.default_pressure_unit,
      default_temp_unit: prefs.default_temp_unit,
      default_distance_unit: prefs.default_distance_unit,
    });
  }

  if (isLoading) return <div className="page-content"><p className="text-muted">Loading...</p></div>;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'preferences', label: 'Preferences' },
    { key: 'data', label: 'Data Location' },
    { key: 'sync', label: 'Cloud Sync' },
    { key: 'account', label: 'Account' },
  ];

  return (
    <div className="page-content">
      <h1>Settings</h1>

      <div className="tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`tab${tab === t.key ? ' tab-active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="tab-content card">
        {tab === 'preferences' && (
          <form onSubmit={handleSavePrefs}>
            <label className="form-label">
              Default Target Pressure (PSI)
              <input
                className="form-input"
                type="number"
                step="0.1"
                value={prefs.default_target_pressure_psi ?? ''}
                onChange={(e) => setPrefs({ ...prefs, default_target_pressure_psi: e.target.value })}
              />
            </label>
            <label className="form-label">
              Pressure Unit
              <select className="form-select" value={prefs.default_pressure_unit ?? 'psi'} onChange={(e) => setPrefs({ ...prefs, default_pressure_unit: e.target.value })}>
                <option value="psi">PSI</option>
                <option value="bar">Bar</option>
              </select>
            </label>
            <label className="form-label">
              Temperature Unit
              <select className="form-select" value={prefs.default_temp_unit ?? 'F'} onChange={(e) => setPrefs({ ...prefs, default_temp_unit: e.target.value })}>
                <option value="F">Fahrenheit</option>
                <option value="C">Celsius</option>
              </select>
            </label>
            <label className="form-label">
              Distance Unit
              <select className="form-select" value={prefs.default_distance_unit ?? 'meters'} onChange={(e) => setPrefs({ ...prefs, default_distance_unit: e.target.value })}>
                <option value="meters">Meters</option>
                <option value="feet">Feet</option>
              </select>
            </label>
            <div className="form-actions">
              <Button type="submit">Save</Button>
            </div>
          </form>
        )}

        {tab === 'data' && (
          <div>
            <p>Data is stored at:</p>
            <code className="data-path">{settings?.data_root ?? '—'}</code>
          </div>
        )}

        {tab === 'sync' && <SyncPanel />}

        {tab === 'account' && (
          <div>
            {settings?.user ? (
              <div className="account-info">
                <p>Signed in as <strong>{settings.user.name || settings.user.email}</strong></p>
                {settings.user.picture && (
                  <img className="account-avatar" src={settings.user.picture} alt="" referrerPolicy="no-referrer" />
                )}
                <div className="form-actions">
                  <a href="/auth/logout"><Button variant="secondary">Sign Out</Button></a>
                </div>
              </div>
            ) : (
              <div>
                <p className="text-muted">Not signed in.</p>
                {settings?.oauth_enabled && (
                  <a href="/auth/login"><Button>Sign in with Google</Button></a>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
