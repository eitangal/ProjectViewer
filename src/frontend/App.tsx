import React, { useState, useEffect, useCallback } from 'react';
import { useQuery, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useViewerStore } from './store/useViewerStore.js';
import { LoginView } from './components/auth/LoginView.js';
import { SysAdminConsole } from './components/admin/SysAdminConsole.js';
import { PublisherConsoleLayout } from './components/publisher/PublisherConsoleLayout.js';
import { ViewerWorkspaceLayout } from './components/viewer/ViewerWorkspaceLayout.js';
import { CollapsibleFileSidebar } from './components/viewer/CollapsibleFileSidebar.js';
import { DocumentViewport } from './components/viewer/DocumentViewport.js';
import { RagAssistantDrawer } from './components/viewer/RagAssistantDrawer.js';
import { ProjectSummary, ViewerGroupSummary, ViewerMembershipSummary } from '@/shared/types.js';
import { Loader2 } from 'lucide-react';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 30000,
    },
  },
});

export function MainApp() {
  const [user, setUser] = useState<any>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [currentView, setCurrentView] = useState<'login' | 'admin' | 'publisher' | 'viewer'>('login');

  // Viewer State from store
  const {
    projectId,
    setProjectId,
    activeFilePath,
    previewGroupId,
    setPreviewGroupId,
    setAuthorizedPaths,
    navigateToFile,
  } = useViewerStore();

  // Check auth session on load
  const checkAuth = useCallback(async () => {
    setIsAuthLoading(true);
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        if (data.user.role === 'SYSADMIN') {
          setCurrentView('admin');
        } else if (data.user.role === 'PUBLISHER') {
          setCurrentView('publisher');
        } else {
          setCurrentView('viewer');
        }
      } else {
        setUser(null);
        setCurrentView('login');
      }
    } catch {
      setUser(null);
      setCurrentView('login');
    } finally {
      setIsAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // Read URL query params on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialPath = params.get('path');
    const initialGroupId = params.get('previewGroupId');
    if (initialGroupId) {
      setPreviewGroupId(initialGroupId);
    }
    if (initialPath) {
      navigateToFile(initialPath, window.location.hash.replace('#', '') || null);
    }
  }, [navigateToFile, setPreviewGroupId]);

  // Publisher data queries
  const { data: projectsData, refetch: refetchProjects } = useQuery<{ projects: ProjectSummary[] }>({
    queryKey: ['publisher-projects'],
    queryFn: () => fetch('/api/projects').then((r) => r.json()),
    enabled: currentView === 'publisher' || currentView === 'admin',
  });

  const projects = projectsData?.projects || [];
  const activeProject = projects.find((p) => p.id === projectId) || projects[0] || null;

  useEffect(() => {
    if (activeProject && !projectId) {
      setProjectId(activeProject.id);
    }
  }, [activeProject, projectId, setProjectId]);

  const { data: groupsData, refetch: refetchGroups } = useQuery<{ groups: ViewerGroupSummary[] }>({
    queryKey: ['project-groups', activeProject?.id],
    queryFn: () => fetch(`/api/projects/${activeProject?.id}/groups`).then((r) => r.json()),
    enabled: !!activeProject?.id && (currentView === 'publisher' || currentView === 'admin'),
  });

  const { data: viewersData, refetch: refetchViewers } = useQuery<{ viewers: ViewerMembershipSummary[] }>({
    queryKey: ['project-viewers', activeProject?.id],
    queryFn: () => fetch(`/api/projects/${activeProject?.id}/viewers`).then((r) => r.json()),
    enabled: !!activeProject?.id && currentView === 'publisher',
  });

  const { data: syncLogsData, refetch: refetchSyncLogs } = useQuery<{ logs: any[] }>({
    queryKey: ['sync-logs', activeProject?.id],
    queryFn: () => fetch(`/api/projects/${activeProject?.id}/sync-logs`).then((r) => r.json()),
    enabled: !!activeProject?.id && currentView === 'publisher',
  });

  // SysAdmin queries
  const { data: publishersData, refetch: refetchPublishers } = useQuery({
    queryKey: ['admin-publishers'],
    queryFn: () => fetch('/api/admin/publishers').then((r) => r.json()),
    enabled: currentView === 'admin',
  });

  const { data: telemetryData, refetch: refetchTelemetry } = useQuery({
    queryKey: ['admin-telemetry'],
    queryFn: () => fetch('/api/admin/telemetry').then((r) => r.json()),
    enabled: currentView === 'admin',
  });

  // Viewer file tree query
  const targetProjectId = projectId || activeProject?.id;
  const viewerTreeUrl = targetProjectId
    ? `/api/viewer/${targetProjectId}/tree${previewGroupId ? `?previewGroupId=${previewGroupId}` : ''}`
    : null;

  const { data: treeData, isLoading: isTreeLoading, refetch: refetchTree } = useQuery({
    queryKey: ['viewer-tree', targetProjectId, previewGroupId],
    queryFn: () => fetch(viewerTreeUrl!).then((r) => r.json()),
    enabled: !!viewerTreeUrl && currentView === 'viewer',
  });

  useEffect(() => {
    if (treeData?.authorizedPaths) {
      setAuthorizedPaths(treeData.authorizedPaths);
      // Auto-select first document if none selected or if previously active file is no longer authorized
      if (
        treeData.authorizedPaths.length > 0 &&
        (!activeFilePath || !treeData.authorizedPaths.includes(activeFilePath))
      ) {
        navigateToFile(treeData.authorizedPaths[0]);
      }
    }
  }, [treeData, activeFilePath, setAuthorizedPaths, navigateToFile]);

  // Viewer active blob query
  const blobUrl =
    targetProjectId && activeFilePath
      ? `/api/viewer/${targetProjectId}/blob?path=${encodeURIComponent(activeFilePath)}${
          previewGroupId ? `&previewGroupId=${previewGroupId}` : ''
        }`
      : null;

  const {
    data: blobData,
    isLoading: isBlobLoading,
    error: blobError,
  } = useQuery({
    queryKey: ['viewer-blob', targetProjectId, activeFilePath, previewGroupId],
    queryFn: async () => {
      const res = await fetch(blobUrl!);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch blob');
      }
      return data;
    },
    enabled: !!blobUrl && currentView === 'viewer',
    retry: false,
  });

  const handleLoginSuccess = useCallback((loggedInUser: any, redirectProj: string | null) => {
    setUser(loggedInUser);
    if (redirectProj) {
      setProjectId(redirectProj);
      setCurrentView('viewer');
    } else if (loggedInUser.globalRole === 'SYSADMIN') {
      setCurrentView('admin');
    } else if (loggedInUser.globalRole === 'PUBLISHER') {
      setCurrentView('publisher');
    } else {
      setCurrentView('viewer');
    }
  }, [setProjectId]);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    setCurrentView('login');
  };

  if (isAuthLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-950 text-slate-500">
        <Loader2 size={32} className="animate-spin text-indigo-500" />
      </div>
    );
  }

  // 1. Unauthenticated Login Screen
  if (currentView === 'login' || !user) {
    return (
      <LoginView onLoginSuccess={handleLoginSuccess} />
    );
  }

  // 2. SysAdmin Governance Console
  if (currentView === 'admin') {
    return (
      <div className="flex flex-col h-screen">
        <div className="bg-rose-950/40 border-b border-rose-900/60 px-4 py-1 text-xs text-rose-300 flex items-center justify-between">
          <span>SysAdmin Session ({user.email})</span>
          <div className="flex gap-2">
            <button
              onClick={() => setCurrentView('publisher')}
              className="text-indigo-400 hover:underline"
            >
              Switch to Publisher View
            </button>
            <span>•</span>
            <button
              onClick={() => setCurrentView('viewer')}
              className="text-indigo-400 hover:underline"
            >
              Switch to Viewer View
            </button>
          </div>
        </div>
        <SysAdminConsole
          publishers={publishersData?.publishers || []}
          telemetry={telemetryData}
          onInvitePublisher={async (data) => {
            const res = await fetch('/api/admin/invite-publisher', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error);
            refetchPublishers();
            refetchTelemetry();
            return json;
          }}
          onUpdatePublisher={async (userId, data) => {
            await fetch(`/api/admin/publishers/${userId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data),
            });
            refetchPublishers();
          }}
          onRefreshTelemetry={async () => {
            refetchTelemetry();
            refetchPublishers();
          }}
          onLogout={handleLogout}
        />
      </div>
    );
  }

  // 3. Publisher Console
  if (currentView === 'publisher') {
    return (
      <PublisherConsoleLayout
        projects={projects}
        activeProject={activeProject}
        groups={groupsData?.groups || []}
        viewers={viewersData?.viewers || []}
        syncLogs={syncLogsData?.logs || []}
        onSelectProject={(id) => setProjectId(id)}
        onCreateProject={async (data) => {
          const res = await fetch('/api/projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error);
          await refetchProjects();
          setProjectId(json.projectId);
        }}
        onTriggerSync={async (opts) => {
          if (!activeProject) return;
          const res = await fetch(`/api/projects/${activeProject.id}/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(opts || {}),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error);
          refetchProjects();
          refetchSyncLogs();
        }}
        onUpdateProject={async (data) => {
          if (!activeProject) return;
          await fetch(`/api/projects/${activeProject.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          });
          refetchProjects();
        }}
        onSaveGroup={async (group) => {
          if (!activeProject) return;
          const targetGroupId = (group as any).id || groupsData?.groups?.[0]?.id;
          if (targetGroupId) {
            await fetch(`/api/projects/${activeProject.id}/groups/${targetGroupId}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(group),
            });
          } else {
            await fetch(`/api/projects/${activeProject.id}/groups`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: 'Default', ...group }),
            });
          }
          await refetchGroups();
          queryClient.invalidateQueries({ queryKey: ['viewer-tree'] });
          queryClient.invalidateQueries({ queryKey: ['viewer-blob'] });
        }}
        onInviteViewer={async (email, groupIds) => {
          if (!activeProject) return;
          const res = await fetch(`/api/projects/${activeProject.id}/invite-viewer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, groupIds }),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error);
          refetchViewers();
          return json;
        }}
        onBulkInvite={async (entries) => {
          if (!activeProject) return;
          const res = await fetch(`/api/projects/${activeProject.id}/invite-viewers-bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entries }),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error);
          refetchViewers();
          return json;
        }}
        onRevokeViewer={async (viewerId) => {
          if (!activeProject) return;
          await fetch(`/api/projects/${activeProject.id}/viewers/${viewerId}`, {
            method: 'DELETE',
          });
          refetchViewers();
        }}
        onSaveAiConfig={async (data) => {
          if (!activeProject) return;
          const res = await fetch(`/api/projects/${activeProject.id}/ai/config`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          });
          if (!res.ok) throw new Error((await res.json()).error);
          refetchProjects();
        }}
        onTestKey={async (apiKey) => {
          if (!activeProject) return false;
          const res = await fetch(`/api/projects/${activeProject.id}/ai/test-key`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey }),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error);
          return true;
        }}
        onOpenViewer={(pId, pGroupId) => {
          setProjectId(pId);
          setPreviewGroupId(pGroupId || null);
          queryClient.invalidateQueries({ queryKey: ['viewer-tree'] });
          queryClient.invalidateQueries({ queryKey: ['viewer-blob'] });
          setCurrentView('viewer');
        }}
        onLogout={handleLogout}
      />
    );
  }

  // 4. Viewer Workspace UI
  return (
    <div className="flex flex-col h-screen">
      {/* Publisher Banner if viewing in preview / owner mode */}
      {treeData?.isPublisher && (
        <div className="bg-indigo-950/80 border-b border-indigo-800/80 px-4 py-1.5 text-xs text-indigo-200 flex items-center justify-between z-40">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-indigo-300">
              {previewGroupId ? 'Preview Mode:' : 'Publisher Preview:'}
            </span>
            <div className="flex items-center gap-1.5 bg-slate-950/80 px-2 py-0.5 rounded-lg border border-indigo-700/50">
              <span className="text-[11px] text-slate-400">View Authorization:</span>
              <select
                value={previewGroupId || ''}
                onChange={(e) => {
                  const newGid = e.target.value || null;
                  setPreviewGroupId(newGid);
                  queryClient.invalidateQueries({ queryKey: ['viewer-tree'] });
                  queryClient.invalidateQueries({ queryKey: ['viewer-blob'] });
                }}
                className="bg-transparent border-0 text-xs text-indigo-200 font-medium focus:outline-none cursor-pointer"
              >
                <option value="" className="bg-slate-900 text-slate-100">Full Publisher View (All Files)</option>
                {groupsData?.groups?.map((g) => (
                  <option key={g.id} value={g.id} className="bg-slate-900 text-slate-100">
                    Group: {g.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button
            onClick={() => setCurrentView('publisher')}
            className="px-2.5 py-0.5 rounded bg-indigo-800 hover:bg-indigo-700 text-white font-medium transition-colors"
          >
            Back to Publisher Console
          </button>
        </div>
      )}

      <ViewerWorkspaceLayout
        projectName={treeData?.projectName || activeProject?.name || 'Project Portal'}
        isAiEnabled={treeData?.aiEnabled ?? false}
      >
        <CollapsibleFileSidebar
          tree={treeData?.tree || []}
          isLoading={isTreeLoading}
        />
        <DocumentViewport
          content={blobData?.content ?? null}
          isLoading={isBlobLoading}
          isRestricted={blobError ? (blobError as any).message?.includes('Access restricted') : false}
          errorMessage={blobError ? (blobError as any).message : null}
          projectId={targetProjectId}
        />
        {targetProjectId && <RagAssistantDrawer projectId={targetProjectId} />}
      </ViewerWorkspaceLayout>
    </div>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <MainApp />
    </QueryClientProvider>
  );
}

export default App;
