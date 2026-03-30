import { NavLink, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import type { AuthUserResponse } from '../types/api';
import { apiGet } from '../api/client';

interface NavItem {
  to: string;
  label: string;
  svg: string;
  end?: boolean;
}

const NAV_TOP: NavItem[] = [
  { to: '/', label: 'Home', end: true, svg: '<path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1h-2z"/>' },
  { to: '/sessions', label: 'Sessions', svg: '<path d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2m8 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2"/>' },
  { to: '/upload', label: 'Upload', svg: '<path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12m0-12L8 8m4-4l4 4"/>' },
  { to: '/compare', label: 'Compare', svg: '<path d="M9 19V6l12-3v13M9 19c0 1.1-1.3 2-3 2s-3-.9-3-2 1.3-2 3-2 3 .9 3 2zM21 16c0 1.1-1.3 2-3 2s-3-.9-3-2 1.3-2 3-2 3 .9 3 2z"/>' },
];

const NAV_BOTTOM: NavItem[] = [
  { to: '/car-drivers', label: 'Car / Driver', svg: '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87m-4-12a4 4 0 010 7.75"/>' },
  { to: '/tire-sets', label: 'Tire Sets', svg: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><path d="M12 2a15 15 0 010 20M2 12a15 15 0 0120 0"/>' },
  { to: '/track-layouts', label: 'Track Maps', svg: '<polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>' },
  { to: '/settings', label: 'Settings', svg: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>' },
];

function NavLinkItem({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) => `sb-link${isActive ? ' active' : ''}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        dangerouslySetInnerHTML={{ __html: item.svg }}
      />
      <span className="sb-label">{item.label}</span>
    </NavLink>
  );
}

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(() =>
    localStorage.getItem('sidebar_collapsed') === '1',
  );
  const [user, setUser] = useState<AuthUserResponse | null>(null);

  useEffect(() => {
    apiGet<AuthUserResponse>('/api/auth/user').then(setUser).catch(() => setUser(null));
  }, []);

  function toggleSidebar() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('sidebar_collapsed', next ? '1' : '0');
  }

  return (
    <div className="app-root">
      <aside className={`sidebar${collapsed ? ' collapsed' : ''}`} id="sidebar">
        <div className="sb-brand">
          <img className="sb-logo" src="/static/images/symbol.png" alt="LapForge" />
        </div>
        <nav className="sb-nav">
          {NAV_TOP.map((item) => (
            <NavLinkItem key={item.to} item={item} />
          ))}
          <div className="sb-divider" />
          {NAV_BOTTOM.map((item) => (
            <NavLinkItem key={item.to} item={item} />
          ))}
        </nav>
        <div className="sb-footer">
          {user?.user ? (
            <>
              <div className="sb-user">
                {user.user.picture ? (
                  <img className="sb-user-avatar" src={user.user.picture} alt="" referrerPolicy="no-referrer" />
                ) : (
                  <svg className="sb-user-avatar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" />
                  </svg>
                )}
                <span className="sb-label sb-user-name">{user.user.name || user.user.email}</span>
              </div>
              <a href="/auth/logout" className="sb-link sb-signout">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                <span className="sb-label">Sign out</span>
              </a>
            </>
          ) : user?.oauth_enabled ? (
            <a href="/auth/login" className="sb-link sb-signin">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4" />
                <polyline points="10 17 15 12 10 7" />
                <line x1="15" y1="12" x2="3" y2="12" />
              </svg>
              <span className="sb-label">Sign in</span>
            </a>
          ) : null}
          <button className="sb-collapse-btn" id="sb-toggle" onClick={toggleSidebar} title="Toggle sidebar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
            <span className="sb-label">Collapse</span>
          </button>
        </div>
      </aside>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
