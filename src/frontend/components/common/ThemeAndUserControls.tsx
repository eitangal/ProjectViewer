import React from 'react';
import { Sun, Moon, LogOut } from 'lucide-react';
import { useViewerStore } from '../../store/useViewerStore.js';

export interface ThemeAndUserControlsProps {
  user?: { email: string; role?: string; globalRole?: string } | null;
  onLogout?: () => void;
  showUser?: boolean;
  showTheme?: boolean;
  showLogout?: boolean;
  className?: string;
}

export const ThemeAndUserControls: React.FC<ThemeAndUserControlsProps> = ({
  user,
  onLogout,
  showUser = true,
  showTheme = true,
  showLogout = true,
  className = '',
}) => {
  const { theme, toggleTheme } = useViewerStore();

  const role = user?.role || user?.globalRole || 'VIEWER';
  const roleLabel =
    role === 'SYSADMIN' ? 'Admin' : role === 'PUBLISHER' ? 'Publisher' : 'Viewer';

  const roleBadgeClass =
    roleLabel === 'Admin'
      ? 'bg-rose-950/80 text-rose-300 border-rose-800/60'
      : roleLabel === 'Publisher'
      ? 'bg-indigo-950/80 text-indigo-300 border-indigo-800/60'
      : 'bg-emerald-950/80 text-emerald-300 border-emerald-800/60';

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {/* Light / Dark Mode Toggle */}
      {showTheme && (
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
      )}

      {/* Current User Badge */}
      {showUser && user?.email && (
        <div
          className="flex items-center gap-2 px-2.5 py-1 rounded-xl bg-slate-950/90 border border-slate-800 text-xs shrink-0"
          title={`Signed in as ${user.email} (${roleLabel})`}
        >
          <div className="w-5 h-5 rounded-full bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center font-bold text-[10px] shrink-0">
            {user.email.charAt(0).toUpperCase()}
          </div>
          <span className="text-slate-200 font-medium max-w-[120px] md:max-w-[180px] truncate">
            {user.email}
          </span>
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border shrink-0 ${roleBadgeClass}`}
          >
            {roleLabel}
          </span>
        </div>
      )}

      {/* Logout Action */}
      {showLogout && onLogout && (
        <button
          type="button"
          onClick={onLogout}
          title={`Sign Out (${user?.email || 'Current User'})`}
          aria-label="Sign Out"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-slate-800 border border-slate-800/60 hover:border-rose-900/60 transition-colors text-xs font-medium shrink-0"
        >
          <LogOut size={14} />
          <span className="hidden sm:inline">Logout</span>
        </button>
      )}
    </div>
  );
};
