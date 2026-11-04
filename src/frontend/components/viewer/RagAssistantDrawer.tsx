import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, Send, X, FileText, CornerDownLeft, Loader2 } from 'lucide-react';
import { useViewerStore } from '../../store/useViewerStore.js';
import { RagChatMessage } from '@/shared/types.js';

export const RagAssistantDrawer: React.FC<{ projectId: string }> = ({ projectId }) => {
  const { isAiDrawerOpen, toggleAiDrawer, navigateToFile } = useViewerStore();
  const [messages, setMessages] = useState<RagChatMessage[]>([
    {
      role: 'assistant',
      content:
        'Hello! I am your ACL-scoped Project AI assistant. Ask questions about this repository and I will answer strictly using your permitted files, with inline citations.',
    },
  ]);
  const [inputQuestion, setInputQuestion] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  if (!isAiDrawerOpen) return null;

  const handleSend = async () => {
    if (!inputQuestion.trim() || isStreaming) return;

    const userText = inputQuestion.trim();
    setInputQuestion('');
    setMessages((prev) => [...prev, { role: 'user', content: userText }]);
    setIsStreaming(true);

    // Placeholder for incoming streaming assistant message
    setMessages((prev) => [...prev, { role: 'assistant', content: '', citations: [] }]);

    try {
      const response = await fetch(`/api/viewer/${projectId}/rag/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: userText }),
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('Response stream unavailable');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const dataStr = line.slice(6).trim();
          if (dataStr === '[DONE]') continue;

          try {
            const parsed = JSON.parse(dataStr);
            if (parsed.citations) {
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last && last.role === 'assistant') {
                  last.citations = parsed.citations;
                }
                return next;
              });
            }
            if (parsed.text) {
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last && last.role === 'assistant') {
                  last.content += parsed.text;
                }
                return next;
              });
            }
          } catch {
            // Ignore parse errors on partial chunks
          }
        }
      }
    } catch (err: any) {
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === 'assistant') {
          last.content = `Error: ${err.message || 'Failed to complete RAG query'}`;
        }
        return next;
      });
    } finally {
      setIsStreaming(false);
    }
  };

  /**
   * Parses inline citations like [docs/arch/overview.md#L12-L40] or [specs/auth.yaml]
   * and renders clickable buttons.
   */
  const renderMessageContent = (content: string) => {
    const citationRegex = /\[([^\[\]\s]+\.[a-zA-Z0-9]+(?:#L\d+(?:-L\d+)?)?)\]/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;

    while ((match = citationRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push(content.slice(lastIndex, match.index));
      }

      const rawRef = match[1];
      const [filePath, hash] = rawRef.split('#');

      parts.push(
        <button
          key={match.index}
          onClick={() => navigateToFile(filePath, hash || null)}
          className="inline-flex items-center gap-1 mx-1 px-1.5 py-0.5 rounded-md bg-indigo-950/80 border border-indigo-700/80 text-indigo-300 font-mono text-[11px] hover:bg-indigo-900 transition-colors align-baseline"
          title={`Open ${filePath}${hash ? ` at ${hash}` : ''}`}
        >
          <FileText size={10} className="shrink-0 text-indigo-400" />
          <span className="truncate max-w-[180px]">{rawRef}</span>
        </button>
      );

      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < content.length) {
      parts.push(content.slice(lastIndex));
    }

    return parts;
  };

  return (
    <aside className="w-80 md:w-96 border-s border-slate-800 bg-slate-900/95 backdrop-blur-md flex flex-col shrink-0 h-full z-20 shadow-2xl">
      {/* Header */}
      <div className="h-12 border-b border-slate-800 px-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-indigo-400 font-medium text-xs">
          <Sparkles size={15} />
          <span>Project AI Assistant</span>
        </div>
        <button
          onClick={toggleAiDrawer}
          className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 text-xs">
        {messages.map((m, idx) => (
          <div
            key={idx}
            className={`flex flex-col ${
              m.role === 'user' ? 'items-end' : 'items-start'
            }`}
          >
            <div
              className={`p-3 rounded-2xl max-w-[92%] leading-relaxed ${
                m.role === 'user'
                  ? 'bg-indigo-600 text-white rounded-br-xs'
                  : 'bg-slate-950 border border-slate-800 text-slate-200 rounded-bl-xs'
              }`}
            >
              {m.content ? (
                <div className="whitespace-pre-wrap">{renderMessageContent(m.content)}</div>
              ) : (
                <div className="flex items-center gap-2 text-slate-500 py-1">
                  <Loader2 size={13} className="animate-spin text-indigo-400" />
                  <span>Thinking...</span>
                </div>
              )}
            </div>

            {/* Citations Footer */}
            {m.citations && m.citations.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1 max-w-[92%]">
                <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wider w-full mb-0.5">
                  Grounded Sources:
                </span>
                {m.citations.map((c, cIdx) => (
                  <button
                    key={cIdx}
                    onClick={() =>
                      navigateToFile(
                        c.filePath,
                        c.startLine ? `L${c.startLine}-L${c.endLine}` : null
                      )
                    }
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 font-mono text-[10px] hover:border-indigo-500 transition-colors"
                  >
                    <FileText size={10} className="text-indigo-400" />
                    <span>
                      {c.filePath}
                      {c.startLine ? `:${c.startLine}` : ''}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Composer */}
      <div className="p-3 border-t border-slate-800 bg-slate-950">
        <div className="relative flex items-end bg-slate-900 border border-slate-800 rounded-xl p-1.5 focus-within:border-indigo-500 transition-colors">
          <textarea
            rows={2}
            value={inputQuestion}
            onChange={(e) => setInputQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Ask about this repo... (Enter to send)"
            disabled={isStreaming}
            className="w-full bg-transparent border-0 resize-none px-2 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none"
          />
          <button
            onClick={handleSend}
            disabled={!inputQuestion.trim() || isStreaming}
            className="p-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:hover:bg-indigo-600 text-white transition-colors shrink-0 ms-1"
          >
            {isStreaming ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Send size={13} />
            )}
          </button>
        </div>
      </div>
    </aside>
  );
};
