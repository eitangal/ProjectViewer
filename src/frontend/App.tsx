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

export type ActiveMainView =
  | 'viewer'
  | 'admin-overview'
  | 'admin-smtp'
  | 'publisher-sync'
  | 'publisher-acl'
  | 'publisher-viewers'
  | 'publisher-ai';

export function MainApp() {
  const [user, setUser] = useState<any>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [activeMainView, setActiveMainView] = useState<ActiveMainView>('viewer');

  // Modals controlled from unified sidebar
  const [showCreateProjectModal, setShowCreateProjectModal] = useState(false);
  const [showDeleteProjectModal, setShowDeleteProjectModal] = useState(false);
  const [showInvitePublisherModal, setShowInvitePublisherModal] = useState(false);
  const [isBrevoConfigured, setIsBrevoConfigured] = useState(true);

  // Viewer State from store
  const {
    projectId,
    setProjectId,
    activeFilePath,
    previewGroupId,
    setPreviewGroupId,
    setAuthorizedPaths,
    navigateToFile,
    resetSessionState,
  } = useViewerStore();

  const isSysAdmin = user?.globalRole === 'SYSADMIN' || user?.role === 'SYSADMIN';

  // Check auth session on load
  const checkAuth = useCallback(async () => {
    setIsAuthLoading(true);
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        const params = new URLSearchParams(window.location.search);
        const hasPath = params.get('path');
        if (hasPath) {
          setActiveMainView('viewer');
        } else if (data.user.role === 'SYSADMIN' || data.user.globalRole === 'SYSADMIN') {
          setActiveMainView('admin-overview');
        } else if (data.user.role === 'PUBLISHER' || data.user.globalRole === 'PUBLISHER') {
          setActiveMainView('publisher-sync');
        } else {
          setActiveMainView('viewer');
        }
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setIsAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // Check Brevo status if admin
  useEffect(() => {
    if (isSysAdmin) {
      fetch('/api/admin/email')
        .then((r) => r.json())
        .then((data) => {
          setIsBrevoConfigured(!!data.isConfigured);
        })
        .catch(() => {});
    }
  }, [isSysAdmin]);

  // Read URL deep link query params ONLY after authentication is verified (M-1)
  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    const initialProjectId = params.get('projectId');
    const initialPath = params.get('path');
    const initialGroupId = params.get('previewGroupId');
    if (initialProjectId) {
      setProjectId(initialProjectId);
    }
    if (initialGroupId) {
      setPreviewGroupId(initialGroupId);
    }
    if (initialPath && !initialPath.startsWith('//') && !initialPath.includes('://')) {
      navigateToFile(initialPath, window.location.hash.replace('#', '') || null);
      setActiveMainView('viewer');
    }
  }, [user, navigateToFile, setPreviewGroupId, setProjectId]);

  // Projects query for all authenticated users (fetches both published and viewer projects)
  const { data: projectsData, refetch: refetchProjects } = useQuery<{ projects: ProjectSummary[] }>({
    queryKey: ['portal-projects'],
    queryFn: () => fetch('/api/projects').then((r) => r.json()),
    enabled: !!user,
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
    enabled: !!activeProject?.id && !!user && (activeProject?.userRole === 'PUBLISHER' || isSysAdmin),
  });

  const { data: viewersData, refetch: refetchViewers } = useQuery<{ viewers: ViewerMembershipSummary[] }>({
    queryKey: ['project-viewers', activeProject?.id],
    queryFn: () => fetch(`/api/projects/${activeProject?.id}/viewers`).then((r) => r.json()),
    enabled: !!activeProject?.id && !!user && (activeProject?.userRole === 'PUBLISHER' || isSysAdmin),
  });

  const { data: syncLogsData, refetch: refetchSyncLogs } = useQuery<{ logs: any[] }>({
    queryKey: ['sync-logs', activeProject?.id],
    queryFn: () => fetch(`/api/projects/${activeProject?.id}/sync-logs`).then((r) => r.json()),
    enabled: !!activeProject?.id && !!user && (activeProject?.userRole === 'PUBLISHER' || isSysAdmin),
  });

  // SysAdmin queries
  const { data: publishersData, refetch: refetchPublishers } = useQuery({
    queryKey: ['admin-publishers'],
    queryFn: () => fetch('/api/admin/publishers').then((r) => r.json()),
    enabled: isSysAdmin,
  });

  const { data: telemetryData, refetch: refetchTelemetry } = useQuery({
    queryKey: ['admin-telemetry'],
    queryFn: () => fetch('/api/admin/telemetry').then((r) => r.json()),
    enabled: isSysAdmin,
  });

  // Viewer file tree query - loaded for all authenticated users whenever active project exists
  const targetProjectId = projectId || activeProject?.id;
  const viewerTreeUrl = targetProjectId
    ? `/api/viewer/${targetProjectId}/tree${previewGroupId ? `?previewGroupId=${previewGroupId}` : ''}`
    : null;

  const { data: treeData, isLoading: isTreeLoading } = useQuery({
    queryKey: ['viewer-tree', targetProjectId, previewGroupId],
    queryFn: () => fetch(viewerTreeUrl!).then((r) => r.json()),
    enabled: !!viewerTreeUrl && !!user,
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
    enabled: !!blobUrl && !!user,
    retry: false,
  });

  const handleLoginSuccess = useCallback((loggedInUser: any, redirectProj: string | null) => {
    setUser(loggedInUser);
    if (redirectProj) {
      setProjectId(redirectProj);
      setActiveMainView('viewer');
    } else if (loggedInUser.globalRole === 'SYSADMIN' || loggedInUser.role === 'SYSADMIN') {
      setActiveMainView('admin-overview');
    } else if (loggedInUser.globalRole === 'PUBLISHER' || loggedInUser.role === 'PUBLISHER') {
      setActiveMainView('publisher-sync');
    } else {
      setActiveMainView('viewer');
    }
  }, [setProjectId]);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    resetSessionState();
    queryClient.clear();
    setUser(null);
  };

  if (isAuthLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-950 text-slate-500">
        <Loader2 size={32} className="animate-spin text-indigo-500" />
      </div>
    );
  }

  // 1. Unauthenticated Login Screen
  if (!user) {
    return (
      <LoginView onLoginSuccess={handleLoginSuccess} />
    );
  }

  // 2. Unified Application Shell for all Authenticated Users
  return (
    <ViewerWorkspaceLayout
      projectName={activeProject?.name || treeData?.projectName || 'Project Portal'}
      projectRole={activeProject?.userRole}
      isAiEnabled={treeData?.aiEnabled ?? (activeProject?.hasGeminiKey ?? false)}
      user={user}
      onLogout={handleLogout}
    >
      <CollapsibleFileSidebar
        user={user}
        projects={projects}
        activeProject={activeProject}
        onSelectProject={(id) => {
          setProjectId(id);
          queryClient.invalidateQueries({ queryKey: ['viewer-tree'] });
          queryClient.invalidateQueries({ queryKey: ['viewer-blob'] });
        }}
        activeView={activeMainView}
        onSelectView={(v) => setActiveMainView(v as ActiveMainView)}
        onCreateProject={() => {
          setActiveMainView('publisher-sync');
          setShowCreateProjectModal(true);
        }}
        onDeleteProject={() => {
          setActiveMainView('publisher-sync');
          setShowDeleteProjectModal(true);
        }}
        onInvitePublisher={() => {
          setActiveMainView('admin-overview');
          setShowInvitePublisherModal(true);
        }}
        isBrevoConfigured={isBrevoConfigured}
        tree={treeData?.tree || []}
        isLoading={isTreeLoading}
        isPublisher={activeProject?.userRole === 'PUBLISHER' || isSysAdmin}
        previewGroupId={previewGroupId}
        onPreviewGroupChange={(newGid) => {
          setPreviewGroupId(newGid);
          queryClient.invalidateQueries({ queryKey: ['viewer-tree'] });
          queryClient.invalidateQueries({ queryKey: ['viewer-blob'] });
        }}
        groups={groupsData?.groups || []}
        isSysAdmin={isSysAdmin}
      />

      {/* Main Canvas: Document Viewport vs Admin Console vs Publisher Console */}
      {activeMainView === 'viewer' && (
        <DocumentViewport
          content={blobData?.content ?? null}
          isLoading={isBlobLoading}
          isRestricted={blobError ? (blobError as any).message?.includes('Access restricted') : false}
          errorMessage={blobError ? (blobError as any).message : null}
          projectId={targetProjectId}
        />
      )}

      {activeMainView.startsWith('admin-') && (
        <SysAdminConsole
          embedded={true}
          tab={activeMainView === 'admin-smtp' ? 'smtp' : 'overview'}
          showInviteModalControlled={showInvitePublisherModal}
          onOpenInviteModal={() => setShowInvitePublisherModal(true)}
          onCloseInviteModal={() => setShowInvitePublisherModal(false)}
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
          user={user}
          activeProjectId={targetProjectId}
        />
      )}

      {activeMainView.startsWith('publisher-') && (
        <PublisherConsoleLayout
          embedded={true}
          tab={activeMainView.replace('publisher-', '') as any}
          showCreateModalControlled={showCreateProjectModal}
          onOpenCreateModal={() => setShowCreateProjectModal(true)}
          onCloseCreateModal={() => setShowCreateProjectModal(false)}
          showDeleteModalControlled={showDeleteProjectModal}
          onOpenDeleteModal={() => setShowDeleteProjectModal(true)}
          onCloseDeleteModal={() => setShowDeleteProjectModal(false)}
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
          onDeleteProject={async (id: string) => {
            const res = await fetch(`/api/projects/${id}`, {
              method: 'DELETE',
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json.error || 'Failed to delete project');
            const updated = await refetchProjects();
            const remaining = updated.data?.projects || [];
            if (id === projectId || id === activeProject?.id) {
              setProjectId(remaining[0]?.id || '');
            }
            queryClient.invalidateQueries({ queryKey: ['project-groups'] });
            queryClient.invalidateQueries({ queryKey: ['project-viewers'] });
            queryClient.invalidateQueries({ queryKey: ['sync-logs'] });
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
          onLogout={handleLogout}
          user={user}
        />
      )}

      {targetProjectId && <RagAssistantDrawer projectId={targetProjectId} />}
    </ViewerWorkspaceLayout>
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
