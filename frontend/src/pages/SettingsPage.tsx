import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch, apiPost } from '../api/client';
import type { SettingsResponse } from '../types/api';
import Button from '../components/ui/Button';
import SyncPanel from '../components/SyncPanel';

type Tab = 'preferences' | 'data' | 'backup' | 'sync' | 'account';

function normalizeTempUnit(u: string): string {
  const x = (u || 'c').toLowerCase();
  return x === 'f' ? 'f' : 'c';
}

function normalizeDistanceUnit(u: string): string {
  const x = (u || 'km').toLowerCase();
  if (x === 'feet' || x === 'mi' || x === 'miles') return 'mi';
  if (x === 'meters' || x === 'meter' || x === 'km') return 'km';
  return x === 'mi' ? 'mi' : 'km';
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('preferences');

  useEffect(() => {
    document.title = 'LapForge - Settings';
  }, []);

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
      default_temp_unit: normalizeTempUnit(String(p.default_temp_unit ?? 'c')),
      default_distance_unit: normalizeDistanceUnit(String(p.default_distance_unit ?? 'km')),
      section_lat_g_threshold:
        p.section_lat_g_threshold != null && p.section_lat_g_threshold !== ''
          ? String(p.section_lat_g_threshold)
          : '',
      section_min_corner_length_m: String(p.section_min_corner_length_m ?? 30),
      section_merge_gap_m: String(p.section_merge_gap_m ?? 50),
    });
  }

  const saveMut = useMutation({
    mutationFn: (data: Record<string, unknown>) => apiPatch<{ ok: boolean }>('/api/settings', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });

  function handleSavePrefs(e: React.FormEvent) {
    e.preventDefault();
    const latRaw = (prefs.section_lat_g_threshold ?? '').trim();
    saveMut.mutate({
      default_target_pressure_psi: parseFloat(prefs.default_target_pressure_psi),
      default_pressure_unit: prefs.default_pressure_unit,
      default_temp_unit: prefs.default_temp_unit,
      default_distance_unit: prefs.default_distance_unit,
      section_lat_g_threshold: latRaw === '' ? null : parseFloat(latRaw),
      section_min_corner_length_m: parseFloat(prefs.section_min_corner_length_m) || 30,
      section_merge_gap_m: parseFloat(prefs.section_merge_gap_m) || 50,
    });
  }

  const [dataPathEditorOpen, setDataPathEditorOpen] = useState(false);
  const [newDataPath, setNewDataPath] = useState('');
  const [dataLocMessage, setDataLocMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [dataLocBusy, setDataLocBusy] = useState(false);

  async function runDataLocationAction(action: 'move' | 'switch') {
    const path = newDataPath.trim();
    if (!path) {
      setDataLocMessage({ kind: 'err', text: 'Path is required' });
      return;
    }
    setDataLocBusy(true);
    setDataLocMessage(null);
    try {
      await apiPost('/api/data-location', { path, action: 'check' });
      await apiPost<{ ok?: boolean; path?: string }>('/api/data-location', { path, action });
      setDataLocMessage({ kind: 'ok', text: 'Data location updated successfully.' });
      setDataPathEditorOpen(false);
      setNewDataPath('');
      await qc.invalidateQueries({ queryKey: ['settings'] });
    } catch (err) {
      setDataLocMessage({
        kind: 'err',
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setDataLocBusy(false);
    }
  }

  const [backupExportInfo, setBackupExportInfo] = useState<string | null>(null);
  const [backupRestorePath, setBackupRestorePath] = useState('');
  const [backupMessage, setBackupMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);

  async function handleBackupExport() {
    setBackupBusy(true);
    setBackupMessage(null);
    try {
      const r = await apiPost<{ ok: boolean; path: string; size_bytes: number }>('/api/backup/export');
      const mb = (r.size_bytes / (1024 * 1024)).toFixed(2);
      setBackupExportInfo(`${r.path} — ${mb} MB`);
    } catch (err) {
      setBackupMessage({
        kind: 'err',
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBackupBusy(false);
    }
  }

  async function handleBackupRestore() {
    if (!confirm('This will overwrite your current data. Continue?')) return;
    const path = backupRestorePath.trim();
    if (!path) {
      setBackupMessage({ kind: 'err', text: 'Path is required' });
      return;
    }
    setBackupBusy(true);
    setBackupMessage(null);
    try {
      await apiPost('/api/backup/restore', { path });
      window.location.reload();
    } catch (err) {
      setBackupMessage({
        kind: 'err',
        text: err instanceof Error ? err.message : String(err),
      });
      setBackupBusy(false);
    }
  }

  if (isLoading) return <div className="page-content"><p className="muted">Loading...</p></div>;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'preferences', label: 'Preferences' },
    { key: 'data', label: 'Data Location' },
    { key: 'backup', label: 'Backup & Restore' },
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
            <p className="muted" style={{ marginTop: 0 }}>
              Configure your default units, target pressures, and analysis parameters.
            </p>
            <label className="form-label">
              Default Target Pressure (PSI)
              <input
                className="form-input"
                type="number"
                step="0.1"
                min={14}
                max={35}
                required
                value={prefs.default_target_pressure_psi ?? ''}
                onChange={(e) => setPrefs({ ...prefs, default_target_pressure_psi: e.target.value })}
              />
            </label>
            <p className="muted">Typical cold target pressure for your setup (14–35 PSI).</p>

            <label className="form-label">
              Pressure Unit
              <select className="form-select" value={prefs.default_pressure_unit ?? 'psi'} onChange={(e) => setPrefs({ ...prefs, default_pressure_unit: e.target.value })}>
                <option value="psi">PSI</option>
                <option value="bar">Bar</option>
              </select>
            </label>
            <p className="muted">Unit shown for pressure readouts and forms.</p>

            <label className="form-label">
              Temperature Unit
              <select className="form-select" value={prefs.default_temp_unit ?? 'c'} onChange={(e) => setPrefs({ ...prefs, default_temp_unit: e.target.value })}>
                <option value="c">Celsius</option>
                <option value="f">Fahrenheit</option>
              </select>
            </label>
            <p className="muted">Unit for ambient and track temperatures.</p>

            <label className="form-label">
              Distance / speed unit
              <select className="form-select" value={prefs.default_distance_unit ?? 'km'} onChange={(e) => setPrefs({ ...prefs, default_distance_unit: e.target.value })}>
                <option value="km">km / km/h</option>
                <option value="mi">mi / mph</option>
              </select>
            </label>
            <p className="muted">Distance and speed display for laps and telemetry.</p>

            <label className="form-label">
              Section lateral G threshold
              <input
                className="form-input"
                type="number"
                step="0.01"
                placeholder="Auto"
                value={prefs.section_lat_g_threshold ?? ''}
                onChange={(e) => setPrefs({ ...prefs, section_lat_g_threshold: e.target.value })}
              />
            </label>
            <p className="muted">Lateral G threshold for corner detection. Leave empty for auto.</p>

            <label className="form-label">
              Minimum corner length (SI meters)
              <input
                className="form-input"
                type="number"
                step={1}
                min={1}
                value={prefs.section_min_corner_length_m ?? ''}
                onChange={(e) => setPrefs({ ...prefs, section_min_corner_length_m: e.target.value })}
              />
            </label>
            <p className="muted">Along-track geometry in SI meters. Chart distance axes use your km/mi preference above.</p>

            <label className="form-label">
              Section merge gap (SI meters)
              <input
                className="form-input"
                type="number"
                step={1}
                min={1}
                value={prefs.section_merge_gap_m ?? ''}
                onChange={(e) => setPrefs({ ...prefs, section_merge_gap_m: e.target.value })}
              />
            </label>
            <p className="muted">Merge gap in SI meters. Telemetry distance is labeled and ticked in km or mi per preference.</p>

            <div className="form-actions">
              <Button type="submit">Save</Button>
            </div>
          </form>
        )}

        {tab === 'data' && (
          <div>
            <p>Data is stored at:</p>
            <code className="data-path">{settings?.data_root ?? '—'}</code>
            {!dataPathEditorOpen ? (
              <div className="form-actions" style={{ marginTop: '1rem' }}>
                <Button type="button" onClick={() => { setDataPathEditorOpen(true); setDataLocMessage(null); }}>
                  Change
                </Button>
              </div>
            ) : (
              <div style={{ marginTop: '1rem' }}>
                <label className="form-label">
                  New data directory
                  <input
                    className="form-input"
                    type="text"
                    value={newDataPath}
                    onChange={(e) => setNewDataPath(e.target.value)}
                    placeholder="e.g. C:\LapForgeData"
                  />
                </label>
                <p className="muted">
                  Move data copies your database and uploads to an empty folder. Switch location points the app at an existing data folder (no copy).
                </p>
                <div className="form-actions">
                  <Button type="button" disabled={dataLocBusy} onClick={() => runDataLocationAction('move')}>
                    Move data
                  </Button>
                  <Button type="button" variant="secondary" disabled={dataLocBusy} onClick={() => runDataLocationAction('switch')}>
                    Switch location
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={dataLocBusy}
                    onClick={() => {
                      setDataPathEditorOpen(false);
                      setNewDataPath('');
                      setDataLocMessage(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
            {dataLocMessage && (
              <p className="muted" style={{ marginTop: '0.75rem', color: dataLocMessage.kind === 'err' ? '#f87171' : undefined }}>
                {dataLocMessage.text}
              </p>
            )}
          </div>
        )}

        {tab === 'backup' && (
          <div>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Export backup</h2>
            <p className="muted">Create a zip of your local data in the data folder.</p>
            <div className="form-actions">
              <Button type="button" disabled={backupBusy} onClick={handleBackupExport}>
                Export Backup
              </Button>
            </div>
            {backupExportInfo && <p className="muted" style={{ marginTop: '0.5rem' }}>{backupExportInfo}</p>}

            <h2 style={{ fontSize: '1rem', marginTop: '1.5rem' }}>Restore</h2>
            <p className="muted">Restore from a backup zip file. This replaces current data.</p>
            <label className="form-label">
              Backup file path
              <input
                className="form-input"
                type="text"
                value={backupRestorePath}
                onChange={(e) => setBackupRestorePath(e.target.value)}
                placeholder="Path to .zip"
              />
            </label>
            <div className="form-actions">
              <Button type="button" variant="secondary" disabled={backupBusy} onClick={handleBackupRestore}>
                Restore
              </Button>
            </div>

            {backupMessage && (
              <p className="muted" style={{ marginTop: '0.75rem', color: backupMessage.kind === 'err' ? '#f87171' : undefined }}>
                {backupMessage.text}
              </p>
            )}
          </div>
        )}

        {tab === 'sync' && <SyncPanel />}

        {tab === 'account' && (
          <div>
            {settings?.user ? (
              <div className="account-info">
                <p>
                  Signed in as <strong>{settings.user.name || settings.user.email}</strong>
                </p>
                {settings.user.picture && (
                  <img className="account-avatar" src={settings.user.picture} alt="" referrerPolicy="no-referrer" />
                )}
                <div className="form-actions">
                  <a href="/auth/logout">
                    <Button variant="secondary">Sign Out</Button>
                  </a>
                </div>
              </div>
            ) : (
              <div>
                <p className="muted">Not signed in.</p>
                {settings?.oauth_enabled && (
                  <a href="/auth/login">
                    <Button>Sign in with Google</Button>
                  </a>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
