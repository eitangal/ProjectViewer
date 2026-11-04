import React, { useState, useMemo } from 'react';
import {
  Folder,
  FolderOpen,
  FileText,
  FileCode,
  FileSearch,
  Search,
  ChevronRight,
  ChevronDown,
  Layers,
  Globe,
} from 'lucide-react';
import { FileTreeNode } from '@/shared/types.js';
import { useViewerStore } from '../../store/useViewerStore.js';

function getFileIcon(fileName: string) {
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (ext === 'md' || ext === 'mdx') return <FileText size={15} className="text-sky-400 shrink-0" />;
  if (ext === 'mmd' || ext === 'mermaid') return <Layers size={15} className="text-emerald-400 shrink-0" />;
  if (ext === 'html' || ext === 'htm') return <Globe size={15} className="text-amber-400 shrink-0" />;
  if (['yaml', 'yml', 'json'].includes(ext || '')) return <FileCode size={15} className="text-indigo-400 shrink-0" />;
  return <FileCode size={15} className="text-slate-400 shrink-0" />;
}

export const CollapsibleFileSidebar: React.FC<{
  tree: FileTreeNode[];
  isLoading?: boolean;
}> = ({ tree, isLoading = false }) => {
  const { isSidebarOpen, activeFilePath, navigateToFile } = useViewerStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => {
    // Default expand all top-level folders
    return new Set(tree.filter((n) => n.type === 'directory').map((n) => n.path));
  });

  // Re-expand folders when authorization or tree changes
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

      const isActive = activeFilePath === node.path;
      return (
        <button
          key={node.path}
          onClick={() => navigateToFile(node.path)}
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

  if (!isSidebarOpen) {
    return null;
  }

  return (
    <aside className="w-72 border-e border-slate-800 bg-slate-950 flex flex-col shrink-0 overflow-hidden h-full z-20">
      {/* Quick Search Header */}
      <div className="p-3 border-b border-slate-800/80">
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

      {/* File Tree Viewport */}
      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-0.5">
        {isLoading ? (
          <div className="p-4 text-center text-xs text-slate-500">Loading file tree...</div>
        ) : searchResults ? (
          // Filtered Flat Search Results
          <div className="flex flex-col gap-0.5">
            <span className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Matching Files ({searchResults.length})
            </span>
            {searchResults.length === 0 ? (
              <p className="px-3 py-2 text-xs text-slate-500">No matching files found.</p>
            ) : (
              searchResults.map((f) => {
                const isActive = activeFilePath === f.path;
                return (
                  <button
                    key={f.path}
                    onClick={() => navigateToFile(f.path)}
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
    </aside>
  );
};
