import React, { useState } from 'react';
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
  onCloseCreateModal?: () => void;
  showDeleteModalControlled?: boolean;
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
  onCloseCreateModal,
  showDeleteModalControlled,
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

  const showCreateModal = showCreateModalControlled !== undefined ? showCreateModalControlled : internalShowCreateModal;
  const setShowCreateModal = (val: boolean) => {
    setInternalShowCreateModal(val);
    if (!val && onCloseCreateModal) onCloseCreateModal();
  };

  const showDeleteModal = showDeleteModalControlled !== undefined ? showDeleteModalControlled : internalShowDeleteModal;
  const setShowDeleteModal = (val: boolean) => {
    setInternalShowDeleteModal(val);
    if (!val && onCloseDeleteModal) onCloseDeleteModal();
  };
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectRepoUrl, setNewProjectRepoUrl] = useState('');
  const [newProjectBranch, setNewProjectBranch] = useState('main');

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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

  const isSysAdmin = user?.role === 'SYSADMIN' || user?.globalRole === 'SYSADMIN';

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
            className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full flex flex-col gap-4 shadow-2xl"
          >
            <h3 className="text-base font-semibold text-slate-100">Create New Project</h3>
            <p className="text-xs text-slate-400">
              Connect a GitHub repository to begin curating fine-grained views.
            </p>

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
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:bg-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-4 py-2 rounded-xl text-xs transition-colors"
              >
                Create Project
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
                <h3 className="text-base font-semibold text-slate-100">Delete Project</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Are you sure you want to permanently delete <strong className="text-slate-200">{activeProject.name}</strong>?
                </p>
              </div>
            </div>

            <div className="bg-slate-950 border border-slate-800/80 rounded-xl p-3 text-xs text-slate-400 flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Repository:</span>
                <span className="font-mono text-slate-300 truncate max-w-[200px]">{activeProject.repoUrl}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Branch:</span>
                <span className="font-mono text-slate-300">{activeProject.branch}</span>
              </div>
              <p className="text-[11px] text-rose-400/90 pt-1 border-t border-slate-800/60">
                This will delete the local bare repository clone, all sync logs, viewer groups, access rules, and invite memberships.
              </p>
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
                  <span>Deleting...</span>
                ) : (
                  <>
                    <Trash2 size={13} />
                    <span>Delete Project</span>
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
