import React, { useState } from 'react';
import { GitBranch, RefreshCw, Copy, Check, GitCommit, CheckCircle, AlertCircle, Clock } from 'lucide-react';
import { ProjectSummary } from '@/shared/types.js';

export const SyncAndRepoTab: React.FC<{
  project: ProjectSummary;
  syncLogs: any[];
  onTriggerSync: () => Promise<void>;
  onUpdateProject: (data: Partial<ProjectSummary> & { githubPat?: string; webhookSecret?: string }) => Promise<void>;
}> = ({ project, syncLogs, onTriggerSync, onUpdateProject }) => {
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [patInput, setPatInput] = useState('');
  const [branchInput, setBranchInput] = useState(project.branch);
  const [syncInterval, setSyncInterval] = useState(project.syncIntervalMinutes);

  const webhookUrl = `${window.location.origin}/api/webhooks/github/${project.id}`;

  const handleSyncNow = async () => {
    setIsSyncing(true);
    setSyncMessage(null);
    try {
      await onTriggerSync();
      setSyncMessage('Sync completed successfully.');
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

  return (
    <div className="flex flex-col gap-6 p-2 max-w-4xl mx-auto">
      {/* Sync Status Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
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
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-400 font-mono mt-1">
            <span>Branch: {project.branch}</span>
            <span>•</span>
            <span>
              HEAD:{' '}
              {project.lastSyncedSha ? project.lastSyncedSha.slice(0, 7) : 'Not synced yet'}
            </span>
            <span>•</span>
            <span>Disk: {Math.round(project.diskUsageBytes / 1024)} KB</span>
          </div>
          {syncMessage && (
            <p className="text-xs text-indigo-400 mt-2">{syncMessage}</p>
          )}
        </div>

        <button
          onClick={handleSyncNow}
          disabled={isSyncing}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium px-5 py-2.5 rounded-xl transition-colors text-xs flex items-center gap-2 shadow-lg shadow-indigo-600/20 shrink-0"
        >
          <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
          <span>{isSyncing ? 'Syncing...' : 'Trigger Delta Sync'}</span>
        </button>
      </div>

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
        <h3 className="text-sm font-semibold text-slate-100">Delta Sync History</h3>
        {syncLogs.length === 0 ? (
          <p className="text-xs text-slate-500">No sync events recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2 px-3 font-medium">Trigger</th>
                  <th className="py-2 px-3 font-medium">Old Commit</th>
                  <th className="py-2 px-3 font-medium">New Commit</th>
                  <th className="py-2 px-3 font-medium">Indexed</th>
                  <th className="py-2 px-3 font-medium">Duration</th>
                  <th className="py-2 px-3 font-medium">Status</th>
                  <th className="py-2 px-3 font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {syncLogs.map((log) => (
                  <tr key={log.id} className="border-b border-slate-800/60 font-mono text-[11px]">
                    <td className="py-2.5 px-3 text-slate-300">{log.trigger_type}</td>
                    <td className="py-2.5 px-3 text-slate-500">
                      {log.old_sha ? log.old_sha.slice(0, 7) : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-indigo-400">
                      {log.new_sha ? log.new_sha.slice(0, 7) : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-slate-300">{log.indexed_files} files</td>
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
    </div>
  );
};
