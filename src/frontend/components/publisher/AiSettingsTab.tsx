import React, { useState } from 'react';
import { Sparkles, Key, Check, AlertTriangle, ShieldCheck, RefreshCw } from 'lucide-react';
import { ProjectSummary } from '@/shared/types.js';

export const AiSettingsTab: React.FC<{
  project: ProjectSummary;
  onSaveAiConfig: (data: {
    apiKey?: string;
    chatModel?: string;
    systemPrompt?: string;
    dailyViewerQueryLimit?: number;
  }) => Promise<void>;
  onTestKey: (apiKey: string) => Promise<boolean>;
}> = ({ project, onSaveAiConfig, onTestKey }) => {
  const [apiKey, setApiKey] = useState(project.hasGeminiKey ? '••••••••••••••••••••••••' : '');
  const [isEditingKey, setIsEditingKey] = useState(!project.hasGeminiKey);
  const [chatModel, setChatModel] = useState(project.geminiChatModel || 'gemini-3.8-flash');
  const [systemPrompt, setSystemPrompt] = useState(
    project.systemPrompt ||
      'You are a technical repository assistant. Answer strictly using the provided context blocks.'
  );
  const [dailyLimit, setDailyLimit] = useState(project.dailyViewerQueryLimit || 50);

  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testError, setTestError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const handleTest = async () => {
    if (!apiKey || apiKey.startsWith('••••')) {
      alert('Please enter your Gemini API key before testing.');
      return;
    }
    setTestStatus('testing');
    setTestError(null);
    try {
      await onTestKey(apiKey);
      setTestStatus('success');
    } catch (err: any) {
      setTestStatus('error');
      setTestError(err.message || 'Key validation failed');
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSaveAiConfig({
        apiKey: isEditingKey && apiKey && !apiKey.startsWith('••••') ? apiKey : undefined,
        chatModel,
        systemPrompt,
        dailyViewerQueryLimit: dailyLimit,
      });
      setIsEditingKey(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (err: any) {
      alert(`Failed to save AI configuration: ${err.message || 'Unknown error'}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-2 flex flex-col gap-6">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col gap-5">
        <div>
          <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <Sparkles size={18} className="text-indigo-400" />
            <span>Gemini BYOK & RAG Assistant Configuration</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Provide your Google Gemini API key (@google/genai SDK). Vector embeddings and completions are billed directly to your Google AI account. Keys are encrypted at rest with AES-256-GCM.
          </p>
        </div>

        {/* API Key Input */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
            <Key size={13} className="text-indigo-400" />
            <span>Google Gemini API Key</span>
          </label>
          <div className="flex gap-2">
            <input
              type={isEditingKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              disabled={!isEditingKey}
              placeholder="AIzaSy..."
              className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500 disabled:opacity-50"
            />
            {isEditingKey ? (
              <button
                type="button"
                onClick={() => setIsEditingKey(false)}
                className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium transition-colors"
              >
                Cancel
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setApiKey('');
                  setIsEditingKey(true);
                }}
                className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium transition-colors"
              >
                Change Key
              </button>
            )}
            <button
              type="button"
              onClick={handleTest}
              disabled={testStatus === 'testing' || !apiKey || apiKey.startsWith('••••')}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-xl text-xs font-medium transition-colors flex items-center gap-1.5"
            >
              {testStatus === 'testing' ? (
                <RefreshCw size={13} className="animate-spin" />
              ) : (
                <ShieldCheck size={13} />
              )}
              <span>{testStatus === 'testing' ? 'Testing...' : 'Test Connection'}</span>
            </button>
          </div>

          {testStatus === 'success' && (
            <p className="text-xs text-emerald-400 mt-1 flex items-center gap-1">
              <Check size={13} /> Verified successfully with Google Gemini API!
            </p>
          )}
          {testStatus === 'error' && (
            <p className="text-xs text-rose-400 mt-1 flex items-center gap-1">
              <AlertTriangle size={13} /> {testError}
            </p>
          )}
        </div>

        {/* Completion Model Selector */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-slate-300">Completion Model</label>
          <select
            value={chatModel}
            onChange={(e) => setChatModel(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
          >
            <option value="gemini-3.8-flash">
              Gemini 3.8 Flash (High intelligence, fast, low-latency — Recommended)
            </option>
            <option value="gemini-3.5-flash-lite">
              Gemini 3.5 Flash-Lite (Ultra-fast, cost-efficient, high-throughput)
            </option>
            {chatModel !== 'gemini-3.8-flash' && chatModel !== 'gemini-3.5-flash-lite' && (
              <option value={chatModel}>
                {chatModel} (Current / Custom)
              </option>
            )}
          </select>
        </div>

        {/* Daily Query Quota per Viewer */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-slate-300">
            Per-Viewer Daily Query Quota (Prevents billing surprises)
          </label>
          <input
            type="number"
            min={1}
            max={1000}
            value={dailyLimit}
            onChange={(e) => setDailyLimit(Number(e.target.value))}
            className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
          />
        </div>

        {/* System Prompt */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-slate-300">
            Project Assistant System Instructions
          </label>
          <textarea
            rows={4}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
          />
        </div>

        <button
          onClick={handleSave}
          disabled={isSaving}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-medium py-2.5 rounded-xl transition-colors text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-indigo-600/20"
        >
          {isSaving ? (
            <RefreshCw size={14} className="animate-spin" />
          ) : saveSuccess ? (
            <>
              <Check size={14} className="text-emerald-300" />
              <span>Settings Saved!</span>
            </>
          ) : (
            <span>Save AI Configuration</span>
          )}
        </button>
      </div>
    </div>
  );
};
