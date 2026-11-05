import React, { useState } from 'react';
import {
  RefreshCw,
  Copy,
  Check,
  CheckCircle,
  AlertCircle,
  Sparkles,
  FileCode2,
  HardDrive,
  Info,
  Trash2,
  FolderSync,
  ExternalLink,
} from 'lucide-react';
import { ProjectSummary } from '@/shared/types.js';

export const SyncAndRepoTab: React.FC<{
  project: ProjectSummary;
  syncLogs: any[];
  onTriggerSync: (opts?: { forceReindex?: boolean }) => Promise<void>;
  onUpdateProject: (data: Partial<ProjectSummary> & { githubPat?: string; webhookSecret?: string }) => Promise<void>;
  onDeleteProject?: () => void;
}> = ({ project, syncLogs, onTriggerSync, onUpdateProject, onDeleteProject }) => {
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [patInput, setPatInput] = useState('');
  const [branchInput, setBranchInput] = useState(project.branch);
  const [syncInterval, setSyncInterval] = useState(project.syncIntervalMinutes);

  // Additional Copy Location State
  const [additionalPathInput, setAdditionalPathInput] = useState(project.additionalCopyPath || '');
  const [autoCopyInput, setAutoCopyInput] = useState(project.autoCopyOnSync !== false);
  const [copyModeInput, setCopyModeInput] = useState<'WORKING_TREE' | 'FULL_REPO'>(project.copyMode || 'WORKING_TREE');
  const [isCopying, setIsCopying] = useState(false);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  const webhookUrl = `${window.location.origin}/api/webhooks/github/${project.id}`;

  const handleSync = async (forceReindex = false) => {
    setIsSyncing(true);
    setSyncMessage(null);
    try {
      await onTriggerSync({ forceReindex });
      setSyncMessage(
        forceReindex
          ? 'Full AI re-indexing completed successfully.'
          : 'Git delta sync completed successfully.'
      );
    } catch (err: any) {
      setSyncMessage(`Sync failed: ${err.message || 'Unknown error'}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleCopyWebhook = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 2000);
  };

  const handleSaveSettings = async () => {
    await onUpdateProject({
      branch: branchInput,
      syncIntervalMinutes: syncInterval,
      githubPat: patInput || undefined,
    });
    setPatInput('');
    alert('Repository settings saved successfully.');
  };

  const handleCopyToLocation = async () => {
    const dest = additionalPathInput.trim() || project.additionalCopyPath;
    if (!dest) {
      alert('Please specify a destination folder path on the VPS.');
      return;
    }
    setIsCopying(true);
    setCopyMessage(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/copy-to-location`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetPath: dest,
          copyMode: copyModeInput,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to copy project');
      setCopyMessage(`Copied ${data.filesCount} files to "${dest}" in ${data.durationMs}ms`);
      await onUpdateProject({
        additionalCopyPath: dest,
        copyMode: copyModeInput,
        autoCopyOnSync: autoCopyInput,
      });
    } catch (err: any) {
      setCopyMessage(`Copy failed: ${err.message || 'Error'}`);
    } finally {
      setIsCopying(false);
    }
  };

  const handleSaveAdditionalLocation = async () => {
    await onUpdateProject({
      additionalCopyPath: additionalPathInput.trim() || undefined,
      copyMode: copyModeInput,
      autoCopyOnSync: autoCopyInput,
    });
    alert('Additional copy location settings updated.');
  };

  return (
    <div className="flex flex-col gap-6 p-2 max-w-4xl mx-auto">
      {/* Sync Status Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-slate-100">{project.name}</h2>
            <span
              className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
                project.syncStatus === 'SYNCING'
                  ? 'bg-amber-950 text-amber-300 border border-amber-800 animate-pulse'
                  : project.syncStatus === 'ERROR'
                  ? 'bg-rose-950 text-rose-300 border border-rose-800'
                  : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
              }`}
            >
              {project.syncStatus === 'SYNCING'
                ? 'Syncing Delta...'
                : project.syncStatus === 'ERROR'
                ? 'Sync Failed'
                : 'Synced & Active'}
            </span>
            {project.isLocalRepo ? (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-sky-950 text-sky-300 border border-sky-800">
                Local VPS Clone
              </span>
            ) : (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-indigo-950 text-indigo-300 border border-indigo-800">
                Remote Git
              </span>
            )}
          </div>

          {project.isLocalRepo && (
            <div className="text-[11px] text-slate-400 font-mono">
              Source Path: <span className="text-slate-200">{project.localSourcePath || project.repoUrl}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 font-mono mt-1">
            <span className="flex items-center gap-1 text-slate-300">
              Branch: <span className="text-indigo-400 font-semibold">{project.branch}</span>
            </span>
            <span>•</span>
            <span>
              HEAD: <span className="text-indigo-300">{project.lastSyncedSha ? project.lastSyncedSha.slice(0, 7) : 'Not synced yet'}</span>
            </span>
            <span>•</span>
            <span className="flex items-center gap-1 text-emerald-400 font-medium">
              <FileCode2 size={13} />
              <span>{project.totalFiles ? `${project.totalFiles} files in Git` : 'Files synced'}</span>
            </span>
            <span>•</span>
            <span className="flex items-center gap-1 text-slate-400">
              <HardDrive size={13} />
              <span>{Math.round(project.diskUsageBytes / 1024)} KB</span>
            </span>
          </div>

          {syncMessage && (
            <p className="text-xs text-indigo-400 mt-2 font-medium">{syncMessage}</p>
          )}
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={() => handleSync(false)}
            disabled={isSyncing}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium px-4 py-2.5 rounded-xl transition-colors text-xs flex items-center gap-2 shadow-lg shadow-indigo-600/20"
          >
            <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
            <span>{isSyncing ? 'Syncing...' : 'Trigger Git Sync'}</span>
          </button>

          {project.hasGeminiKey && (
            <button
              onClick={() => handleSync(true)}
              disabled={isSyncing}
              title="Forces full re-indexing of all repository files into Gemini vector embeddings"
              className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 border border-slate-700 font-medium px-3.5 py-2.5 rounded-xl transition-colors text-xs flex items-center gap-1.5"
            >
              <Sparkles size={14} className="text-amber-400" />
              <span>Full AI Re-Index</span>
            </button>
          )}
        </div>
      </div>

      {/* Transparent Information Banner explaining Git vs AI Indexing */}
      {!project.hasGeminiKey ? (
        <div className="bg-sky-950/30 border border-sky-800/60 rounded-2xl p-5 flex items-start gap-3.5 text-xs text-sky-200 shadow-md">
          <Info className="text-sky-400 shrink-0 mt-0.5" size={18} />
          <div className="flex flex-col gap-1.5">
            <span className="font-semibold text-sky-100 text-sm">
              Git Repository is Fully Synced ({project.totalFiles || 'All'} files ready to view)
            </span>
            <p className="text-sky-300/80 leading-relaxed">
              All files from your repository are downloaded, authenticated, and ready to browse in the Viewer Portal subject to your ACL rules.
              The sync history column displays <code className="bg-sky-900/60 px-1 py-0.5 rounded text-sky-200 font-mono">0 files</code> under <strong>AI Vector Indexing</strong> because a Google Gemini API Key is not yet configured.
              To enable AI Semantic Q&A and document vector search, provide your Gemini API key in the <strong>Gemini BYOK & AI Settings</strong> tab.
            </p>
          </div>
        </div>
      ) : (
        <div className="bg-emerald-950/30 border border-emerald-800/60 rounded-2xl p-5 flex items-start gap-3.5 text-xs text-emerald-200 shadow-md">
          <CheckCircle className="text-emerald-400 shrink-0 mt-0.5" size={18} />
          <div className="flex flex-col gap-1.5">
            <span className="font-semibold text-emerald-100 text-sm">
              Gemini AI Semantic Vector Indexing Active
            </span>
            <p className="text-emerald-300/80 leading-relaxed">
              Your repository documents are vectorized with Gemini (<span className="font-mono text-emerald-200">{project.geminiEmbeddingModel}</span>). Viewers can use the AI RAG Assistant drawer with strict ACL-filtered citation boundaries.
            </p>
          </div>
        </div>
      )}

      {/* GitHub Configuration Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col gap-5">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">Git Repository & Credentials</h3>
          <p className="text-xs text-slate-400 mt-1">
            Configure target tracking branch and optional GitHub Personal Access Token (PAT) for private repositories.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-300">Target Branch</label>
            <input
              type="text"
              value={branchInput}
              onChange={(e) => setBranchInput(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-300">
              GitHub PAT (Contents: Read-only)
            </label>
            <input
              type="password"
              value={patInput}
              onChange={(e) => setPatInput(e.target.value)}
              placeholder={project.hasGithubPat ? '•••••••••••••••• (Encrypted at rest)' : 'ghp_xxxxxxxxxxxx'}
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="flex flex-col gap-1.5 md:col-span-2">
            <label className="text-xs font-medium text-slate-300">
              Periodic Sync Polling Interval
            </label>
            <select
              value={syncInterval}
              onChange={(e) => setSyncInterval(Number(e.target.value))}
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              <option value={0}>Disabled (Manual & Webhook triggers only)</option>
              <option value={15}>Every 15 minutes</option>
              <option value={60}>Every 1 hour</option>
              <option value={360}>Every 6 hours</option>
              <option value={1440}>Every 24 hours</option>
            </select>
          </div>
        </div>

        <button
          onClick={handleSaveSettings}
          className="self-start bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium px-4 py-2 rounded-xl text-xs transition-colors"
        >
          Update Repository Settings
        </button>
      </div>

      {/* Additional Copy Location Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col gap-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <FolderSync size={16} className="text-indigo-400" />
              <h3 className="text-sm font-semibold text-slate-100">Additional Filesystem Location</h3>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Export and copy the materialized repository files to an additional target directory path on the VPS.
            </p>
          </div>
          {project.lastCopiedAt && (
            <div className="text-[11px] text-slate-400 font-mono">
              Last Copied:{' '}
              <span className={project.lastCopyStatus === 'SUCCESS' ? 'text-emerald-400' : 'text-rose-400'}>
                {new Date(project.lastCopiedAt).toLocaleTimeString()} ({project.lastCopyStatus})
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-300">Target Directory on VPS</label>
            <input
              type="text"
              value={additionalPathInput}
              onChange={(e) => setAdditionalPathInput(e.target.value)}
              placeholder="/home/agydev/backup/govlabs11-pmo"
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
            <div className="flex items-center gap-4 text-xs text-slate-300">
              <span className="text-slate-400 text-[11px]">Format:</span>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="tabCopyMode"
                  checked={copyModeInput === 'WORKING_TREE'}
                  onChange={() => setCopyModeInput('WORKING_TREE')}
                  className="text-indigo-600 focus:ring-0"
                />
                <span className="text-[11px]">Clean Export</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="tabCopyMode"
                  checked={copyModeInput === 'FULL_REPO'}
                  onChange={() => setCopyModeInput('FULL_REPO')}
                  className="text-indigo-600 focus:ring-0"
                />
                <span className="text-[11px]">Full Repo (.git)</span>
              </label>
            </div>

            <label className="flex items-center gap-2 cursor-pointer text-[11px] text-slate-400">
              <input
                type="checkbox"
                checked={autoCopyInput}
                onChange={(e) => setAutoCopyInput(e.target.checked)}
                className="rounded border-slate-700 text-indigo-600 focus:ring-0"
              />
              <span>Auto-copy on Git sync</span>
            </label>
          </div>

          {copyMessage && (
            <p className="text-xs text-indigo-400 font-medium">{copyMessage}</p>
          )}

          <div className="flex items-center gap-2.5 pt-2">
            <button
              type="button"
              disabled={isCopying || !additionalPathInput.trim()}
              onClick={handleCopyToLocation}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-medium transition-colors flex items-center gap-1.5 shadow-md shadow-indigo-600/20"
            >
              <FolderSync size={13} className={isCopying ? 'animate-spin' : ''} />
              <span>{isCopying ? 'Copying...' : 'Copy to Location Now'}</span>
            </button>
            <button
              type="button"
              onClick={handleSaveAdditionalLocation}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium transition-colors"
            >
              Save Settings
            </button>
          </div>
        </div>
      </div>

      {/* GitHub Webhook Trigger Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col gap-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">GitHub Webhook Push Trigger</h3>
          <p className="text-xs text-slate-400 mt-1">
            Add this Payload URL to your GitHub repository Webhooks settings (content type: <span className="font-mono text-slate-300">application/json</span>, event: <span className="font-mono text-slate-300">Just the push event</span>).
          </p>
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            readOnly
            value={webhookUrl}
            className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-slate-300 select-all focus:outline-none"
          />
          <button
            onClick={handleCopyWebhook}
            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs transition-colors flex items-center gap-1.5"
          >
            {copiedWebhook ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
            <span>{copiedWebhook ? 'Copied' : 'Copy URL'}</span>
          </button>
        </div>
      </div>

      {/* Sync History Logs Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col gap-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">Git & AI Sync History</h3>
          <p className="text-xs text-slate-400 mt-1">
            Tracks commit delta fetches and incremental AI vector embeddings generation.
          </p>
        </div>

        {syncLogs.length === 0 ? (
          <p className="text-xs text-slate-500">No sync events recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2.5 px-3 font-medium">Trigger</th>
                  <th className="py-2.5 px-3 font-medium">Commit SHA</th>
                  <th className="py-2.5 px-3 font-medium">Git Repo Files</th>
                  <th className="py-2.5 px-3 font-medium">AI Vectors (BYOK)</th>
                  <th className="py-2.5 px-3 font-medium">Duration</th>
                  <th className="py-2.5 px-3 font-medium">Status</th>
                  <th className="py-2.5 px-3 font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {syncLogs.map((log) => (
                  <tr key={log.id} className="border-b border-slate-800/60 font-mono text-[11px]">
                    <td className="py-2.5 px-3 text-slate-300">{log.trigger_type}</td>
                    <td className="py-2.5 px-3 text-indigo-400 font-semibold">
                      {log.new_sha ? log.new_sha.slice(0, 7) : log.old_sha ? log.old_sha.slice(0, 7) : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-emerald-400 font-medium">
                      {log.total_files ? `${log.total_files} files` : project.totalFiles ? `${project.totalFiles} files` : 'Synced'}
                    </td>
                    <td className="py-2.5 px-3">
                      {log.indexed_files > 0 ? (
                        <span className="text-sky-300 font-semibold">{log.indexed_files} files indexed</span>
                      ) : (
                        <span className="text-slate-500">
                          0 files {!project.hasGeminiKey ? '(BYOK idle)' : '(no changes)'}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-slate-400">{log.duration_ms}ms</td>
                    <td className="py-2.5 px-3">
                      {log.status === 'SUCCESS' ? (
                        <span className="text-emerald-400 flex items-center gap-1 font-sans">
                          <CheckCircle size={12} /> Success
                        </span>
                      ) : (
                        <span className="text-rose-400 flex items-center gap-1 font-sans" title={log.error_message}>
                          <AlertCircle size={12} /> Error
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-slate-500 font-sans">
                      {new Date(log.created_at).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Danger Zone: Delete Project / Unpublish Project */}
      {onDeleteProject && (
        <div className="bg-rose-950/20 border border-rose-900/40 rounded-2xl p-6 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-rose-300">Danger Zone</h3>
            <p className="text-xs text-rose-400/80 mt-1">
              {project.isLocalRepo
                ? 'Unpublish this local project, remove vector index and permissions. Local files on disk will remain untouched.'
                : 'Permanently remove this project, repository sync logs, ACL viewer groups, and permissions.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onDeleteProject}
            className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-medium rounded-xl text-xs transition-colors shrink-0 flex items-center gap-1.5 shadow-sm"
          >
            <Trash2 size={14} />
            <span>{project.isLocalRepo ? 'Unpublish Project' : 'Delete Project'}</span>
          </button>
        </div>
      )}
    </div>
  );
};
