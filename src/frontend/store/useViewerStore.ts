import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type TextDirection = 'ltr' | 'rtl';
export type ViewMode = 'formatted' | 'raw';
export type Theme = 'dark' | 'light';

export function applyThemeToDom(theme: Theme) {
  if (typeof document !== 'undefined') {
    if (theme === 'light') {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
      document.documentElement.setAttribute('data-theme', 'light');
      document.documentElement.style.colorScheme = 'light';
    } else {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
      document.documentElement.setAttribute('data-theme', 'dark');
      document.documentElement.style.colorScheme = 'dark';
    }
  }
}

interface ViewerState {
  // Layout & UI Toggles
  isSidebarOpen: boolean;
  isAiDrawerOpen: boolean;
  direction: TextDirection;
  viewMode: ViewMode;
  theme: Theme;
  aiDrawerWidth: number;
  isAiDrawerMaximized: boolean;

  // Active Navigation Context
  projectId: string;
  activeFilePath: string | null;
  activeHash: string | null;
  previewGroupId: string | null;
  authorizedPaths: string[];

  // Actions
  toggleSidebar: () => void;
  toggleAiDrawer: () => void;
  setDirection: (dir: TextDirection) => void;
  setViewMode: (mode: ViewMode) => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setAiDrawerWidth: (width: number) => void;
  setAiDrawerMaximized: (maximized: boolean) => void;
  toggleAiDrawerMaximized: () => void;
  setProjectId: (id: string) => void;
  setPreviewGroupId: (groupId: string | null) => void;
  setAuthorizedPaths: (paths: string[]) => void;
  navigateToFile: (targetPath: string, hash?: string | null) => boolean;
}

export const useViewerStore = create<ViewerState>()(
  persist(
    (set, get) => ({
      isSidebarOpen: true,
      isAiDrawerOpen: false,
      direction: 'ltr',
      viewMode: 'formatted',
      theme: 'dark',
      aiDrawerWidth: 384,
      isAiDrawerMaximized: false,
      projectId: '',
      activeFilePath: null,
      activeHash: null,
      previewGroupId: null,
      authorizedPaths: [],

      toggleSidebar: () => set((s) => ({ isSidebarOpen: !s.isSidebarOpen })),
      toggleAiDrawer: () => set((s) => ({ isAiDrawerOpen: !s.isAiDrawerOpen })),
      setDirection: (direction) => set({ direction }),
      setViewMode: (viewMode) => set({ viewMode }),
      setTheme: (theme: Theme) => {
        applyThemeToDom(theme);
        set({ theme });
      },
      toggleTheme: () => {
        const next = get().theme === 'dark' ? 'light' : 'dark';
        get().setTheme(next);
      },
      setAiDrawerWidth: (aiDrawerWidth) => set({ aiDrawerWidth }),
      setAiDrawerMaximized: (isAiDrawerMaximized) => set({ isAiDrawerMaximized }),
      toggleAiDrawerMaximized: () =>
        set((s) => ({
          isAiDrawerMaximized: !s.isAiDrawerMaximized,
          aiDrawerWidth: s.isAiDrawerMaximized && s.aiDrawerWidth > 900 ? 384 : s.aiDrawerWidth,
        })),
      setProjectId: (projectId) => set({ projectId }),
      setPreviewGroupId: (previewGroupId) => set({ previewGroupId }),
      setAuthorizedPaths: (paths) => set({ authorizedPaths: paths }),

      navigateToFile: (targetPath, hash = null) => {
        const normalized = targetPath.replace(/^\/+/, '');
        const { authorizedPaths, isAiDrawerMaximized } = get();

        // Client-side ACL gate check before switching view
        if (authorizedPaths.length > 0 && !authorizedPaths.includes(normalized)) {
          window.dispatchEvent(
            new CustomEvent('portal:toast', {
              detail: {
                type: 'warning',
                message: `Access restricted: "${normalized}" is outside your viewer group scope.`,
              },
            })
          );
          return false;
        }

        // If the assistant was taking the full workarea, un-maximize so the viewport is visible
        if (isAiDrawerMaximized) {
          set({ isAiDrawerMaximized: false });
        }

        set({ activeFilePath: normalized, activeHash: hash });

        // Update URL query state without full page reload
        try {
          const url = new URL(window.location.href);
          url.searchParams.set('path', normalized);
          if (hash) {
            url.hash = hash;
          } else {
            url.hash = '';
          }
          window.history.pushState(null, '', url.toString());
        } catch {
          // ignore in non-browser environments
        }

        return true;
      },
    }),
    {
      name: 'gitportal-viewer-prefs',
      partialize: (state) => ({
        isSidebarOpen: state.isSidebarOpen,
        direction: state.direction,
        viewMode: state.viewMode,
        aiDrawerWidth: state.aiDrawerWidth,
        isAiDrawerMaximized: state.isAiDrawerMaximized,
        theme: state.theme,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.theme) {
          applyThemeToDom(state.theme);
        }
      },
    }
  )
);
