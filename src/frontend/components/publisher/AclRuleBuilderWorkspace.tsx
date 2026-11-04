import React, { useState, useMemo, useEffect } from 'react';
import picomatch from 'picomatch';
import { ShieldCheck, Lock, Check, Save, RefreshCw, FileText } from 'lucide-react';
import { RepoFileEntry, ViewerGroupSummary } from '@/shared/types.js';

interface AclRuleState {
  allowedFolders: string;
  allowedExtensions: string;
  excludeGlobs: string;
  maxFileSizeBytes: number;
}

const DEFAULT_MOCK_FILES: RepoFileEntry[] = [
  { filePath: 'README.md', sizeBytes: 4200 },
  { filePath: 'docs/arch/overview.md', sizeBytes: 12500 },
  { filePath: 'docs/arch/security-spec.md', sizeBytes: 8900 },
  { filePath: 'docs/internal/roadmap-secret.md', sizeBytes: 15000 },
  { filePath: 'specs/openapi.yaml', sizeBytes: 45000 },
  { filePath: 'specs/auth-flow.mmd', sizeBytes: 2100 },
  { filePath: 'src/backend/server.ts', sizeBytes: 64000 },
  { filePath: '.env.production', sizeBytes: 300 },
];

export const AclRuleBuilderWorkspace: React.FC<{
  projectId: string;
  activeGroup: ViewerGroupSummary | null;
  onSaveGroup: (group: Partial<ViewerGroupSummary>) => Promise<void>;
}> = ({ projectId, activeGroup, onSaveGroup }) => {
  const [repoFiles, setRepoFiles] = useState<RepoFileEntry[]>(DEFAULT_MOCK_FILES);
  const [isUsingRealFiles, setIsUsingRealFiles] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [rule, setRule] = useState<AclRuleState>({
    allowedFolders: activeGroup?.allowedFolders.join(', ') || 'docs, specs',
    allowedExtensions: activeGroup?.allowedExtensions.join(', ') || '.md, .yaml, .yml, .mmd',
    excludeGlobs: activeGroup?.excludeGlobs.join(', ') || '**/internal/**, **/*.secret.*, **/.env*',
    maxFileSizeBytes: activeGroup?.maxFileSizeBytes || 2097152,
  });

  // Sync state if activeGroup changes
  useEffect(() => {
    if (activeGroup) {
      setRule({
        allowedFolders: activeGroup.allowedFolders.join(', '),
        allowedExtensions: activeGroup.allowedExtensions.join(', '),
        excludeGlobs: activeGroup.excludeGlobs.join(', '),
        maxFileSizeBytes: activeGroup.maxFileSizeBytes,
      });
    }
  }, [activeGroup]);

  // Fetch real repo files if available
  useEffect(() => {
    fetch(`/api/projects/${projectId}/repo-files`)
      .then((res) => res.json())
      .then((data) => {
        if (data.synced && data.files && data.files.length > 0) {
          setRepoFiles(data.files);
          setIsUsingRealFiles(true);
        }
      })
      .catch(() => {
        // Fall back to DEFAULT_MOCK_FILES
      });
  }, [projectId]);

  // Live real-time evaluation against current file tree
  const evaluationResult = useMemo(() => {
    const folders = rule.allowedFolders.split(',').map((f) => f.trim()).filter(Boolean);
    const exts = rule.allowedExtensions.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    const excludes = rule.excludeGlobs.split(',').map((g) => g.trim()).filter(Boolean);

    const isExcluded = excludes.length > 0
      ? (picomatch(excludes, { dot: true, nocase: true }) as (str: string) => boolean)
      : () => false;

    const allowAllFolders = folders.includes('*') || folders.length === 0;

    return repoFiles.map((file) => {
      if (file.sizeBytes > rule.maxFileSizeBytes) {
        return { ...file, included: false, reason: 'Exceeds size limit' };
      }
      if (isExcluded(file.filePath)) {
        return { ...file, included: false, reason: 'Matched exclude glob' };
      }

      const dotIdx = file.filePath.lastIndexOf('.');
      const ext = dotIdx !== -1 ? file.filePath.slice(dotIdx).toLowerCase() : '';
      if (exts.length > 0 && !exts.includes(ext)) {
        return { ...file, included: false, reason: 'Extension not allowed' };
      }

      if (allowAllFolders) {
        return { ...file, included: true, reason: 'Allowed' };
      }

      const inFolder = folders.some((f) => file.filePath === f || file.filePath.startsWith(`${f}/`));
      return {
        ...file,
        included: inFolder,
        reason: inFolder ? 'Allowed folder' : 'Outside allowed folders',
      };
    });
  }, [rule, repoFiles]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const folders = rule.allowedFolders.split(',').map((f) => f.trim()).filter(Boolean);
      const exts = rule.allowedExtensions.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
      const excludes = rule.excludeGlobs.split(',').map((g) => g.trim()).filter(Boolean);

      await onSaveGroup({
        allowedFolders: folders.length > 0 ? folders : ['*'],
        allowedExtensions: exts,
        excludeGlobs: excludes,
        maxFileSizeBytes: rule.maxFileSizeBytes,
      });

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } finally {
      setIsSaving(false);
    }
  };

  const visibleCount = evaluationResult.filter((f) => f.included).length;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full p-2">
      {/* Left Column: Rule Editor Form */}
      <div className="lg:col-span-6 bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col gap-5 shadow-xl">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
              <ShieldCheck size={18} className="text-indigo-400" />
              <span>Viewer Group ACL Rules</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Configure precise folder whitelists, allowed extensions, and exclusion globs for group{' '}
              <span className="font-semibold text-slate-200">"{activeGroup?.name || 'Default'}"</span>.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-slate-300">
            Allowed Folders (comma separated, or * for all)
          </label>
          <input
            type="text"
            value={rule.allowedFolders}
            onChange={(e) => setRule({ ...rule, allowedFolders: e.target.value })}
            placeholder="docs, specs, api"
            className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-slate-300">
            Allowed File Extensions (comma separated)
          </label>
          <input
            type="text"
            value={rule.allowedExtensions}
            onChange={(e) => setRule({ ...rule, allowedExtensions: e.target.value })}
            placeholder=".md, .yaml, .mmd, .json"
            className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-slate-300">
            Exclusion Globs (Deny rules that override allow rules)
          </label>
          <input
            type="text"
            value={rule.excludeGlobs}
            onChange={(e) => setRule({ ...rule, excludeGlobs: e.target.value })}
            placeholder="**/internal/**, **/*.secret.*, **/.env*"
            className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-slate-300">Max File Size Limit (Bytes)</label>
          <input
            type="number"
            value={rule.maxFileSizeBytes}
            onChange={(e) => setRule({ ...rule, maxFileSizeBytes: Number(e.target.value) })}
            className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex items-center gap-3 mt-2">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium py-2.5 rounded-xl transition-colors text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-indigo-600/20"
          >
            {isSaving ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : saveSuccess ? (
              <>
                <Check size={14} className="text-emerald-300" />
                <span>ACL Rules Saved!</span>
              </>
            ) : (
              <>
                <Save size={14} />
                <span>Save ACL Rules</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Right Column: Live Tree Preview */}
      <div className="lg:col-span-6 bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col gap-4 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <span>Live ACL Tree Preview</span>
              {isUsingRealFiles ? (
                <span className="text-[10px] font-mono font-normal px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800">
                  Real Repo HEAD
                </span>
              ) : (
                <span className="text-[10px] font-mono font-normal px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
                  Simulation Mock
                </span>
              )}
            </h3>
            <p className="text-xs text-slate-400">Instant visualizer of permitted files</p>
          </div>
          <span className="text-xs px-2.5 py-1 bg-slate-800 rounded-full text-slate-300 font-mono">
            {visibleCount} of {evaluationResult.length} files visible
          </span>
        </div>

        <div className="flex flex-col gap-2 overflow-y-auto max-h-[460px] pe-1">
          {evaluationResult.map((file) => (
            <div
              key={file.filePath}
              className={`flex items-center justify-between p-3 rounded-xl border transition-all text-xs ${
                file.included
                  ? 'bg-emerald-950/20 border-emerald-900/50 text-emerald-200'
                  : 'bg-slate-950/50 border-slate-800/80 text-slate-500 opacity-60'
              }`}
            >
              <div className="flex items-center gap-2.5 truncate">
                {file.included ? (
                  <Check size={14} className="text-emerald-400 shrink-0" />
                ) : (
                  <Lock size={14} className="text-slate-500 shrink-0" />
                )}
                <span className="font-mono truncate">{file.filePath}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded ${
                    file.included ? 'bg-emerald-900/40 text-emerald-300' : 'bg-slate-900 text-slate-500'
                  }`}
                >
                  {file.reason}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
