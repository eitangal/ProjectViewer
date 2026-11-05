import React, { useState, useEffect } from 'react';
import {
  Menu,
  GitPullRequest,
  ShieldCheck,
  Users,
  Sparkles,
  Eye,
  Plus,
  Trash2,
  FolderGit2,
  Activity,
  Layers,
  ChevronRight,
  ExternalLink,
  HardDrive,
  CheckCircle2,
  FolderSync,
  Globe,
  FolderCheck,
  Search,
} from 'lucide-react';
import { ProjectSummary, ViewerGroupSummary, ViewerMembershipSummary } from '@/shared/types.js';
import { SyncAndRepoTab } from './SyncAndRepoTab.js';
import { AclRuleBuilderWorkspace } from './AclRuleBuilderWorkspace.js';
import { ViewerInvitationsTab } from './ViewerInvitationsTab.js';
import { AiSettingsTab } from './AiSettingsTab.js';
import { ThemeAndUserControls } from '../common/ThemeAndUserControls.js';
import { useViewerStore } from '../../store/useViewerStore.js';
import { RagAssistantDrawer } from '../viewer/RagAssistantDrawer.js';

export const PublisherConsoleLayout: React.FC<{
  projects: ProjectSummary[];
  activeProject: ProjectSummary | null;
  groups: ViewerGroupSummary[];
  viewers: ViewerMembershipSummary[];
  syncLogs: any[];
  onSelectProject: (id: string) => void;
  onCreateProject: (data: { name: string; repoUrl: string; branch?: string }) => Promise<void>;
  onDeleteProject?: (id: string) => Promise<void>;
  onTriggerSync: (opts?: { forceReindex?: boolean }) => Promise<void>;
  onUpdateProject: (data: Partial<ProjectSummary>) => Promise<void>;
  onSaveGroup: (group: Partial<ViewerGroupSummary>) => Promise<void>;
  onInviteViewer: (email: string, groupIds: string[]) => Promise<any>;
  onBulkInvite: (entries: { email: string; groupIds: string[] }[]) => Promise<void>;
  onRevokeViewer: (userId: string) => Promise<void>;
  onSaveAiConfig: (data: any) => Promise<void>;
  onTestKey: (apiKey: string) => Promise<boolean>;
  onOpenViewer?: (projectId: string, previewGroupId?: string | null) => void;
  onLogout?: () => void;
  user?: { email: string; role?: string; globalRole?: string } | null;
  onSwitchView?: (view: 'admin' | 'publisher' | 'viewer') => void;
  embedded?: boolean;
  tab?: 'sync' | 'acl' | 'viewers' | 'ai';
  showCreateModalControlled?: boolean;
  onOpenCreateModal?: () => void;
  onCloseCreateModal?: () => void;
  showDeleteModalControlled?: boolean;
  onOpenDeleteModal?: () => void;
  onCloseDeleteModal?: () => void;
}> = ({
  projects,
  activeProject,
  groups,
  viewers,
  syncLogs,
  onSelectProject,
  onCreateProject,
  onDeleteProject,
  onTriggerSync,
  onUpdateProject,
  onSaveGroup,
  onInviteViewer,
  onBulkInvite,
  onRevokeViewer,
  onSaveAiConfig,
  onTestKey,
  onOpenViewer,
  onLogout,
  user,
  onSwitchView,
  embedded = false,
  tab,
  showCreateModalControlled,
  onOpenCreateModal,
  onCloseCreateModal,
  showDeleteModalControlled,
  onOpenDeleteModal,
  onCloseDeleteModal,
}) => {
  const {
    isSidebarOpen,
    toggleSidebar,
    isAiDrawerOpen,
    toggleAiDrawer,
  } = useViewerStore();

  const [internalActiveTab, setInternalActiveTab] = useState<'sync' | 'acl' | 'viewers' | 'ai'>('sync');
  const activeTab = tab || internalActiveTab;
  const setActiveTab = setInternalActiveTab;

  const [selectedPreviewGroupId, setSelectedPreviewGroupId] = useState<string>('');
  const [internalShowCreateModal, setInternalShowCreateModal] = useState(false);
  const [internalShowDeleteModal, setInternalShowDeleteModal] = useState(false);

  useEffect(() => {
    if (showCreateModalControlled !== undefined) {
      setInternalShowCreateModal(showCreateModalControlled);
    }
  }, [showCreateModalControlled]);

  useEffect(() => {
    if (showDeleteModalControlled !== undefined) {
      setInternalShowDeleteModal(showDeleteModalControlled);
    }
  }, [showDeleteModalControlled]);

  const showCreateModal = Boolean(showCreateModalControlled || internalShowCreateModal);
  const setShowCreateModal = (val: boolean) => {
    setInternalShowCreateModal(val);
    if (val && onOpenCreateModal) onOpenCreateModal();
    if (!val && onCloseCreateModal) onCloseCreateModal();
  };

  const showDeleteModal = Boolean(showDeleteModalControlled || internalShowDeleteModal);
  const setShowDeleteModal = (val: boolean) => {
    setInternalShowDeleteModal(val);
    if (val && onOpenDeleteModal) onOpenDeleteModal();
    if (!val && onCloseDeleteModal) onCloseDeleteModal();
  };
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const isSysAdmin = user?.role === 'SYSADMIN' || user?.globalRole === 'SYSADMIN';

  // Project Creation State
  const [createMode, setCreateMode] = useState<'remote' | 'local'>('remote');
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectRepoUrl, setNewProjectRepoUrl] = useState('');
  const [newProjectBranch, setNewProjectBranch] = useState('main');
  const [localSourcePath, setLocalSourcePath] = useState('');
  const [additionalCopyPath, setAdditionalCopyPath] = useState('');
  const [copyMode, setCopyMode] = useState<'WORKING_TREE' | 'FULL_REPO'>('WORKING_TREE');
  const [autoCopyOnSync, setAutoCopyOnSync] = useState(true);
  const [isInspecting, setIsInspecting] = useState(false);
  const [inspectionResult, setInspectionResult] = useState<any>(null);
  const [inspectionError, setInspectionError] = useState<string | null>(null);
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false);

  const handleInspectLocal = async () => {
    if (!localSourcePath.trim()) return;
    setIsInspecting(true);
    setInspectionError(null);
    setInspectionResult(null);
    try {
      const res = await fetch('/api/admin/local-repos/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: localSourcePath.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.isValid) {
        setInspectionError(data.error || 'Invalid local Git repository');
      } else {
        setInspectionResult(data);
        if (!newProjectName) setNewProjectName(data.suggestedName);
        if (data.currentBranch) setNewProjectBranch(data.currentBranch);
      }
    } catch (err: any) {
      setInspectionError(err.message || 'Inspection failed');
    } finally {
      setIsInspecting(false);
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingCreate(true);
    try {
      if (createMode === 'local' && isSysAdmin) {
        if (!newProjectName.trim() || !localSourcePath.trim()) return;
        const res = await fetch('/api/admin/local-repos/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: newProjectName.trim(),
            localPath: localSourcePath.trim(),
            branch: newProjectBranch.trim() || 'main',
            additionalCopyPath: additionalCopyPath.trim() || undefined,
            copyMode,
            autoCopyOnSync,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to publish local project');
        setShowCreateModal(false);
        setNewProjectName('');
        setLocalSourcePath('');
        setAdditionalCopyPath('');
        setInspectionResult(null);
        if (onSelectProject && data.projectId) {
          onSelectProject(data.projectId);
        }
        window.location.reload();
      } else {
        if (!newProjectName.trim() || !newProjectRepoUrl.trim()) return;
        await onCreateProject({
          name: newProjectName.trim(),
          repoUrl: newProjectRepoUrl.trim(),
          branch: newProjectBranch.trim() || 'main',
        });
        setShowCreateModal(false);
        setNewProjectName('');
        setNewProjectRepoUrl('');
        setNewProjectBranch('main');
      }
    } catch (err: any) {
      alert(`Error creating project: ${err.message || 'Unknown error'}`);
    } finally {
      setIsSubmittingCreate(false);
    }
  };

  const handleDeleteSubmit = async () => {
    if (!activeProject || !onDeleteProject) return;
    try {
      setIsDeleting(true);
      setDeleteError(null);
      await onDeleteProject(activeProject.id);
      setShowDeleteModal(false);
    } catch (err: any) {
      setDeleteError(err.message || 'Failed to delete project');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div
      dir="ltr"
      className={
        embedded
          ? 'flex flex-1 overflow-hidden relative'
          : 'flex flex-col h-screen w-screen overflow-hidden bg-slate-950 text-slate-100'
      }
    >
      {/* Unified Top Header (h-14) */}
      {!embedded && (
        <header className="h-14 border-b border-slate-800 bg-slate-900/90 backdrop-blur-md flex items-center justify-between px-4 shrink-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={toggleSidebar}
              aria-label="Toggle Publisher Navigation"
              title="Toggle Navigation Menu"
              className={`p-2 rounded-xl transition-colors ${
                isSidebarOpen ? 'bg-slate-800 text-slate-100 font-medium' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <Menu size={18} />
            </button>

            <div className="flex items-center gap-2 text-indigo-400 font-semibold text-sm tracking-wide shrink-0">
              <FolderGit2 size={18} />
              <span className="hidden sm:inline">Publisher Console</span>
            </div>
          </div>

          {/* Right Action Controls */}
          <div className="flex items-center gap-2 md:gap-2.5 shrink-0">
            {/* AI Chat Assistant Drawer Toggle */}
            <button
              type="button"
              onClick={toggleAiDrawer}
              title={isAiDrawerOpen ? 'Close AI Assistant' : 'Open AI Assistant to test RAG answers'}
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

            <div className="h-4 w-px bg-slate-800 mx-0.5 hidden sm:block" />

            {/* Theme, User Controls & Logout */}
            <ThemeAndUserControls
              user={user}
              onLogout={onLogout}
              showUser={true}
              showTheme={true}
              showLogout={true}
            />
          </div>
        </header>
      )}

      {/* Main Container */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Left Collapsible Navigation Menu Sidebar (w-72) */}
        {!embedded && isSidebarOpen && (
          <aside className="w-72 border-e border-slate-800 bg-slate-950 flex flex-col shrink-0 overflow-hidden h-full z-20">
            {/* Active Project Section in Menu */}
            <div className="p-3 border-b border-slate-800/80 bg-slate-900/50 flex flex-col gap-2.5 shrink-0">
              {/* Header row: Label + Action buttons (New & Delete) */}
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Active Project
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(true)}
                    title="Create New Project"
                    aria-label="Create New Project"
                    className="flex items-center gap-1 px-2 py-0.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-[11px] font-medium transition-colors shadow-xs"
                  >
                    <Plus size={12} />
                    <span>New</span>
                  </button>
                  {activeProject && onDeleteProject && (
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteError(null);
                        setShowDeleteModal(true);
                      }}
                      title={`Delete project "${activeProject.name}"`}
                      aria-label="Delete Active Project"
                      className="p-1 text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 border border-transparent hover:border-rose-900/50 rounded-lg transition-colors"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>

              {/* Project Selection Dropdown */}
              <div className="flex flex-col gap-1">
                <select
                  aria-label="Select Active Project"
                  value={activeProject?.id || ''}
                  onChange={(e) => onSelectProject(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 font-medium focus:outline-none focus:border-indigo-500 cursor-pointer"
                >
                  {projects.length === 0 ? (
                    <option value="" disabled>No projects available</option>
                  ) : (
                    projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.branch})
                      </option>
                    ))
                  )}
                </select>

                {activeProject && (
                  <div className="flex items-center justify-between text-[10px] text-slate-500 px-0.5">
                    <span className="truncate">Branch: <span className="font-mono text-slate-400">{activeProject.branch}</span></span>
                    {activeProject.lastSyncedSha && (
                      <span className="font-mono text-slate-400">{activeProject.lastSyncedSha.slice(0, 7)}</span>
                    )}
                  </div>
                )}
              </div>

              {/* View Group Selection & Launch in Active Project Menu */}
              {activeProject && (
                <div className="flex flex-col gap-1.5 pt-2 border-t border-slate-800/60">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span className="flex items-center gap-1 font-medium">
                      <Eye size={12} className="text-indigo-400" />
                      <span>View Group:</span>
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {selectedPreviewGroupId ? 'Filtered' : 'Full View'}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <select
                      aria-label="Select View Group"
                      value={selectedPreviewGroupId}
                      onChange={(e) => setSelectedPreviewGroupId(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-xs text-indigo-200 focus:outline-none focus:border-indigo-500 truncate cursor-pointer"
                    >
                      <option value="">Full View (All Files)</option>
                      {groups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>

            {/* Menu Items */}
            <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
              <button
                type="button"
                onClick={() => setActiveTab('sync')}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors w-full text-start ${
                  activeTab === 'sync'
                    ? 'bg-indigo-600/20 text-indigo-300 border-s-2 border-indigo-500'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <GitPullRequest size={15} className="shrink-0" />
                <span className="flex-1">Repository & Sync</span>
                <ChevronRight size={13} className="text-slate-600" />
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('acl')}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors w-full text-start ${
                  activeTab === 'acl'
                    ? 'bg-indigo-600/20 text-indigo-300 border-s-2 border-indigo-500'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <ShieldCheck size={15} className="shrink-0" />
                <span className="flex-1">Viewer Groups & ACL</span>
                <ChevronRight size={13} className="text-slate-600" />
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('viewers')}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors w-full text-start ${
                  activeTab === 'viewers'
                    ? 'bg-indigo-600/20 text-indigo-300 border-s-2 border-indigo-500'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <Users size={15} className="shrink-0" />
                <span className="flex-1">Viewer Invites & Access</span>
                <ChevronRight size={13} className="text-slate-600" />
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('ai')}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors w-full text-start ${
                  activeTab === 'ai'
                    ? 'bg-indigo-600/20 text-indigo-300 border-s-2 border-indigo-500'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <Sparkles size={15} className="shrink-0 text-indigo-400" />
                <span className="flex-1">Gemini BYOK & AI</span>
                <ChevronRight size={13} className="text-slate-600" />
              </button>
            </div>

            {/* Sidebar Footer Stats */}
            {activeProject && (
              <div className="p-3 border-t border-slate-800 bg-slate-900/50 flex flex-col gap-1 text-[11px] text-slate-400">
                <div className="flex items-center justify-between">
                  <span>Groups:</span>
                  <span className="font-mono text-slate-200">{groups.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Active Viewers:</span>
                  <span className="font-mono text-slate-200">{viewers.length}</span>
                </div>
              </div>
            )}
          </aside>
        )}

        {/* Central Work Area */}
        <main className="flex-1 overflow-y-auto p-6 bg-slate-950 min-w-0">
          {activeProject ? (
            (() => {
              switch (activeTab) {
                case 'sync':
                  return (
                    <SyncAndRepoTab
                      project={activeProject}
                      syncLogs={syncLogs}
                      onTriggerSync={onTriggerSync}
                      onUpdateProject={onUpdateProject}
                      onDeleteProject={onDeleteProject ? () => { setDeleteError(null); setShowDeleteModal(true); } : undefined}
                    />
                  );
                case 'acl':
                  return (
                    <AclRuleBuilderWorkspace
                      projectId={activeProject.id}
                      activeGroup={
                        groups.find((g) => g.id === selectedPreviewGroupId) ||
                        (groups.length > 0 ? groups[0] : null)
                      }
                      groups={groups}
                      onSelectGroup={(gid) => setSelectedPreviewGroupId(gid)}
                      onSaveGroup={onSaveGroup}
                    />
                  );
                case 'viewers':
                  return (
                    <ViewerInvitationsTab
                      projectId={activeProject.id}
                      groups={groups}
                      viewers={viewers}
                      onInviteViewer={onInviteViewer}
                      onBulkInvite={onBulkInvite}
                      onRevokeViewer={onRevokeViewer}
                    />
                  );
                case 'ai':
                  return (
                    <AiSettingsTab
                      project={activeProject}
                      onSaveAiConfig={onSaveAiConfig}
                      onTestKey={onTestKey}
                    />
                  );
              }
            })()
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-3">
              <FolderGit2 size={36} className="text-slate-700" />
              <p className="text-sm">No project selected. Create your first project to get started.</p>
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-4 py-2 rounded-xl text-xs transition-colors"
              >
                Create Project
              </button>
            </div>
          )}
        </main>

        {/* Right Collapsible AI Chat Assistant Drawer */}
        {!embedded && activeProject && <RagAssistantDrawer projectId={activeProject.id} />}
      </div>

      {/* New Project Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 modal-overlay z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateSubmit}
            className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-lg w-full flex flex-col gap-4 shadow-2xl max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-100">Create New Project</h3>
              {isSysAdmin && (
                <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setCreateMode('remote')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-colors font-medium ${
                      createMode === 'remote'
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Globe size={12} />
                    <span>Remote Git</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreateMode('local')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-colors font-medium ${
                      createMode === 'local'
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <HardDrive size={12} />
                    <span>Local VPS Clone</span>
                  </button>
                </div>
              )}
            </div>

            <p className="text-xs text-slate-400">
              {createMode === 'local'
                ? 'Publish a repository already cloned locally on the VPS disk without requiring any Git network connection.'
                : 'Connect a remote GitHub repository to begin curating fine-grained views.'}
            </p>

            {/* Local VPS Path Input & Inspector */}
            {createMode === 'local' && isSysAdmin ? (
              <div className="flex flex-col gap-3 p-3.5 bg-slate-950/70 border border-slate-800 rounded-xl">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-slate-300 flex items-center justify-between">
                    <span>Local Repository Path on VPS</span>
                    <span className="text-[10px] text-slate-500 font-normal">Absolute path on host</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      required
                      value={localSourcePath}
                      onChange={(e) => {
                        setLocalSourcePath(e.target.value);
                        setInspectionResult(null);
                        setInspectionError(null);
                      }}
                      placeholder="/home/agydev/workspace/govlabs11-pmo"
                      className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                    />
                    <button
                      type="button"
                      disabled={isInspecting || !localSourcePath.trim()}
                      onClick={handleInspectLocal}
                      className="px-3 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 rounded-xl text-xs font-medium transition-colors flex items-center gap-1.5 shrink-0 border border-slate-700"
                    >
                      <Search size={13} className={isInspecting ? 'animate-spin' : ''} />
                      <span>{isInspecting ? 'Inspecting...' : 'Inspect'}</span>
                    </button>
                  </div>
                </div>

                {inspectionResult && (
                  <div className="bg-emerald-950/40 border border-emerald-900/60 rounded-xl p-3 flex flex-col gap-1.5 text-xs text-emerald-200">
                    <div className="flex items-center gap-2 font-medium text-emerald-400">
                      <CheckCircle2 size={14} />
                      <span>Valid Git Repository Detected</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-emerald-300/80 pt-1 border-t border-emerald-900/40">
                      <div>Branch: <strong className="text-emerald-200">{inspectionResult.currentBranch}</strong></div>
                      <div>HEAD: <strong className="text-emerald-200">{inspectionResult.headCommitSha.slice(0, 7)}</strong></div>
                      <div>Files: <strong className="text-emerald-200">{inspectionResult.totalFiles} files</strong></div>
                      <div className="truncate">Msg: <span className="text-slate-300">{inspectionResult.commitMessage || 'No message'}</span></div>
                    </div>
                  </div>
                )}

                {inspectionError && (
                  <div className="bg-rose-950/40 border border-rose-900/50 rounded-xl p-2.5 text-xs text-rose-300">
                    {inspectionError}
                  </div>
                )}

                {/* Additional Copy Location Option */}
                <div className="flex flex-col gap-1.5 pt-2 border-t border-slate-800/60">
                  <label className="text-xs font-medium text-slate-300 flex items-center justify-between">
                    <span>Copy to Additional Location (Optional)</span>
                    <span className="text-[10px] text-slate-500 font-normal">Destination folder on VPS</span>
                  </label>
                  <input
                    type="text"
                    value={additionalCopyPath}
                    onChange={(e) => setAdditionalCopyPath(e.target.value)}
                    placeholder="/home/agydev/backup/govlabs11-pmo"
                    className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                  />
                </div>

                {additionalCopyPath && (
                  <div className="flex flex-col gap-2 pt-1 text-xs text-slate-300">
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] text-slate-400">Copy Mode:</span>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="copyMode"
                          checked={copyMode === 'WORKING_TREE'}
                          onChange={() => setCopyMode('WORKING_TREE')}
                          className="text-indigo-600 focus:ring-0"
                        />
                        <span className="text-[11px]">Clean Export</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="copyMode"
                          checked={copyMode === 'FULL_REPO'}
                          onChange={() => setCopyMode('FULL_REPO')}
                          className="text-indigo-600 focus:ring-0"
                        />
                        <span className="text-[11px]">Full Repo (.git)</span>
                      </label>
                    </div>

                    <label className="flex items-center gap-2 cursor-pointer text-[11px] text-slate-400">
                      <input
                        type="checkbox"
                        checked={autoCopyOnSync}
                        onChange={(e) => setAutoCopyOnSync(e.target.checked)}
                        className="rounded border-slate-700 text-indigo-600 focus:ring-0"
                      />
                      <span>Keep additional location in sync during future Git syncs</span>
                    </label>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-300">GitHub Repository URL (HTTPS)</label>
                <input
                  type="url"
                  required
                  value={newProjectRepoUrl}
                  onChange={(e) => setNewProjectRepoUrl(e.target.value)}
                  placeholder="https://github.com/org/repo.git"
                  className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-300">Project Display Name</label>
              <input
                type="text"
                required
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="Core Platform Specs"
                className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-300">Tracking Branch</label>
              <input
                type="text"
                value={newProjectBranch}
                onChange={(e) => setNewProjectBranch(e.target.value)}
                placeholder="main"
                className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2 mt-2">
              <button
                type="button"
                disabled={isSubmittingCreate}
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:bg-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmittingCreate}
                className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium px-4 py-2 rounded-xl text-xs transition-colors flex items-center gap-1.5"
              >
                {isSubmittingCreate ? (
                  <span>Publishing...</span>
                ) : (
                  <span>{createMode === 'local' ? 'Publish Local Project' : 'Create Project'}</span>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Delete Project Confirmation Modal */}
      {showDeleteModal && activeProject && (
        <div className="fixed inset-0 modal-overlay z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full flex flex-col gap-4 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="p-2.5 bg-rose-950/60 text-rose-400 border border-rose-900/60 rounded-xl shrink-0">
                <Trash2 size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-slate-100">
                  {activeProject.isLocalRepo ? 'Unpublish Project' : 'Delete Project'}
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Are you sure you want to {activeProject.isLocalRepo ? 'unpublish' : 'permanently delete'}{' '}
                  <strong className="text-slate-200">{activeProject.name}</strong>?
                </p>
              </div>
            </div>

            <div className="bg-slate-950 border border-slate-800/80 rounded-xl p-3 text-xs text-slate-400 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">{activeProject.isLocalRepo ? 'Local Path:' : 'Repository:'}</span>
                <span className="font-mono text-slate-300 truncate max-w-[200px]">
                  {activeProject.localSourcePath || activeProject.repoUrl}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Branch:</span>
                <span className="font-mono text-slate-300">{activeProject.branch}</span>
              </div>

              {activeProject.isLocalRepo ? (
                <div className="bg-emerald-950/40 border border-emerald-900/60 rounded-lg p-2.5 text-[11px] text-emerald-200 leading-relaxed">
                  <strong>Safety Guarantee:</strong> Your local files on disk at{' '}
                  <code className="bg-emerald-900/60 px-1 py-0.5 rounded text-emerald-300 font-mono">
                    {activeProject.localSourcePath || activeProject.repoUrl}
                  </code>{' '}
                  will remain <strong>completely untouched</strong>. This action only removes the publishing configuration and AI vector index from GitLens-Portal.
                </div>
              ) : (
                <p className="text-[11px] text-rose-400/90 pt-1 border-t border-slate-800/60">
                  This will delete the local bare repository clone, all sync logs, viewer groups, access rules, and invite memberships.
                </p>
              )}
            </div>

            {deleteError && (
              <p className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-xl p-2.5">
                {deleteError}
              </p>
            )}

            <div className="flex items-center justify-end gap-2 mt-1">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => {
                  setShowDeleteModal(false);
                  setDeleteError(null);
                }}
                className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:bg-slate-800 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleDeleteSubmit}
                className="bg-rose-600 hover:bg-rose-500 text-white font-medium px-4 py-2 rounded-xl text-xs transition-colors flex items-center gap-1.5 shadow-sm disabled:opacity-50"
              >
                {isDeleting ? (
                  <span>Processing...</span>
                ) : (
                  <>
                    <Trash2 size={13} />
                    <span>{activeProject.isLocalRepo ? 'Unpublish Project' : 'Delete Project'}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
