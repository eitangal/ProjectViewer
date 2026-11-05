import React, { useState, useMemo } from 'react';
import {
  Folder,
  FolderOpen,
  FileText,
  Code,
  FileCode,
  Search,
  ChevronRight,
  ChevronDown,
  Layers,
  Globe,
  Eye,
  Server,
  Mail,
  Plus,
  Trash2,
  GitPullRequest,
  ShieldCheck,
  Users,
  Sparkles,
  FolderGit2,
} from 'lucide-react';
import { FileTreeNode, ProjectSummary, ViewerGroupSummary } from '@/shared/types.js';
import { useViewerStore } from '../../store/useViewerStore.js';

function getFileIcon(fileName: string) {
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (ext === 'md' || ext === 'mdx') return <FileText size={15} className="text-sky-400 shrink-0" />;
  if (ext === 'mmd' || ext === 'mermaid') return <Layers size={15} className="text-emerald-400 shrink-0" />;
  if (ext === 'html' || ext === 'htm') return <Globe size={15} className="text-amber-400 shrink-0" />;
  if (['yaml', 'yml', 'json'].includes(ext || '')) return <FileCode size={15} className="text-indigo-400 shrink-0" />;
  return <FileCode size={15} className="text-slate-400 shrink-0" />;
}

export interface CollapsibleFileSidebarProps {
  user?: { email: string; role?: string; globalRole?: string } | null;
  // Projects
  projects?: ProjectSummary[];
  activeProject?: ProjectSummary | null;
  onSelectProject?: (id: string) => void;
  // Navigation / Active View
  activeView?: string;
  onSelectView?: (view: string) => void;
  // Publisher Modals
  onCreateProject?: () => void;
  onDeleteProject?: () => void;
  // Admin Actions
  onInvitePublisher?: () => void;
  isBrevoConfigured?: boolean;
  // Viewer Tree Props
  tree: FileTreeNode[];
  isLoading?: boolean;
  isPublisher?: boolean;
  previewGroupId?: string | null;
  onPreviewGroupChange?: (groupId: string | null) => void;
  groups?: ViewerGroupSummary[];
  isSysAdmin?: boolean;
}

export const CollapsibleFileSidebar: React.FC<CollapsibleFileSidebarProps> = ({
  user,
  projects = [],
  activeProject = null,
  onSelectProject,
  activeView = 'viewer',
  onSelectView,
  onCreateProject,
  onDeleteProject,
  onInvitePublisher,
  isBrevoConfigured = true,
  tree,
  isLoading = false,
  isPublisher = false,
  previewGroupId = null,
  onPreviewGroupChange,
  groups = [],
  isSysAdmin = false,
}) => {
  const {
    direction,
    setDirection,
    viewMode,
    setViewMode,
    isSidebarOpen,
    activeFilePath,
    navigateToFile,
  } = useViewerStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [isAdminOpen, setIsAdminOpen] = useState(true);
  const [isPublisherOpen, setIsPublisherOpen] = useState(true);
  const [isViewerOpen, setIsViewerOpen] = useState(true);

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => {
    return new Set(tree.filter((n) => n.type === 'directory').map((n) => n.path));
  });

  // Re-expand folders when tree updates
  React.useEffect(() => {
    setExpandedFolders(new Set(tree.filter((n) => n.type === 'directory').map((n) => n.path)));
  }, [tree]);

  const toggleFolder = (folderPath: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) {
        next.delete(folderPath);
      } else {
        next.add(folderPath);
      }
      return next;
    });
  };

  // Flatten for fuzzy search
  const flatFiles = useMemo(() => {
    const list: { name: string; path: string }[] = [];
    function traverse(nodes: FileTreeNode[]) {
      for (const node of nodes) {
        if (node.type === 'file') {
          list.push({ name: node.name, path: node.path });
        } else if (node.children) {
          traverse(node.children);
        }
      }
    }
    traverse(tree);
    return list;
  }, [tree]);

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return null;
    const q = searchQuery.toLowerCase().trim();
    return flatFiles.filter(
      (f) => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)
    );
  }, [flatFiles, searchQuery]);

  if (!isSidebarOpen) {
    return null;
  }

  // Differentiate published projects vs viewer projects
  const publishedProjects = projects.filter((p) => p.userRole === 'PUBLISHER' || isSysAdmin);
  const viewerProjects = projects.filter((p) => p.userRole === 'VIEWER');
  const hasPublishedProjects = publishedProjects.length > 0 || isSysAdmin || user?.role === 'PUBLISHER' || user?.globalRole === 'PUBLISHER';

  const renderTreeNodes = (nodes: FileTreeNode[], depth = 0) => {
    return nodes.map((node) => {
      if (node.type === 'directory') {
        const isExpanded = expandedFolders.has(node.path);
        return (
          <div key={node.path} className="flex flex-col">
            <button
              onClick={() => toggleFolder(node.path)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-slate-300 hover:bg-slate-900 transition-colors w-full text-start"
              style={{ marginInlineStart: `${depth * 10}px` }}
            >
              {isExpanded ? (
                <ChevronDown size={14} className="text-slate-500 shrink-0" />
              ) : (
                <ChevronRight size={14} className="text-slate-500 shrink-0" />
              )}
              {isExpanded ? (
                <FolderOpen size={15} className="text-indigo-400 shrink-0" />
              ) : (
                <Folder size={15} className="text-slate-400 shrink-0" />
              )}
              <span className="truncate font-medium">{node.name}</span>
            </button>

            {isExpanded && node.children && (
              <div className="flex flex-col">
                {renderTreeNodes(node.children, depth + 1)}
              </div>
            )}
          </div>
        );
      }

      const isActive = activeFilePath === node.path && activeView === 'viewer';
      return (
        <button
          key={node.path}
          onClick={() => {
            navigateToFile(node.path);
            onSelectView?.('viewer');
          }}
          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors w-full text-start ${
            isActive
              ? 'bg-indigo-600/20 text-indigo-300 font-medium border-s-2 border-indigo-500'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
          }`}
          style={{ marginInlineStart: `${depth * 10 + 16}px` }}
        >
          {getFileIcon(node.name)}
          <span className="truncate">{node.name}</span>
        </button>
      );
    });
  };

  return (
    <aside className="w-72 border-e border-slate-800 bg-slate-950 flex flex-col shrink-0 overflow-hidden h-full z-20">
      <div className="flex-1 overflow-y-auto flex flex-col">
        {/* ============================================================ */}
        {/* SECTION 1: ADMIN (Only visible to SYSADMIN)                  */}
        {/* ============================================================ */}
        {isSysAdmin && (
          <div className="border-b border-slate-800 bg-slate-950 shrink-0">
            <button
              type="button"
              onClick={() => setIsAdminOpen(!isAdminOpen)}
              className="w-full p-3 bg-slate-900/50 hover:bg-slate-900 flex items-center justify-between text-start transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Admin Governance
                </span>
                <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-rose-950 text-rose-300 border border-rose-800/80">
                  Root
                </span>
              </div>
              {isAdminOpen ? (
                <ChevronDown size={14} className="text-slate-500" />
              ) : (
                <ChevronRight size={14} className="text-slate-500" />
              )}
            </button>

            {isAdminOpen && (
              <div className="p-2 flex flex-col gap-1 bg-slate-950/80 border-t border-slate-800/60">
                <button
                  type="button"
                  onClick={() => onSelectView?.('admin-overview')}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors w-full text-start ${
                    activeView === 'admin-overview'
                      ? 'bg-rose-600/20 text-rose-300 border-s-2 border-rose-500'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                  }`}
                >
                  <Server size={14} className="shrink-0" />
                  <span className="flex-1">Overview & Quotas</span>
                </button>

                <button
                  type="button"
                  onClick={() => onSelectView?.('admin-smtp')}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors w-full text-start ${
                    activeView === 'admin-smtp'
                      ? 'bg-rose-600/20 text-rose-300 border-s-2 border-rose-500'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                  }`}
                >
                  <Mail size={14} className="shrink-0" />
                  <span className="flex-1">Brevo API Setup</span>
                  {!isBrevoConfigured && (
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" title="Brevo API not configured" />
                  )}
                </button>

                {onInvitePublisher && (
                  <button
                    type="button"
                    onClick={onInvitePublisher}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-indigo-300 hover:bg-slate-900 transition-colors w-full text-start"
                  >
                    <Plus size={14} className="text-indigo-400 shrink-0" />
                    <span>+ Onboard Publisher</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* ============================================================ */}
        {/* SECTION 2: PUBLISHER (Visible if user publishes >= 1 project)*/}
        {/* ============================================================ */}
        {hasPublishedProjects && (
          <div className="border-b border-slate-800 bg-slate-950 shrink-0">
            <button
              type="button"
              onClick={() => setIsPublisherOpen(!isPublisherOpen)}
              className="w-full p-3 bg-slate-900/40 hover:bg-slate-900/60 flex items-center justify-between text-start transition-colors"
            >
              <div className="flex items-center gap-2">
                <FolderGit2 size={13} className="text-indigo-400" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Publisher Console
                </span>
                <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-indigo-950 text-indigo-300 border border-indigo-800/80">
                  Publisher
                </span>
              </div>
              {isPublisherOpen ? (
                <ChevronDown size={14} className="text-slate-500" />
              ) : (
                <ChevronRight size={14} className="text-slate-500" />
              )}
            </button>

            {isPublisherOpen && (
              <div className="p-2.5 flex flex-col gap-2.5 bg-slate-950 border-t border-slate-800/60">
                {/* Published Projects Dropdown + Actions */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-medium text-slate-400">Active Project:</span>
                    <div className="flex items-center gap-1">
                      {onCreateProject && (
                        <button
                          type="button"
                          onClick={onCreateProject}
                          title="Create New Project"
                          aria-label="Create New Project"
                          className="flex items-center gap-1 px-1.5 py-0.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-[10px] font-medium transition-colors shadow-xs"
                        >
                          <Plus size={11} />
                          <span>New</span>
                        </button>
                      )}
                      {activeProject && (activeProject.userRole === 'PUBLISHER' || isSysAdmin) && onDeleteProject && (
                        <button
                          type="button"
                          onClick={onDeleteProject}
                          title={`Delete project "${activeProject.name}"`}
                          aria-label="Delete Project"
                          className="p-1 text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 rounded transition-colors"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>

                  {publishedProjects.length > 0 ? (
                    <select
                      aria-label="Select Published Project"
                      value={activeProject?.id || ''}
                      onChange={(e) => onSelectProject?.(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-xs text-indigo-200 font-medium focus:outline-none focus:border-indigo-500 truncate cursor-pointer"
                    >
                      {publishedProjects.map((p) => (
                        <option key={p.id} value={p.id} className="bg-slate-900 text-slate-100">
                          {p.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-[11px] text-slate-500 italic">No published projects yet.</p>
                  )}
                </div>

                {/* Publisher Tabs: Launch & Open Viewer Portal buttons are removed */}
                {activeProject && (activeProject.userRole === 'PUBLISHER' || isSysAdmin) && (
                  <div className="flex flex-col gap-1 pt-1 border-t border-slate-800/60">
                    <button
                      type="button"
                      onClick={() => onSelectView?.('publisher-sync')}
                      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors w-full text-start ${
                        activeView === 'publisher-sync'
                          ? 'bg-indigo-600/20 text-indigo-300 border-s-2 border-indigo-500'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                      }`}
                    >
                      <GitPullRequest size={14} className="shrink-0" />
                      <span className="flex-1">Repository & Sync</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onSelectView?.('publisher-acl')}
                      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors w-full text-start ${
                        activeView === 'publisher-acl'
                          ? 'bg-indigo-600/20 text-indigo-300 border-s-2 border-indigo-500'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                      }`}
                    >
                      <ShieldCheck size={14} className="shrink-0" />
                      <span className="flex-1">Viewer Groups & ACL</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onSelectView?.('publisher-viewers')}
                      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors w-full text-start ${
                        activeView === 'publisher-viewers'
                          ? 'bg-indigo-600/20 text-indigo-300 border-s-2 border-indigo-500'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                      }`}
                    >
                      <Users size={14} className="shrink-0" />
                      <span className="flex-1">Viewer Invites & Access</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onSelectView?.('publisher-ai')}
                      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors w-full text-start ${
                        activeView === 'publisher-ai'
                          ? 'bg-indigo-600/20 text-indigo-300 border-s-2 border-indigo-500'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                      }`}
                    >
                      <Sparkles size={14} className="shrink-0 text-indigo-400" />
                      <span className="flex-1">Gemini BYOK & AI</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ============================================================ */}
        {/* SECTION 3: VIEWER (Visible for ALL roles & ALL projects)     */}
        {/* ============================================================ */}
        <div className="flex-1 flex flex-col min-h-0 bg-slate-950">
          <button
            type="button"
            onClick={() => setIsViewerOpen(!isViewerOpen)}
            className="w-full p-3 bg-slate-900/30 hover:bg-slate-900/50 flex items-center justify-between text-start transition-colors shrink-0"
          >
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Documentation & Files
              </span>
              <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-emerald-950 text-emerald-300 border border-emerald-800/80">
                Viewer
              </span>
            </div>
            {isViewerOpen ? (
              <ChevronDown size={14} className="text-slate-500" />
            ) : (
              <ChevronRight size={14} className="text-slate-500" />
            )}
          </button>

          {isViewerOpen && (
            <div className="flex-1 flex flex-col min-h-0">
              {/* Mixed-Role Project Switcher: Published Projects vs Shared with Me */}
              {projects.length > 1 && (
                <div className="px-3 py-2 border-b border-slate-800/80 bg-slate-900/30 shrink-0 flex flex-col gap-1">
                  <span className="text-[10px] text-slate-400 font-medium">Viewing Project:</span>
                  <select
                    aria-label="Select Project to View"
                    value={activeProject?.id || ''}
                    onChange={(e) => onSelectProject?.(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-xs text-indigo-200 font-medium focus:outline-none focus:border-indigo-500 truncate cursor-pointer"
                  >
                    {publishedProjects.length > 0 && (
                      <optgroup label="Published Projects" className="bg-slate-900 text-slate-400 font-semibold">
                        {publishedProjects.map((p) => (
                          <option key={p.id} value={p.id} className="bg-slate-900 text-slate-100">
                            {p.name} (Publisher)
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {viewerProjects.length > 0 && (
                      <optgroup label="Shared with Me (Viewer)" className="bg-slate-900 text-slate-400 font-semibold">
                        {viewerProjects.map((p) => (
                          <option key={p.id} value={p.id} className="bg-slate-900 text-slate-100">
                            {p.name} (Viewer)
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>
              )}

              {/* View Authorization (Preview Group): Only shown if user is publisher/admin on active project */}
              {isPublisher && (
                <div className="px-3 py-2 border-b border-slate-800/80 bg-indigo-950/30 shrink-0 flex flex-col gap-1">
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span className="flex items-center gap-1 font-medium text-indigo-300">
                      <Eye size={12} className="text-indigo-400" />
                      <span>View Authorization:</span>
                    </span>
                    <span className="text-[9px] text-indigo-400/80">
                      {previewGroupId ? 'Filtered' : 'Full Access'}
                    </span>
                  </div>
                  <select
                    aria-label="Preview as Viewer Group"
                    value={previewGroupId || ''}
                    onChange={(e) => onPreviewGroupChange?.(e.target.value || null)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-xs text-indigo-200 font-medium focus:outline-none focus:border-indigo-500 cursor-pointer"
                  >
                    <option value="" className="bg-slate-900 text-slate-100">
                      Full View (All Files)
                    </option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id} className="bg-slate-900 text-slate-100">
                        Group: {g.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Quick Search Header */}
              <div className="p-2.5 border-b border-slate-800/80 shrink-0">
                <div className="relative flex items-center">
                  <Search size={14} className="absolute start-3 text-slate-500 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search files... (Cmd+P)"
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl ps-9 pe-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
                  />
                </div>
              </div>

              {/* Controls Between Search and Tree: Formatted vs Raw Code & LTR vs RTL */}
              <div className="px-2.5 py-1.5 border-b border-slate-800/80 bg-slate-900/40 flex items-center justify-between gap-1.5 shrink-0">
                {/* Formatted vs Raw Code Segmented Control */}
                <div
                  title="View Mode: Formatted Document vs Raw Code"
                  className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-[11px]"
                >
                  <button
                    type="button"
                    onClick={() => setViewMode('formatted')}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded transition-all ${
                      viewMode === 'formatted'
                        ? 'bg-indigo-600 text-white font-medium shadow-xs'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <FileText size={12} />
                    <span>Formatted</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('raw')}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded transition-all ${
                      viewMode === 'raw'
                        ? 'bg-indigo-600 text-white font-medium shadow-xs'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Code size={12} />
                    <span>Raw</span>
                  </button>
                </div>

                {/* Bi-Directional (LTR / RTL) Switcher */}
                <div
                  title="Document Reading Direction (LTR / RTL)"
                  className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-[11px] font-mono"
                >
                  <button
                    type="button"
                    onClick={() => setDirection('ltr')}
                    className={`px-1.5 py-0.5 rounded transition-all ${
                      direction === 'ltr'
                        ? 'bg-slate-800 text-slate-100 font-medium'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    LTR
                  </button>
                  <button
                    type="button"
                    onClick={() => setDirection('rtl')}
                    className={`px-1.5 py-0.5 rounded transition-all ${
                      direction === 'rtl'
                        ? 'bg-slate-800 text-slate-100 font-medium'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    RTL
                  </button>
                </div>
              </div>

              {/* File Tree Viewport */}
              <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-0.5 min-h-[180px]">
                {isLoading ? (
                  <div className="p-4 text-center text-xs text-slate-500">Loading file tree...</div>
                ) : searchResults ? (
                  <div className="flex flex-col gap-0.5">
                    <span className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Matching Files ({searchResults.length})
                    </span>
                    {searchResults.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-slate-500">No matching files found.</p>
                    ) : (
                      searchResults.map((f) => {
                        const isActive = activeFilePath === f.path && activeView === 'viewer';
                        return (
                          <button
                            key={f.path}
                            onClick={() => {
                              navigateToFile(f.path);
                              onSelectView?.('viewer');
                            }}
                            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-start transition-colors ${
                              isActive
                                ? 'bg-indigo-600/20 text-indigo-300 font-medium'
                                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                            }`}
                          >
                            {getFileIcon(f.name)}
                            <div className="flex flex-col truncate">
                              <span className="truncate">{f.name}</span>
                              <span className="text-[10px] text-slate-500 truncate">{f.path}</span>
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                ) : tree.length === 0 ? (
                  <div className="p-4 text-center text-xs text-slate-500">
                    No authorized files available in this project view.
                  </div>
                ) : (
                  renderTreeNodes(tree)
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};
