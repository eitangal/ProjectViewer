import React, { useState, useEffect } from 'react';
import { Menu, Sparkles, Code, FileText, AlertTriangle } from 'lucide-react';
import { useViewerStore } from '../../store/useViewerStore.js';
import { ThemeAndUserControls } from '../common/ThemeAndUserControls.js';

interface ToastMessage {
  id: string;
  type: 'warning' | 'info' | 'error';
  message: string;
}

export const ViewerWorkspaceLayout: React.FC<{
  projectName?: string;
  isAiEnabled?: boolean;
  user?: { email: string; role?: string; globalRole?: string } | null;
  onLogout?: () => void;
  children: React.ReactNode;
}> = ({
  projectName = 'Project Portal',
  isAiEnabled = true,
  user,
  onLogout,
  children,
}) => {
  const {
    direction,
    setDirection,
    isSidebarOpen,
    toggleSidebar,
    isAiDrawerOpen,
    toggleAiDrawer,
    isAiDrawerMaximized,
    viewMode,
    setViewMode,
    activeFilePath,
  } = useViewerStore();

  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Listen for portal:toast events (e.g. access restricted toasts from smart links)
  useEffect(() => {
    const handleToast = (e: Event) => {
      const customEvent = e as CustomEvent<{ type: 'warning' | 'info' | 'error'; message: string }>;
      const id = Math.random().toString(36).substring(2, 9);
      setToasts((prev) => [...prev, { id, ...customEvent.detail }]);

      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4500);
    };

    window.addEventListener('portal:toast', handleToast);
    return () => window.removeEventListener('portal:toast', handleToast);
  }, []);

  const pathParts = activeFilePath ? activeFilePath.split('/') : [];

  return (
    <div
      dir={direction}
      className="flex flex-col h-screen w-screen overflow-hidden bg-slate-950 text-slate-100"
    >
      {/* Top Navigation Bar */}
      <header className="h-14 border-b border-slate-800 bg-slate-900/90 backdrop-blur-md flex items-center justify-between px-4 shrink-0 z-30">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={toggleSidebar}
            aria-label="Toggle File Tree"
            className={`p-2 rounded-xl transition-colors ${
              isSidebarOpen ? 'bg-slate-800 text-slate-100 font-medium' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            <Menu size={18} />
          </button>

          <span className="font-semibold text-sm tracking-wide text-slate-200 shrink-0">
            {projectName}
          </span>

          {/* Interactive Breadcrumbs */}
          {pathParts.length > 0 && (
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-400 overflow-x-auto ms-2">
              <span className="text-slate-600">/</span>
              {pathParts.map((part, idx) => (
                <React.Fragment key={idx}>
                  <span
                    className={
                      idx === pathParts.length - 1
                        ? 'font-medium text-slate-200 truncate'
                        : 'text-slate-400'
                    }
                  >
                    {part}
                  </span>
                  {idx < pathParts.length - 1 && <span className="text-slate-600">/</span>}
                </React.Fragment>
              ))}
            </div>
          )}
        </div>

        {/* Right Toolbar Controls */}
        <div className="flex items-center gap-2 md:gap-2.5 shrink-0">
          {/* Formatted vs Raw Segmented Control */}
          <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
            <button
              onClick={() => setViewMode('formatted')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-all ${
                viewMode === 'formatted'
                  ? 'bg-indigo-600 text-white font-medium shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <FileText size={13} />
              <span className="hidden md:inline">Formatted</span>
            </button>
            <button
              onClick={() => setViewMode('raw')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-all ${
                viewMode === 'raw'
                  ? 'bg-indigo-600 text-white font-medium shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Code size={13} />
              <span className="hidden md:inline">Raw Code</span>
            </button>
          </div>

          {/* Bi-Directional (LTR / RTL) Switcher */}
          <div className="hidden sm:flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-mono">
            <button
              onClick={() => setDirection('ltr')}
              className={`px-2 py-1 rounded-lg transition-all ${
                direction === 'ltr'
                  ? 'bg-slate-800 text-slate-100 font-medium'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              LTR
            </button>
            <button
              onClick={() => setDirection('rtl')}
              className={`px-2 py-1 rounded-lg transition-all ${
                direction === 'rtl'
                  ? 'bg-slate-800 text-slate-100 font-medium'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              RTL
            </button>
          </div>

          {/* AI Drawer Toggle */}
          {isAiEnabled && (
            <button
              onClick={toggleAiDrawer}
              title={
                isAiDrawerOpen
                  ? isAiDrawerMaximized
                    ? 'Close AI Assistant (Full Workarea)'
                    : 'Close AI Assistant'
                  : 'Open AI Assistant'
              }
              aria-label="Toggle AI Assistant"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${
                isAiDrawerOpen
                  ? 'bg-indigo-600 text-white border-indigo-500 shadow-md shadow-indigo-600/30'
                  : 'bg-slate-900 hover:bg-slate-800 text-indigo-400 border-slate-800'
              }`}
            >
              <Sparkles size={14} />
              <span className="hidden md:inline">AI Chat</span>
            </button>
          )}

          <div className="h-4 w-px bg-slate-800 mx-0.5 hidden sm:block" />

          {/* Theme Toggle, User Display & Logout */}
          <ThemeAndUserControls
            user={user}
            onLogout={onLogout}
            showUser={true}
            showTheme={true}
            showLogout={true}
          />
        </div>
      </header>

      {/* Main Workspace Pane */}
      <div className="flex flex-1 overflow-hidden relative">
        {children}
      </div>

      {/* Floating Toast Notifications */}
      <div className="fixed bottom-4 end-4 z-50 flex flex-col gap-2 max-w-sm pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto p-3.5 rounded-xl text-xs shadow-2xl flex items-center gap-2.5 transition-all border ${
              toast.type === 'warning'
                ? 'bg-amber-950/90 border-amber-800 text-amber-200'
                : toast.type === 'error'
                ? 'bg-rose-950/90 border-rose-800 text-rose-200'
                : 'bg-slate-900 border-slate-700 text-slate-200'
            }`}
          >
            <AlertTriangle size={16} className="shrink-0" />
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
