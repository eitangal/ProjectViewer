import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type TextDirection = 'ltr' | 'rtl';
export type ViewMode = 'formatted' | 'raw';

interface ViewerState {
  // Layout & UI Toggles
  isSidebarOpen: boolean;
  isAiDrawerOpen: boolean;
  direction: TextDirection;
  viewMode: ViewMode;

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
      projectId: '',
      activeFilePath: null,
      activeHash: null,
      previewGroupId: null,
      authorizedPaths: [],

      toggleSidebar: () => set((s) => ({ isSidebarOpen: !s.isSidebarOpen })),
      toggleAiDrawer: () => set((s) => ({ isAiDrawerOpen: !s.isAiDrawerOpen })),
      setDirection: (direction) => set({ direction }),
      setViewMode: (viewMode) => set({ viewMode }),
      setProjectId: (projectId) => set({ projectId }),
      setPreviewGroupId: (previewGroupId) => set({ previewGroupId }),
      setAuthorizedPaths: (paths) => set({ authorizedPaths: paths }),

      navigateToFile: (targetPath, hash = null) => {
        const normalized = targetPath.replace(/^\/+/, '');
        const { authorizedPaths } = get();

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
      }),
    }
  )
);
