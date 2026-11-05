import React, { useState, useRef, useEffect } from 'react';
import { Sun, Moon, LogOut } from 'lucide-react';
import { useViewerStore } from '../../store/useViewerStore.js';

export interface ThemeAndUserControlsProps {
  user?: { email: string; role?: string; globalRole?: string; name?: string } | null;
  onLogout?: () => void;
  showUser?: boolean;
  showTheme?: boolean;
  showLogout?: boolean;
  className?: string;
}

export function getUserInitials(user?: { email?: string; name?: string } | null): string {
  if (!user) return 'U';
  if (user.name && user.name.trim()) {
    const parts = user.name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return parts[0].slice(0, 2).toUpperCase();
  }
  if (user.email && user.email.trim()) {
    const local = user.email.split('@')[0];
    const parts = local.split(/[._-]/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return local.slice(0, 2).toUpperCase();
  }
  return 'U';
}

export const ThemeAndUserControls: React.FC<ThemeAndUserControlsProps> = ({
  user,
  onLogout,
  showUser = true,
  showTheme = true,
  showLogout = true,
  className = '',
}) => {
  const { theme, toggleTheme, setTheme } = useViewerStore();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsMenuOpen(false);
      }
    }

    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMenuOpen]);

  // If no user session is present (e.g., Login View), display standalone theme button if requested
  if (!user || !showUser) {
    if (!showTheme) return null;
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <button
          type="button"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          aria-label={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          className="p-2 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-transparent hover:border-slate-700/60 transition-colors"
        >
          {theme === 'dark' ? (
            <Sun size={15} className="text-amber-400" />
          ) : (
            <Moon size={15} className="text-indigo-600" />
          )}
        </button>
      </div>
    );
  }

  const role = user.role || user.globalRole || 'VIEWER';
  const roleLabel =
    role === 'SYSADMIN' ? 'Admin' : role === 'PUBLISHER' ? 'Publisher' : 'Viewer';

  const roleBadgeClass =
    roleLabel === 'Admin'
      ? 'bg-rose-950/80 text-rose-300 border-rose-800/60'
      : roleLabel === 'Publisher'
      ? 'bg-indigo-950/80 text-indigo-300 border-indigo-800/60'
      : 'bg-emerald-950/80 text-emerald-300 border-emerald-800/60';

  const initials = getUserInitials(user);

  return (
    <div className={`relative ${className}`} ref={menuRef}>
      {/* Header Button: Displays ONLY User Initials Avatar */}
      <button
        type="button"
        onClick={() => setIsMenuOpen((prev) => !prev)}
        title={`Signed in as ${user.email} (${roleLabel})`}
        aria-label="User Account Menu"
        aria-haspopup="menu"
        aria-expanded={isMenuOpen}
        className="w-8 h-8 rounded-full bg-indigo-600/20 text-indigo-400 hover:text-indigo-200 border border-indigo-500/30 hover:border-indigo-400 font-bold text-xs flex items-center justify-center transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500 shrink-0 shadow-sm"
      >
        {initials}
      </button>

      {/* Small Dropdown User Menu */}
      {isMenuOpen && (
        <div
          role="menu"
          aria-orientation="vertical"
          className="absolute end-0 top-full mt-2 w-64 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-3 z-50 flex flex-col gap-3 animate-in fade-in slide-in-from-top-1 duration-150"
        >
          {/* User Details Section */}
          <div className="flex items-center gap-2.5 pb-2.5 border-b border-slate-800">
            <div className="w-8 h-8 rounded-full bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center font-bold text-xs shrink-0">
              {initials}
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-xs font-semibold text-slate-100 truncate" title={user.email}>
                {user.email}
              </span>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span
                  className={`px-1.5 py-0.2 rounded text-[10px] font-semibold uppercase tracking-wider border shrink-0 ${roleBadgeClass}`}
                >
                  {roleLabel}
                </span>
              </div>
            </div>
          </div>

          {/* Theme Selection Section */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 px-0.5">
              Theme
            </span>
            <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
              <button
                type="button"
                onClick={() => setTheme('dark')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1 rounded-lg transition-all ${
                  theme === 'dark'
                    ? 'bg-slate-800 text-slate-100 font-medium shadow-xs'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Moon size={13} className="text-indigo-400" />
                <span>Dark</span>
              </button>
              <button
                type="button"
                onClick={() => setTheme('light')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1 rounded-lg transition-all ${
                  theme === 'light'
                    ? 'bg-slate-200 text-slate-900 font-medium shadow-xs'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Sun size={13} className="text-amber-500" />
                <span>Light</span>
              </button>
            </div>
          </div>

          {/* Logout Action */}
          {showLogout && onLogout && (
            <div className="pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setIsMenuOpen(false);
                  onLogout();
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs font-medium text-slate-400 hover:text-rose-400 hover:bg-slate-800/80 transition-colors"
              >
                <LogOut size={14} />
                <span>Sign Out</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
