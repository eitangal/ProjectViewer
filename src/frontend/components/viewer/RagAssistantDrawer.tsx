import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, Send, X, FileText, Loader2, Maximize2, Minimize2 } from 'lucide-react';
import { useViewerStore } from '../../store/useViewerStore.js';
import { RagChatMessage } from '@/shared/types.js';

export const RagAssistantDrawer: React.FC<{ projectId: string }> = ({ projectId }) => {
  const {
    isAiDrawerOpen,
    toggleAiDrawer,
    navigateToFile,
    previewGroupId,
    direction,
    contentWidth,
    isSidebarOpen,
    aiDrawerWidth,
    setAiDrawerWidth,
    isAiDrawerMaximized,
    setAiDrawerMaximized,
    toggleAiDrawerMaximized,
  } = useViewerStore();

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

  const asideRef = useRef<HTMLElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ startX: number; startWidth: number; containerWidth: number }>({
    startX: 0,
    startWidth: 384,
    containerWidth: typeof window !== 'undefined' ? window.innerWidth : 1200,
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  // Handle Drag Resizing of Assistant Drawer
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const parent = asideRef.current?.parentElement;
    const containerWidth = parent ? parent.clientWidth : window.innerWidth;
    const currentWidth = asideRef.current?.offsetWidth || aiDrawerWidth || 384;
    const maxWorkareaWidth = Math.max(320, containerWidth - (isSidebarOpen ? 288 : 0));

    dragStartRef.current = {
      startX: e.clientX,
      startWidth: isAiDrawerMaximized ? maxWorkareaWidth : currentWidth,
      containerWidth,
    };
    setIsDragging(true);
  };

  useEffect(() => {
    if (!isDragging) return;

    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (e: MouseEvent) => {
      const { startX, startWidth, containerWidth } = dragStartRef.current;
      // In LTR: dragging left (startX - e.clientX > 0) widens the drawer
      // In RTL: dragging right (e.clientX - startX > 0) widens the drawer
      const delta = direction === 'rtl' ? e.clientX - startX : startX - e.clientX;
      const maxWorkareaWidth = Math.max(320, containerWidth - (isSidebarOpen ? 288 : 0));
      const minWidth = 320;
      const targetWidth = startWidth + delta;

      // If dragged to within 20px of full workarea width or past it, snap to maximized
      if (targetWidth >= maxWorkareaWidth - 20) {
        if (!useViewerStore.getState().isAiDrawerMaximized) {
          setAiDrawerMaximized(true);
        }
        setAiDrawerWidth(maxWorkareaWidth);
      } else {
        if (useViewerStore.getState().isAiDrawerMaximized) {
          setAiDrawerMaximized(false);
        }
        const clamped = Math.max(minWidth, Math.min(targetWidth, maxWorkareaWidth));
        setAiDrawerWidth(clamped);
      }
    };

    const onMouseUp = () => {
      setIsDragging(false);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
    };
  }, [isDragging, direction, isSidebarOpen, setAiDrawerMaximized, setAiDrawerWidth]);

  // Keyboard navigation for resizing
  const handleKeyDownOnResizeHandle = (e: React.KeyboardEvent) => {
    const parent = asideRef.current?.parentElement;
    const containerWidth = parent ? parent.clientWidth : window.innerWidth;
    const maxWorkareaWidth = Math.max(320, containerWidth - (isSidebarOpen ? 288 : 0));
    const step = e.shiftKey ? 80 : 30;

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (direction === 'rtl') {
        setAiDrawerMaximized(false);
        setAiDrawerWidth(Math.max(320, aiDrawerWidth - step));
      } else {
        const next = aiDrawerWidth + step;
        if (next >= maxWorkareaWidth - 20) {
          setAiDrawerMaximized(true);
        } else {
          setAiDrawerWidth(next);
        }
      }
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (direction === 'rtl') {
        const next = aiDrawerWidth + step;
        if (next >= maxWorkareaWidth - 20) {
          setAiDrawerMaximized(true);
        } else {
          setAiDrawerWidth(next);
        }
      } else {
        setAiDrawerMaximized(false);
        setAiDrawerWidth(Math.max(320, aiDrawerWidth - step));
      }
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleAiDrawerMaximized();
    } else if (e.key === 'Home') {
      e.preventDefault();
      setAiDrawerMaximized(false);
      setAiDrawerWidth(320);
    } else if (e.key === 'End') {
      e.preventDefault();
      setAiDrawerMaximized(true);
      setAiDrawerWidth(maxWorkareaWidth);
    }
  };

  const handleCitationClick = (filePath: string, hash: string | null) => {
    if (isAiDrawerMaximized) {
      setAiDrawerMaximized(false);
    }
    navigateToFile(filePath, hash);
  };

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
      const chatUrl = `/api/viewer/${projectId}/rag/chat${previewGroupId ? `?previewGroupId=${previewGroupId}` : ''}`;
      const response = await fetch(chatUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: userText, previewGroupId }),
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
          onClick={() => handleCitationClick(filePath, hash || null)}
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
    <>
      {/* Invisible overlay while dragging to capture all mouse events smoothly across iframes */}
      {isDragging && (
        <div className="fixed inset-0 z-50 cursor-col-resize select-none pointer-events-auto" />
      )}

      <aside
        ref={asideRef}
        aria-label="Project AI Assistant Panel"
        className={`border-s border-slate-800 bg-slate-900/95 backdrop-blur-md flex flex-col h-full z-20 shadow-2xl relative ${
          isAiDrawerMaximized ? 'flex-1 w-full min-w-0' : 'shrink-0'
        }`}
        style={
          isAiDrawerMaximized
            ? { width: '100%', maxWidth: '100%' }
            : { width: `${aiDrawerWidth}px`, maxWidth: '100%', minWidth: '320px' }
        }
      >
        {/* Draggable Resize Handle on Inline-Start Edge */}
        <div
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label="Resize Project Assistant"
          aria-valuenow={isAiDrawerMaximized ? 100 : Math.round(aiDrawerWidth)}
          title="Drag to resize assistant (double-click to toggle full workarea width)"
          onMouseDown={handleMouseDown}
          onDoubleClick={toggleAiDrawerMaximized}
          onKeyDown={handleKeyDownOnResizeHandle}
          className="absolute top-0 bottom-0 start-0 w-3 -ms-1.5 cursor-col-resize z-30 group flex items-center justify-center select-none outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <div
            className={`w-1 h-9 rounded-full transition-colors ${
              isDragging
                ? 'bg-indigo-500 ring-2 ring-indigo-500/30'
                : 'bg-slate-700/60 group-hover:bg-indigo-400 group-focus:bg-indigo-400'
            }`}
          />
        </div>

        {/* Header */}
        <div className="h-12 border-b border-slate-800 px-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-indigo-400 font-medium text-xs min-w-0">
            <Sparkles size={15} className="shrink-0" />
            <span className="truncate">Project AI Assistant</span>
            {isAiDrawerMaximized && (
              <span className="ms-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-950 text-indigo-300 border border-indigo-700/80 shrink-0">
                Full Workarea
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {/* Widen to Full Workarea Width / Restore Normal Width Button */}
            <button
              onClick={toggleAiDrawerMaximized}
              title={
                isAiDrawerMaximized
                  ? 'Restore Normal Width'
                  : 'Widen to Full Workarea Width'
              }
              aria-label={
                isAiDrawerMaximized
                  ? 'Restore Normal Width'
                  : 'Widen to Full Workarea Width'
              }
              className={`p-1.5 rounded-lg transition-colors ${
                isAiDrawerMaximized
                  ? 'bg-indigo-950 text-indigo-300 border border-indigo-700/70 hover:bg-indigo-900'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              {isAiDrawerMaximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>

            {/* Close Button */}
            <button
              onClick={toggleAiDrawer}
              title="Close Assistant"
              aria-label="Close Assistant"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Messages Scroll Area */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 text-xs">
          <div
            className={`w-full flex flex-col gap-4 ${
              contentWidth === 'full' ? '' : 'max-w-4xl mx-auto'
            }`}
          >
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
                          handleCitationClick(
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
        </div>

        {/* Input Composer */}
        <div className="p-3 border-t border-slate-800 bg-slate-950 shrink-0">
          <div
            className={`w-full ${
              contentWidth === 'full' ? '' : 'max-w-4xl mx-auto'
            }`}
          >
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
        </div>
      </aside>
    </>
  );
};
