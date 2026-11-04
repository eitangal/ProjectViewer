import React, { useState } from 'react';
import {
  ShieldAlert,
  Server,
  HardDrive,
  Users,
  Mail,
  UserCheck,
  UserX,
  Plus,
  RefreshCw,
  LogOut,
  Activity,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

export const SysAdminConsole: React.FC<{
  publishers: any[];
  telemetry: any;
  onInvitePublisher: (data: { email: string; maxRepos?: number; maxDiskQuotaBytes?: number; maxViewers?: number }) => Promise<void>;
  onUpdatePublisher: (userId: string, data: any) => Promise<void>;
  onRefreshTelemetry: () => Promise<void>;
  onLogout: () => void;
}> = ({
  publishers,
  telemetry,
  onInvitePublisher,
  onUpdatePublisher,
  onRefreshTelemetry,
  onLogout,
}) => {
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [email, setEmail] = useState('');
  const [maxRepos, setMaxRepos] = useState(5);
  const [maxDiskMb, setMaxDiskMb] = useState(500);
  const [maxViewers, setMaxViewers] = useState(50);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setIsSubmitting(true);
    try {
      await onInvitePublisher({
        email: email.trim(),
        maxRepos,
        maxDiskQuotaBytes: maxDiskMb * 1024 * 1024,
        maxViewers,
      });
      setShowInviteModal(false);
      setEmail('');
      alert(`Invitation sent to ${email}`);
    } catch (err: any) {
      alert(`Error inviting publisher: ${err.message || 'Failed'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const stats = telemetry?.stats || {
    totalRepos: 0,
    totalDiskUsageBytes: 0,
    totalVectors: 0,
    totalUsers: 0,
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-950 text-slate-100">
      {/* Top Header */}
      <header className="h-16 border-b border-slate-800 bg-slate-900/90 backdrop-blur-md flex items-center justify-between px-6 shrink-0 z-30">
        <div className="flex items-center gap-3">
          <ShieldAlert size={20} className="text-rose-400" />
          <h1 className="text-sm font-semibold text-slate-100 tracking-wide">
            Platform Operator & Governance Console (SysAdmin)
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowInviteModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-medium transition-colors shadow-lg shadow-indigo-600/20"
          >
            <Plus size={14} />
            <span>Onboard Publisher</span>
          </button>

          <button
            onClick={onRefreshTelemetry}
            title="Refresh Telemetry"
            className="p-2 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <RefreshCw size={15} />
          </button>

          <button
            onClick={onLogout}
            title="Sign Out"
            className="p-2 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors"
          >
            <LogOut size={15} />
          </button>
        </div>
      </header>

      {/* Main Dashboard Canvas */}
      <main className="flex-1 overflow-y-auto p-6 md:p-8 bg-slate-950 flex flex-col gap-8 max-w-6xl mx-auto w-full">
        {/* Telemetry Stat Cards (SYS-03) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex items-center gap-4">
            <div className="p-3 rounded-xl bg-indigo-950 text-indigo-400 border border-indigo-900/60">
              <Server size={20} />
            </div>
            <div>
              <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">Total Repositories</p>
              <p className="text-xl font-bold text-slate-100 font-mono mt-0.5">{stats.totalRepos}</p>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex items-center gap-4">
            <div className="p-3 rounded-xl bg-emerald-950 text-emerald-400 border border-emerald-900/60">
              <HardDrive size={20} />
            </div>
            <div>
              <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">Bare Repos Storage</p>
              <p className="text-xl font-bold text-slate-100 font-mono mt-0.5">
                {Math.round(stats.totalDiskUsageBytes / 1024 / 1024)} MB
              </p>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex items-center gap-4">
            <div className="p-3 rounded-xl bg-sky-950 text-sky-400 border border-sky-900/60">
              <Activity size={20} />
            </div>
            <div>
              <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">Vector Chunks (vec0)</p>
              <p className="text-xl font-bold text-slate-100 font-mono mt-0.5">{stats.totalVectors}</p>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex items-center gap-4">
            <div className="p-3 rounded-xl bg-amber-950 text-amber-400 border border-amber-900/60">
              <Users size={20} />
            </div>
            <div>
              <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">Registered Users</p>
              <p className="text-xl font-bold text-slate-100 font-mono mt-0.5">{stats.totalUsers}</p>
            </div>
          </div>
        </div>

        {/* Tenant Governance Table (SYS-02) */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-100">Project Publishers Governance & Quotas</h3>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2.5 px-3 font-medium">Publisher Email</th>
                  <th className="py-2.5 px-3 font-medium">Status</th>
                  <th className="py-2.5 px-3 font-medium">Projects</th>
                  <th className="py-2.5 px-3 font-medium">Disk Quota</th>
                  <th className="py-2.5 px-3 font-medium">Max Viewers</th>
                  <th className="py-2.5 px-3 font-medium text-end">Action</th>
                </tr>
              </thead>
              <tbody>
                {publishers.map((pub) => (
                  <tr key={pub.id} className="border-b border-slate-800/60">
                    <td className="py-3 px-3 font-mono text-slate-200">{pub.email}</td>
                    <td className="py-3 px-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          pub.status === 'ACTIVE'
                            ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                            : 'bg-rose-950 text-rose-400 border border-rose-800'
                        }`}
                      >
                        {pub.status}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-slate-300 font-mono">
                      {pub.projectCount} / {pub.maxRepos} repos
                    </td>
                    <td className="py-3 px-3 text-slate-300 font-mono">
                      {Math.round((pub.totalDiskUsageBytes || 0) / 1024 / 1024)} MB /{' '}
                      {Math.round(pub.maxDiskQuotaBytes / 1024 / 1024)} MB
                    </td>
                    <td className="py-3 px-3 text-slate-300 font-mono">{pub.maxViewers}</td>
                    <td className="py-3 px-3 text-end">
                      {pub.status === 'ACTIVE' ? (
                        <button
                          onClick={() => onUpdatePublisher(pub.id, { status: 'SUSPENDED' })}
                          className="px-2.5 py-1 rounded-lg bg-rose-950/40 text-rose-300 hover:bg-rose-900/60 border border-rose-800/80 text-[11px] transition-colors"
                        >
                          Suspend
                        </button>
                      ) : (
                        <button
                          onClick={() => onUpdatePublisher(pub.id, { status: 'ACTIVE' })}
                          className="px-2.5 py-1 rounded-lg bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/60 border border-emerald-800/80 text-[11px] transition-colors"
                        >
                          Activate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Email Delivery Audit Log (SYS-03) */}
        {telemetry?.recentEmailLogs && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col gap-4">
            <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <Mail size={16} className="text-indigo-400" />
              <span>Transactional Email Delivery Statuses</span>
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2 px-3 font-medium">Recipient</th>
                    <th className="py-2 px-3 font-medium">Subject</th>
                    <th className="py-2 px-3 font-medium">Status</th>
                    <th className="py-2 px-3 font-medium">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {telemetry.recentEmailLogs.map((log: any) => (
                    <tr key={log.id} className="border-b border-slate-800/60 font-mono text-[11px]">
                      <td className="py-2 px-3 text-slate-300">{log.recipient_email}</td>
                      <td className="py-2 px-3 text-slate-400">{log.purpose}</td>
                      <td className="py-2 px-3">
                        {log.status === 'SENT' ? (
                          <span className="text-emerald-400 flex items-center gap-1">
                            <CheckCircle2 size={12} /> Sent
                          </span>
                        ) : (
                          <span className="text-rose-400 flex items-center gap-1" title={log.error_message}>
                            <AlertCircle size={12} /> Failed
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-slate-500 font-sans">
                        {new Date(log.created_at).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* Onboard Publisher Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleInvite}
            className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full flex flex-col gap-4 shadow-2xl"
          >
            <h3 className="text-base font-semibold text-slate-100">Onboard Project Publisher</h3>
            <p className="text-xs text-slate-400">
              Generates a time-bound verification challenge and sends an onboarding invite to the publisher.
            </p>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-300">Publisher Email Address</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="techlead@org.com"
                className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-300">Max Repos</label>
                <input
                  type="number"
                  value={maxRepos}
                  onChange={(e) => setMaxRepos(Number(e.target.value))}
                  className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-300">Disk (MB)</label>
                <input
                  type="number"
                  value={maxDiskMb}
                  onChange={(e) => setMaxDiskMb(Number(e.target.value))}
                  className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-300">Max Viewers</label>
                <input
                  type="number"
                  value={maxViewers}
                  onChange={(e) => setMaxViewers(Number(e.target.value))}
                  className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 mt-2">
              <button
                type="button"
                onClick={() => setShowInviteModal(false)}
                className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:bg-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-4 py-2 rounded-xl text-xs transition-colors"
              >
                {isSubmitting ? 'Sending...' : 'Send Publisher Invite'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
