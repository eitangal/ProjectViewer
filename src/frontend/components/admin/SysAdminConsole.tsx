import React, { useState, useEffect } from 'react';
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
  Copy,
  Check,
  Send,
  Settings,
  Key,
} from 'lucide-react';

export const SysAdminConsole: React.FC<{
  publishers: any[];
  telemetry: any;
  onInvitePublisher: (data: {
    email: string;
    maxRepos?: number;
    maxDiskQuotaBytes?: number;
    maxViewers?: number;
  }) => Promise<any>;
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
  const [activeTab, setActiveTab] = useState<'overview' | 'smtp'>('overview');
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [email, setEmail] = useState('');
  const [maxRepos, setMaxRepos] = useState(5);
  const [maxDiskMb, setMaxDiskMb] = useState(500);
  const [maxViewers, setMaxViewers] = useState(50);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Invite Result Modal State
  const [inviteResult, setInviteResult] = useState<{
    email: string;
    magicLinkUrl: string;
    otpCode: string;
    emailSent: boolean;
    error?: string;
  } | null>(null);

  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedOtp, setCopiedOtp] = useState(false);

  // SMTP Settings State
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [smtpFrom, setSmtpFrom] = useState('');
  const [isSmtpConfigured, setIsSmtpConfigured] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [isTestingSmtp, setIsTestingSmtp] = useState(false);
  const [smtpTestResult, setSmtpTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isSavingSmtp, setIsSavingSmtp] = useState(false);

  useEffect(() => {
    fetch('/api/admin/smtp')
      .then((r) => r.json())
      .then((data) => {
        setIsSmtpConfigured(!!data.isConfigured);
        if (data.config) {
          setSmtpHost(data.config.host || '');
          setSmtpPort(data.config.port || 587);
          setSmtpSecure(!!data.config.secure);
          setSmtpUser(data.config.user || '');
          setSmtpPass(data.config.pass || '');
          setSmtpFrom(data.config.from || '');
        }
      })
      .catch(() => {});
  }, []);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setIsSubmitting(true);
    try {
      const res = await onInvitePublisher({
        email: email.trim(),
        maxRepos,
        maxDiskQuotaBytes: maxDiskMb * 1024 * 1024,
        maxViewers,
      });

      setShowInviteModal(false);
      setEmail('');

      // Show the invitation details with copy options
      setInviteResult({
        email: res.email || email.trim(),
        magicLinkUrl: res.magicLinkUrl || '',
        otpCode: res.otpCode || '',
        emailSent: !!res.emailSent,
        error: res.error,
      });
    } catch (err: any) {
      alert(`Error inviting publisher: ${err.message || 'Failed'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveSmtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingSmtp(true);
    setSmtpTestResult(null);
    try {
      const res = await fetch('/api/admin/smtp', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: smtpHost,
          port: smtpPort,
          secure: smtpSecure,
          user: smtpUser,
          pass: smtpPass,
          from: smtpFrom,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setIsSmtpConfigured(true);
      alert('SMTP settings saved successfully.');
    } catch (err: any) {
      alert(`Failed to save SMTP: ${err.message}`);
    } finally {
      setIsSavingSmtp(false);
    }
  };

  const handleTestSmtp = async () => {
    if (!testEmail.trim() || !smtpHost.trim()) {
      alert('Please provide SMTP Host and a recipient email for testing.');
      return;
    }
    setIsTestingSmtp(true);
    setSmtpTestResult(null);
    try {
      const res = await fetch('/api/admin/smtp/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: smtpHost,
          port: smtpPort,
          secure: smtpSecure,
          user: smtpUser,
          pass: smtpPass,
          from: smtpFrom,
          testEmail: testEmail.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setSmtpTestResult({ success: true, message: json.message || 'Test email dispatched successfully.' });
    } catch (err: any) {
      setSmtpTestResult({ success: false, message: err.message || 'SMTP test failed.' });
    } finally {
      setIsTestingSmtp(false);
    }
  };

  const copyToClipboard = (text: string, type: 'link' | 'otp') => {
    navigator.clipboard.writeText(text);
    if (type === 'link') {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } else {
      setCopiedOtp(true);
      setTimeout(() => setCopiedOtp(false), 2000);
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

          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 ms-4 text-xs">
            <button
              onClick={() => setActiveTab('overview')}
              className={`px-3 py-1 rounded-lg transition-colors ${
                activeTab === 'overview'
                  ? 'bg-indigo-600 text-white font-medium'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Overview & Quotas
            </button>
            <button
              onClick={() => setActiveTab('smtp')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg transition-colors ${
                activeTab === 'smtp'
                  ? 'bg-indigo-600 text-white font-medium'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Mail size={13} />
              <span>SMTP & Email Setup</span>
              {!isSmtpConfigured && (
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" title="SMTP not configured" />
              )}
            </button>
          </div>
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
        {activeTab === 'smtp' ? (
          /* SMTP Configuration Tab */
          <div className="flex flex-col gap-6">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col gap-5">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                    <Mail size={18} className="text-indigo-400" />
                    <span>Transactional Email & SMTP Delivery Configuration</span>
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    Configure your outbound SMTP mail server (Gmail, SendGrid, Mailgun, AWS SES, or standard relay) so Publisher and Viewer invitations are dispatched directly to inboxes.
                  </p>
                </div>

                <span
                  className={`text-xs px-3 py-1 rounded-full font-medium flex items-center gap-1.5 ${
                    isSmtpConfigured
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                      : 'bg-amber-950 text-amber-300 border border-amber-800'
                  }`}
                >
                  {isSmtpConfigured ? (
                    <>
                      <CheckCircle2 size={13} />
                      <span>SMTP Configured</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle size={13} />
                      <span>SMTP Not Configured (Console Fallback)</span>
                    </>
                  )}
                </span>
              </div>

              {!isSmtpConfigured && (
                <div className="bg-amber-950/40 border border-amber-800/80 rounded-xl p-4 text-xs text-amber-200 flex items-start gap-3">
                  <AlertCircle size={18} className="text-amber-400 shrink-0 mt-0.5" />
                  <p className="leading-relaxed">
                    <strong>Notice:</strong> Without SMTP credentials, invitation emails are not sent over the internet to recipient inboxes. Invitations will still be created, but you must manually copy the 1-click Magic Link or 6-digit OTP code to share with the invited user.
                  </p>
                </div>
              )}

              <form onSubmit={handleSaveSmtp} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-slate-300">SMTP Host</label>
                  <input
                    type="text"
                    required
                    value={smtpHost}
                    onChange={(e) => setSmtpHost(e.target.value)}
                    placeholder="smtp.gmail.com or smtp.sendgrid.net"
                    className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-slate-300">SMTP Port</label>
                  <input
                    type="number"
                    required
                    value={smtpPort}
                    onChange={(e) => setSmtpPort(Number(e.target.value))}
                    placeholder="587"
                    className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-slate-300">SMTP Username / Email</label>
                  <input
                    type="text"
                    value={smtpUser}
                    onChange={(e) => setSmtpUser(e.target.value)}
                    placeholder="apikey or your-email@gmail.com"
                    className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-slate-300">SMTP Password / App Password</label>
                  <input
                    type="password"
                    value={smtpPass}
                    onChange={(e) => setSmtpPass(e.target.value)}
                    placeholder="••••••••••••••••"
                    className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-slate-300">From Sender Address</label>
                  <input
                    type="text"
                    value={smtpFrom}
                    onChange={(e) => setSmtpFrom(e.target.value)}
                    placeholder="portal@yourdomain.com or Your Name <you@domain.com>"
                    className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="flex items-center gap-2 pt-6">
                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={smtpSecure}
                      onChange={(e) => setSmtpSecure(e.target.checked)}
                      className="rounded bg-slate-950 border-slate-800 text-indigo-600 focus:ring-0"
                    />
                    <span>Use SSL / TLS (typically Port 465; uncheck for 587 STARTTLS)</span>
                  </label>
                </div>

                <div className="md:col-span-2 pt-2">
                  <button
                    type="submit"
                    disabled={isSavingSmtp}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-5 py-2 rounded-xl text-xs transition-colors"
                  >
                    {isSavingSmtp ? 'Saving Settings...' : 'Save SMTP Settings'}
                  </button>
                </div>
              </form>

              {/* SMTP Test Tool */}
              <div className="border-t border-slate-800 pt-5 mt-2 flex flex-col gap-3">
                <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                  Test Email Delivery
                </h3>
                <div className="flex gap-2 max-w-lg">
                  <input
                    type="email"
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                    placeholder="test-recipient@example.com"
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={handleTestSmtp}
                    disabled={isTestingSmtp}
                    className="flex items-center gap-1.5 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-medium transition-colors shrink-0"
                  >
                    <Send size={13} />
                    <span>{isTestingSmtp ? 'Testing...' : 'Send Test Email'}</span>
                  </button>
                </div>

                {smtpTestResult && (
                  <div
                    className={`p-3 rounded-xl text-xs flex items-center gap-2 border ${
                      smtpTestResult.success
                        ? 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
                        : 'bg-rose-950/60 border-rose-800 text-rose-300'
                    }`}
                  >
                    {smtpTestResult.success ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
                    <span>{smtpTestResult.message}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* Overview & Quotas Tab */
          <>
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
                            ) : log.status === 'NOT_CONFIGURED' ? (
                              <span className="text-amber-400 flex items-center gap-1" title={log.error_message}>
                                <AlertCircle size={12} /> SMTP Not Set
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
          </>
        )}
      </main>

      {/* Onboard Publisher Form Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleInvite}
            className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full flex flex-col gap-4 shadow-2xl"
          >
            <h3 className="text-base font-semibold text-slate-100">Onboard Project Publisher</h3>
            <p className="text-xs text-slate-400">
              Generates a time-bound verification challenge and creates publisher access permissions.
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
                {isSubmitting ? 'Onboarding...' : 'Onboard Publisher'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Invite Result Modal (with Magic Link & OTP Copy) */}
      {inviteResult && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-lg w-full flex flex-col gap-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className={`p-2.5 rounded-xl ${inviteResult.emailSent ? 'bg-emerald-950 text-emerald-400' : 'bg-amber-950 text-amber-400'}`}>
                {inviteResult.emailSent ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-100">
                  Publisher Onboarding Created
                </h3>
                <p className="text-xs text-slate-400">
                  Target Account: <span className="font-mono text-slate-200">{inviteResult.email}</span>
                </p>
              </div>
            </div>

            {inviteResult.emailSent ? (
              <div className="bg-emerald-950/40 border border-emerald-800/80 rounded-xl p-3 text-xs text-emerald-200">
                ✅ Invitation email dispatched successfully to recipient inbox.
              </div>
            ) : (
              <div className="bg-amber-950/40 border border-amber-800/80 rounded-xl p-3 text-xs text-amber-200 flex flex-col gap-1">
                <span className="font-semibold text-amber-300">
                  ⚠️ SMTP server is not configured.
                </span>
                <span>
                  The invitation was not sent over the internet. You can copy the 1-click Direct Link or 6-digit OTP code below to share directly with the user:
                </span>
              </div>
            )}

            {/* Magic Link */}
            {inviteResult.magicLinkUrl && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-300">1-Click Direct Access Link</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={inviteResult.magicLinkUrl}
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300 font-mono select-all focus:outline-none"
                  />
                  <button
                    onClick={() => copyToClipboard(inviteResult.magicLinkUrl, 'link')}
                    className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs transition-colors shrink-0"
                  >
                    {copiedLink ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                    <span>{copiedLink ? 'Copied' : 'Copy Link'}</span>
                  </button>
                </div>
              </div>
            )}

            {/* 6-digit OTP Code */}
            {inviteResult.otpCode && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-300">6-Digit Verification Code (OTP)</label>
                <div className="flex items-center justify-between bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5">
                  <span className="font-mono text-base font-bold tracking-widest text-indigo-400">
                    {inviteResult.otpCode}
                  </span>
                  <button
                    onClick={() => copyToClipboard(inviteResult.otpCode, 'otp')}
                    className="flex items-center gap-1.5 px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs transition-colors"
                  >
                    {copiedOtp ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                    <span>{copiedOtp ? 'Copied' : 'Copy Code'}</span>
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              {!isSmtpConfigured && (
                <button
                  onClick={() => {
                    setInviteResult(null);
                    setActiveTab('smtp');
                  }}
                  className="text-xs text-indigo-400 hover:underline flex items-center gap-1"
                >
                  <Settings size={13} />
                  <span>Configure SMTP Server</span>
                </button>
              )}
              <button
                onClick={() => setInviteResult(null)}
                className="ms-auto bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-5 py-2 rounded-xl text-xs transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
