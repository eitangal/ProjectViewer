import React, { useState } from 'react';
import {
  GitPullRequest,
  ShieldCheck,
  Users,
  Sparkles,
  Eye,
  Plus,
  LogOut,
  FolderGit2,
} from 'lucide-react';
import { ProjectSummary, ViewerGroupSummary, ViewerMembershipSummary } from '@/shared/types.js';
import { SyncAndRepoTab } from './SyncAndRepoTab.js';
import { AclRuleBuilderWorkspace } from './AclRuleBuilderWorkspace.js';
import { ViewerInvitationsTab } from './ViewerInvitationsTab.js';
import { AiSettingsTab } from './AiSettingsTab.js';

export const PublisherConsoleLayout: React.FC<{
  projects: ProjectSummary[];
  activeProject: ProjectSummary | null;
  groups: ViewerGroupSummary[];
  viewers: ViewerMembershipSummary[];
  syncLogs: any[];
  onSelectProject: (id: string) => void;
  onCreateProject: (data: { name: string; repoUrl: string; branch?: string }) => Promise<void>;
  onTriggerSync: (opts?: { forceReindex?: boolean }) => Promise<void>;
  onUpdateProject: (data: Partial<ProjectSummary>) => Promise<void>;
  onSaveGroup: (group: Partial<ViewerGroupSummary>) => Promise<void>;
  onInviteViewer: (email: string, groupIds: string[]) => Promise<any>;
  onBulkInvite: (entries: { email: string; groupIds: string[] }[]) => Promise<void>;
  onRevokeViewer: (userId: string) => Promise<void>;
  onSaveAiConfig: (data: any) => Promise<void>;
  onTestKey: (apiKey: string) => Promise<boolean>;
  onOpenViewer: (projectId: string, previewGroupId?: string | null) => void;
  onLogout: () => void;
}> = ({
  projects,
  activeProject,
  groups,
  viewers,
  syncLogs,
  onSelectProject,
  onCreateProject,
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
}) => {
  const [activeTab, setActiveTab] = useState<'sync' | 'acl' | 'viewers' | 'ai'>('sync');
  const [selectedPreviewGroupId, setSelectedPreviewGroupId] = useState<string>('');
  const [showCreateModal, setShowCreateModal] = useState(false);
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

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-950 text-slate-100">
      {/* Top Header */}
      <header className="h-16 border-b border-slate-800 bg-slate-900/90 backdrop-blur-md flex items-center justify-between px-6 shrink-0 z-30">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-indigo-400 font-semibold text-sm tracking-wide">
            <FolderGit2 size={20} />
            <span>GitLens-Portal Publisher</span>
          </div>

          <div className="h-4 w-[1px] bg-slate-800" />

          {/* Project Switcher */}
          <select
            value={activeProject?.id || ''}
            onChange={(e) => onSelectProject(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 font-medium focus:outline-none focus:border-indigo-500"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.branch})
              </option>
            ))}
          </select>

          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs transition-colors"
          >
            <Plus size={14} />
            <span>New Project</span>
          </button>
        </div>

        {/* Right Action: Preview as Group (PUB-05) */}
        <div className="flex items-center gap-3">
          {activeProject && (
            <div className="flex items-center gap-2 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
              <span className="text-slate-400 text-[11px] ps-2 flex items-center gap-1">
                <Eye size={12} />
                <span>Impersonate:</span>
              </span>
              <select
                value={selectedPreviewGroupId}
                onChange={(e) => setSelectedPreviewGroupId(e.target.value)}
                className="bg-slate-900 border-0 rounded-lg px-2 py-1 text-xs text-slate-200 focus:outline-none"
              >
                <option value="">Full Publisher View</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    Group: {g.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() => onOpenViewer(activeProject.id, selectedPreviewGroupId || null)}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-3 py-1 rounded-lg text-xs transition-colors flex items-center gap-1"
              >
                <span>Launch Portal</span>
              </button>
            </div>
          )}

          <button
            onClick={onLogout}
            title="Sign Out"
            className="p-2 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors"
          >
            <LogOut size={16} />
          </button>
        </div>
      </header>

      {/* Tabs Navigation */}
      <div className="h-12 border-b border-slate-800 bg-slate-900/50 px-6 flex items-center gap-2 shrink-0">
        <button
          onClick={() => setActiveTab('sync')}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
            activeTab === 'sync'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <GitPullRequest size={14} />
          <span>Repository & Sync</span>
        </button>

        <button
          onClick={() => setActiveTab('acl')}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
            activeTab === 'acl'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <ShieldCheck size={14} />
          <span>Viewer Groups & ACL Rules</span>
        </button>

        <button
          onClick={() => setActiveTab('viewers')}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
            activeTab === 'viewers'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <Users size={14} />
          <span>Viewer Access & Invites</span>
        </button>

        <button
          onClick={() => setActiveTab('ai')}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
            activeTab === 'ai'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <Sparkles size={14} />
          <span>Gemini BYOK & AI Settings</span>
        </button>
      </div>

      {/* Main Tab Content */}
      <main className="flex-1 overflow-y-auto p-6 bg-slate-950">
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
              onClick={() => setShowCreateModal(true)}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-4 py-2 rounded-xl text-xs transition-colors"
            >
              Create Project
            </button>
          </div>
        )}
      </main>

      {/* New Project Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
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
    </div>
  );
};
