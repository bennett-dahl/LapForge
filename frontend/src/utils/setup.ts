import type { Setup, SetupListItem, SessionListItem } from '../types/models';

export function setupLabel(
  setup: Setup | SetupListItem,
  sessions?: SessionListItem[],
): string {
  if (setup.name) return setup.name;
  if (setup.session_id && sessions) {
    const sess = sessions.find((s) => s.id === setup.session_id);
    if (sess) return sess.label;
  }
  if (setup.created_at) {
    return `Setup — ${new Date(setup.created_at).toLocaleDateString()}`;
  }
  return setup.id.slice(0, 8);
}
