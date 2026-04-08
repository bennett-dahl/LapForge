export const SYNC_STATUS_LABELS: Record<string, string> = {
  in_sync: 'In sync',
  local_dirty: 'Local changes pending',
  no_remote: 'No remote backup',
  no_credentials: 'Sign in again',
  conflict: 'Conflict',
  remote_changed: 'Remote changes available',
  never_synced: 'Never synced',
  error: 'Error',
  oauth_not_configured: 'OAuth not configured',
  not_logged_in: 'Not signed in',
};

export function syncStatusLabel(status: string): string {
  return SYNC_STATUS_LABELS[status] ?? status.replace(/_/g, ' ');
}
