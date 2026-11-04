import React, { useRef, useState, useMemo } from 'react';
import { ExternalLink, Maximize2, Minimize2, RotateCcw, Sparkles, Volume2 } from 'lucide-react';

export const SandboxedHtmlRenderer: React.FC<{
  htmlContent: string;
  filePath?: string | null;
  projectId?: string;
}> = ({ htmlContent, filePath, projectId }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);

  // Raw direct URL for opening in a separate tab if needed
  const rawUrl =
    projectId && filePath
      ? `/api/viewer/${projectId}/raw/${encodeURI(filePath)}`
      : null;

  const handleReload = () => {
    setIframeKey((prev) => prev + 1);
  };

  const handleFullscreen = () => {
    if (!document.fullscreenElement) {
      iframeRef.current?.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // Inject <base> tag so relative assets and styles resolve to the raw endpoint
  const processedHtml = useMemo(() => {
    if (!filePath || !projectId) return htmlContent;
    const dir = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '';
    const baseHref = `/api/viewer/${projectId}/raw/${dir ? encodeURI(dir) + '/' : ''}`;

    if (!htmlContent.includes('<base ') && htmlContent.includes('<head>')) {
      return htmlContent.replace('<head>', `<head><base href="${baseHref}">`);
    } else if (!htmlContent.includes('<base ') && htmlContent.includes('<head ')) {
      return htmlContent.replace(/<head[^>]*>/, `$&<base href="${baseHref}">`);
    }
    return htmlContent;
  }, [htmlContent, filePath, projectId]);

  return (
    <div dir="ltr" className="h-full w-full flex flex-col bg-slate-950 overflow-hidden select-none">
      {/* Top Application Bar */}
      <div className="h-9 px-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between text-xs text-slate-400 shrink-0">
        <div className="flex items-center gap-2.5">
          <span className="flex items-center gap-1.5 text-emerald-400 font-semibold tracking-wide">
            <Sparkles size={13} />
            <span>Interactive HTML Application</span>
          </span>
          <span className="text-slate-600">•</span>
          <span className="flex items-center gap-1 text-sky-400 text-[11px]">
            <Volume2 size={13} />
            <span>JS Animations & Sound Active</span>
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleReload}
            title="Reload HTML Application"
            className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-200 transition-colors"
          >
            <RotateCcw size={13} />
          </button>
          <button
            onClick={handleFullscreen}
            title="Toggle Fullscreen"
            className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-200 transition-colors"
          >
            {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
          {rawUrl && (
            <a
              href={rawUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white transition-colors text-xs font-medium"
            >
              <span>Open in New Tab</span>
              <ExternalLink size={12} />
            </a>
          )}
        </div>
      </div>

      {/* Full-Bleed Interactive Sandbox Iframe */}
      <iframe
        key={iframeKey}
        ref={iframeRef}
        title="Interactive HTML Application Viewport"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
        allow="autoplay; fullscreen; encrypted-media; camera; microphone"
        srcDoc={processedHtml}
        className="w-full flex-1 border-0 h-full bg-slate-950"
      />
    </div>
  );
};
