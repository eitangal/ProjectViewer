import React, { useState, useEffect } from 'react';
import {
  Menu,
  ChevronRight,
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
  Sparkles,
  ExternalLink,
} from 'lucide-react';
import { ThemeAndUserControls } from '../common/ThemeAndUserControls.js';
import { useViewerStore } from '../../store/useViewerStore.js';
import { RagAssistantDrawer } from '../viewer/RagAssistantDrawer.js';

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
  user?: { email: string; role?: string; globalRole?: string } | null;
  onSwitchView?: (view: 'admin' | 'publisher' | 'viewer') => void;
  activeProjectId?: string | null;
  embedded?: boolean;
  tab?: 'overview' | 'smtp';
  showInviteModalControlled?: boolean;
  onOpenInviteModal?: () => void;
  onCloseInviteModal?: () => void;
}> = ({
  publishers,
  telemetry,
  onInvitePublisher,
  onUpdatePublisher,
  onRefreshTelemetry,
  onLogout,
  user,
  onSwitchView,
  activeProjectId,
  embedded = false,
  tab,
  showInviteModalControlled,
  onOpenInviteModal,
  onCloseInviteModal,
}) => {
  const {
    isSidebarOpen,
    toggleSidebar,
    isAiDrawerOpen,
    toggleAiDrawer,
  } = useViewerStore();
  const [internalActiveTab, setInternalActiveTab] = useState<'overview' | 'smtp'>('overview');
  const activeTab = tab || internalActiveTab;
  const setActiveTab = setInternalActiveTab;

  const [internalShowInviteModal, setInternalShowInviteModal] = useState(false);

  useEffect(() => {
    if (showInviteModalControlled !== undefined) {
      setInternalShowInviteModal(showInviteModalControlled);
    }
  }, [showInviteModalControlled]);

  const showInviteModal = Boolean(showInviteModalControlled || internalShowInviteModal);
  const setShowInviteModal = (val: boolean) => {
    setInternalShowInviteModal(val);
    if (val && onOpenInviteModal) onOpenInviteModal();
    if (!val && onCloseInviteModal) onCloseInviteModal();
  };
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

  // Brevo API Settings State
  const [brevoApiKey, setBrevoApiKey] = useState('');
  const [brevoSenderEmail, setBrevoSenderEmail] = useState('');
  const [brevoSenderName, setBrevoSenderName] = useState('GitLens Portal');
  const [isBrevoConfigured, setIsBrevoConfigured] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [isTestingBrevo, setIsTestingBrevo] = useState(false);
  const [brevoTestResult, setBrevoTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isSavingBrevo, setIsSavingBrevo] = useState(false);

  useEffect(() => {
    fetch('/api/admin/email')
      .then((r) => r.json())
      .then((data) => {
        setIsBrevoConfigured(!!data.isConfigured);
        if (data.config) {
          setBrevoApiKey(data.config.apiKey || '');
          setBrevoSenderEmail(data.config.senderEmail || '');
          setBrevoSenderName(data.config.senderName || 'GitLens Portal');
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

  const handleSaveBrevo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!brevoApiKey.trim()) {
      alert('Please provide a Brevo API key.');
      return;
    }
    setIsSavingBrevo(true);
    setBrevoTestResult(null);
    try {
      const res = await fetch('/api/admin/email', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: brevoApiKey,
          senderEmail: brevoSenderEmail,
          senderName: brevoSenderName,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setIsBrevoConfigured(true);
      alert('Brevo API settings saved successfully.');
    } catch (err: any) {
      alert(`Failed to save Brevo API settings: ${err.message}`);
    } finally {
      setIsSavingBrevo(false);
    }
  };

  const handleTestBrevo = async () => {
    if (!testEmail.trim()) {
      alert('Please provide a test recipient email address.');
      return;
    }
    setIsTestingBrevo(true);
    setBrevoTestResult(null);
    try {
      const res = await fetch('/api/admin/email/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: brevoApiKey,
          senderEmail: brevoSenderEmail,
          senderName: brevoSenderName,
          testEmail: testEmail.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setBrevoTestResult({ success: true, message: json.message || 'Test email dispatched successfully via Brevo API.' });
    } catch (err: any) {
      setBrevoTestResult({ success: false, message: err.message || 'Brevo API test failed.' });
    } finally {
      setIsTestingBrevo(false);
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
              aria-label="Toggle Governance Navigation"
              title="Toggle Navigation Menu"
              className={`p-2 rounded-xl transition-colors ${
                isSidebarOpen ? 'bg-slate-800 text-slate-100 font-medium' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <Menu size={18} />
            </button>

            <div className="flex items-center gap-2 text-rose-400 font-semibold text-sm tracking-wide shrink-0">
              <ShieldAlert size={18} />
              <span className="hidden sm:inline">Platform Governance</span>
              <span className="sm:hidden">SysAdmin</span>
            </div>

            <div className="h-4 w-px bg-slate-800 hidden sm:block" />

            <span className="hidden md:inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-mono bg-rose-950/80 text-rose-300 border border-rose-800/60">
              Operator
            </span>
          </div>

          <div className="flex items-center gap-2 md:gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setShowInviteModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-medium transition-colors shadow-lg shadow-indigo-600/20"
            >
              <Plus size={14} />
              <span className="hidden sm:inline">Onboard Publisher</span>
              <span className="sm:hidden">Onboard</span>
            </button>

            <button
              type="button"
              onClick={onRefreshTelemetry}
              title="Refresh Telemetry"
              className="p-2 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            >
              <RefreshCw size={15} />
            </button>

            {/* AI Chat Drawer Toggle */}
            <button
              type="button"
              onClick={toggleAiDrawer}
              title={isAiDrawerOpen ? 'Close AI Assistant' : 'Open AI Assistant'}
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

      {/* Main Workspace Pane */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Left Collapsible Navigation Sidebar (w-72) */}
        {!embedded && isSidebarOpen && (
          <aside className="w-72 border-e border-slate-800 bg-slate-950 flex flex-col shrink-0 overflow-hidden h-full z-20">
            <div className="p-3 border-b border-slate-800/80 bg-slate-900/40">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Governance
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-rose-950 text-rose-300 border border-rose-800/80">
                  Root
                </span>
              </div>
              <p className="font-semibold text-xs text-slate-100 truncate mt-1">
                SysAdmin Governance
              </p>
            </div>

            <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
              <button
                type="button"
                onClick={() => setActiveTab('overview')}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors w-full text-start ${
                  activeTab === 'overview'
                    ? 'bg-indigo-600/20 text-indigo-300 border-s-2 border-indigo-500'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <Server size={15} className="shrink-0" />
                <span className="flex-1">Overview & Quotas</span>
                <ChevronRight size={13} className="text-slate-600" />
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('smtp')}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors w-full text-start ${
                  activeTab === 'smtp'
                    ? 'bg-indigo-600/20 text-indigo-300 border-s-2 border-indigo-500'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <Mail size={15} className="shrink-0" />
                <span className="flex-1">Brevo API Setup</span>
                {!isBrevoConfigured && (
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" title="Brevo API not configured" />
                )}
                <ChevronRight size={13} className="text-slate-600" />
              </button>
            </div>

            {/* Telemetry Summary Footer */}
            <div className="p-3 border-t border-slate-800 bg-slate-900/50 flex flex-col gap-1 text-[11px] text-slate-400">
              <div className="flex items-center justify-between">
                <span>Total Repos:</span>
                <span className="font-mono text-slate-200">{stats.totalRepos}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Total Users:</span>
                <span className="font-mono text-slate-200">{stats.totalUsers}</span>
              </div>
            </div>
          </aside>
        )}

        {/* Main Dashboard Canvas */}
        <main className="flex-1 overflow-y-auto p-6 md:p-8 bg-slate-950 flex flex-col gap-8 max-w-6xl mx-auto w-full min-w-0">
        {activeTab === 'smtp' ? (
          /* Brevo API Configuration Tab */
          <div className="flex flex-col gap-6">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col gap-5">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                    <Mail size={18} className="text-indigo-400" />
                    <span>Brevo Transactional Email Configuration (REST API)</span>
                    <span className="text-[11px] font-mono font-medium px-2.5 py-0.5 rounded-full bg-indigo-950 text-indigo-300 border border-indigo-800/80">
                      HTTPS REST API
                    </span>
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    Send passwordless onboarding invitations and Viewer 1-click magic links / OTPs directly via Brevo's HTTPS REST API using your Brevo API key.
                  </p>
                </div>

                <span
                  className={`text-xs px-3 py-1 rounded-full font-medium flex items-center gap-1.5 ${
                    isBrevoConfigured
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                      : 'bg-amber-950 text-amber-300 border border-amber-800'
                  }`}
                >
                  {isBrevoConfigured ? (
                    <>
                      <CheckCircle2 size={13} />
                      <span>Brevo API Configured</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle size={13} />
                      <span>Not Configured (Console Fallback)</span>
                    </>
                  )}
                </span>
              </div>

              {/* Brevo API Quick Setup Guide */}
              <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 flex flex-col gap-2.5 text-xs text-slate-300">
                <div className="flex items-center justify-between text-indigo-300 font-medium">
                  <span className="flex items-center gap-1.5">
                    <Sparkles size={14} className="text-indigo-400" />
                    Brevo REST API Credentials &amp; Requirements
                  </span>
                  <a
                    href="https://app.brevo.com"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-indigo-400 hover:underline flex items-center gap-1"
                  >
                    <span>Open Brevo Console</span>
                    <ExternalLink size={11} />
                  </a>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1 text-[11px]">
                  <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800 flex flex-col gap-1">
                    <span className="font-semibold text-slate-200">1. Brevo API Key</span>
                    <span className="text-slate-400">Navigate to <strong>SMTP &amp; API</strong> &rarr; <strong>API Keys</strong> tab. Click <em>Generate a new API key</em>. Key starts with <code className="text-indigo-300">xkeysib-...</code></span>
                  </div>
                  <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800 flex flex-col gap-1">
                    <span className="font-semibold text-slate-200">2. Verified Sender Email</span>
                    <span className="text-slate-400">Navigate to <strong>Senders &amp; IP</strong> &rarr; <strong>Senders</strong>. The sender email or domain must be verified in your Brevo account.</span>
                  </div>
                  <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800 flex flex-col gap-1">
                    <span className="font-semibold text-slate-200">3. Direct HTTPS Dispatch</span>
                    <span className="text-slate-400">Uses native HTTPS requests to <code className="text-indigo-300">api.brevo.com/v3/smtp/email</code>. No SMTP ports or socket restrictions.</span>
                  </div>
                </div>
              </div>

              {!isBrevoConfigured && (
                <div className="bg-amber-950/40 border border-amber-800/80 rounded-xl p-4 text-xs text-amber-200 flex items-start gap-3">
                  <AlertCircle size={18} className="text-amber-400 shrink-0 mt-0.5" />
                  <p className="leading-relaxed">
                    <strong>Notice:</strong> Without a Brevo API key, invitation emails are not dispatched over the internet. Invitations will still be created, and verification codes/links will be logged directly to the server console.
                  </p>
                </div>
              )}

              <form onSubmit={handleSaveBrevo} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5 md:col-span-2">
                  <label className="text-xs font-medium text-slate-300">Brevo API Key (starts with xkeysib-)</label>
                  <input
                    type="password"
                    required
                    value={brevoApiKey}
                    onChange={(e) => setBrevoApiKey(e.target.value)}
                    placeholder="xkeysib-••••••••••••••••••••••••••••••••••••••••"
                    className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                  />
                  <span className="text-[10px] text-slate-400">
                    Generated from Brevo Dashboard &rarr; <strong>SMTP &amp; API</strong> &rarr; <strong>API Keys</strong> tab.
                  </span>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-slate-300">Verified Sender Email</label>
                  <input
                    type="email"
                    required
                    value={brevoSenderEmail}
                    onChange={(e) => setBrevoSenderEmail(e.target.value)}
                    placeholder="noreply@your-verified-domain.com"
                    className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                  />
                  <span className="text-[10px] text-slate-400">
                    Must be verified under <strong>Senders &amp; IP &rarr; Senders</strong> in your Brevo account.
                  </span>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-slate-300">Sender Display Name</label>
                  <input
                    type="text"
                    value={brevoSenderName}
                    onChange={(e) => setBrevoSenderName(e.target.value)}
                    placeholder="GitLens Portal"
                    className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                  />
                  <span className="text-[10px] text-slate-400">
                    Name displayed in the recipient's inbox (e.g. "GitLens Portal").
                  </span>
                </div>

                <div className="md:col-span-2 pt-2 flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={isSavingBrevo}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-5 py-2 rounded-xl text-xs transition-colors"
                  >
                    {isSavingBrevo ? 'Saving Settings...' : 'Save Brevo API Settings'}
                  </button>
                </div>
              </form>

              {/* API Test Tool */}
              <div className="border-t border-slate-800 pt-5 mt-2 flex flex-col gap-3">
                <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                  <Send size={13} className="text-indigo-400" />
                  <span>Test Brevo API Dispatch</span>
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
                    onClick={handleTestBrevo}
                    disabled={isTestingBrevo}
                    className="flex items-center gap-1.5 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-medium transition-colors shrink-0"
                  >
                    <Send size={13} />
                    <span>{isTestingBrevo ? 'Sending Test...' : 'Send Test Email'}</span>
                  </button>
                </div>

                {brevoTestResult && (
                  <div
                    className={`p-3 rounded-xl text-xs flex items-center gap-2 border ${
                      brevoTestResult.success
                        ? 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
                        : 'bg-rose-950/60 border-rose-800 text-rose-300'
                    }`}
                  >
                    {brevoTestResult.success ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
                    <span>{brevoTestResult.message}</span>
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
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                    <Mail size={16} className="text-indigo-400" />
                    <span>Transactional Email Delivery Statuses</span>
                  </h3>
                  <span className="text-[11px] font-mono text-slate-400 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    Brevo REST API (v3)
                  </span>
                </div>
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
                                <AlertCircle size={12} /> API Key Not Set
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

      {/* Right Collapsible AI Chat Assistant Drawer */}
      {!embedded && activeProjectId && <RagAssistantDrawer projectId={activeProjectId} />}
    </div>

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
                ✅ Invitation email dispatched successfully to recipient inbox via Brevo API.
              </div>
            ) : (
              <div className="bg-amber-950/40 border border-amber-800/80 rounded-xl p-3 text-xs text-amber-200 flex flex-col gap-1">
                <span className="font-semibold text-amber-300">
                  ⚠️ Brevo API is not configured.
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
              {!isBrevoConfigured && (
                <button
                  onClick={() => {
                    setInviteResult(null);
                    setActiveTab('smtp');
                  }}
                  className="text-xs text-indigo-400 hover:underline flex items-center gap-1"
                >
                  <Settings size={13} />
                  <span>Configure Brevo API</span>
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
