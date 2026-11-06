import React, { useRef, useState, useMemo, useEffect } from 'react';
import { ExternalLink, Maximize2, Minimize2, RotateCcw, Sparkles, Volume2 } from 'lucide-react';
import { useViewerStore } from '../../store/useViewerStore.js';
import { resolveRepoLink } from '../../utils/resolveRepoLink.js';

export const SandboxedHtmlRenderer: React.FC<{
  htmlContent: string;
  filePath?: string | null;
  projectId?: string;
  activeHash?: string | null;
}> = ({ htmlContent, filePath, projectId, activeHash }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);

  // Raw direct URL: for root index.html, load directory `/raw/` so Docsify & relative assets resolve naturally
  const rawUrl = useMemo(() => {
    if (!projectId || !filePath) return null;
    if (filePath === 'index.html' || filePath.endsWith('/index.html')) {
      const dir = filePath.replace(/index\.html$/, '');
      return `/api/viewer/${projectId}/raw/${dir ? encodeURI(dir) : ''}`;
    }
    return `/api/viewer/${projectId}/raw/${encodeURI(filePath)}`;
  }, [projectId, filePath]);

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

  // Listen for navigation messages sent from the sandboxed iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (
        event.data &&
        typeof event.data === 'object' &&
        event.data.type === 'PROJECT_VIEWER_NAVIGATE'
      ) {
        const { href, resolvedHref } = event.data;
        const linkToResolve = href || resolvedHref;
        if (!linkToResolve) return;

        const current = filePath || '';
        const resolved = resolveRepoLink(current, linkToResolve);

        if (resolved.type === 'external') {
          window.open(resolved.rawHref, '_blank', 'noopener,noreferrer');
        } else if (resolved.type === 'internal-repo' && resolved.targetPath) {
          useViewerStore.getState().navigateToFile(resolved.targetPath, resolved.hash);
        } else if (resolved.type === 'anchor-only' && resolved.hash) {
          iframeRef.current?.contentWindow?.postMessage(
            { type: 'SCROLL_TO_ANCHOR', hash: resolved.hash },
            '*'
          );
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [filePath]);

  // When activeHash updates, notify the iframe to scroll
  useEffect(() => {
    if (activeHash && iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        { type: 'SCROLL_TO_ANCHOR', hash: activeHash },
        '*'
      );
    }
  }, [activeHash]);

  // Inject <base> tag and capture-phase link interception script into iframe HTML
  const processedHtml = useMemo(() => {
    if (!filePath || !projectId) return htmlContent;
    const dir = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '';
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const rawBaseHref = `${origin}/api/viewer/${encodeURIComponent(projectId)}/raw/${dir ? encodeURI(dir) + '/' : ''}`;
    const safeBaseHref = rawBaseHref.replace(/["<>]/g, (ch) => encodeURIComponent(ch));

    const baseTag = `<base href="${safeBaseHref}">`;
    const safeHashJson = JSON.stringify(activeHash || '');

    const interceptorScript = `
<script id="gitportal-viewer-interceptor">
(function() {
  function handleLinkClick(e) {
    var a = e.target;
    while (a && a.tagName !== 'A') {
      a = a.parentElement;
    }
    if (!a) return;

    var rawHref = a.getAttribute('href') || a.getAttribute('xlink:href');
    if (!rawHref) return;

    // Ignore dangerous URI schemes
    if (/^\\s*(javascript|vbscript|data|file):/i.test(rawHref)) {
      e.preventDefault();
      return;
    }

    // In-page hash anchors on the current HTML document
    if (rawHref.startsWith('#')) {
      return;
    }

    // External protocol handlers
    if (/^(mailto:|tel:)/i.test(rawHref)) {
      return;
    }

    // Intercept internal file navigation and dispatch to parent ProjectViewer
    e.preventDefault();
    e.stopPropagation();

    try {
      window.parent.postMessage({
        type: 'PROJECT_VIEWER_NAVIGATE',
        href: rawHref,
        resolvedHref: a.href || rawHref
      }, '*');
    } catch (err) {}
  }

  document.addEventListener('click', handleLinkClick, true);

  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'SCROLL_TO_ANCHOR' && e.data.hash) {
      var el = document.getElementById(e.data.hash);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth' });
      }
    }
  });

  var initialHash = ${safeHashJson};
  if (initialHash) {
    var scrollToTarget = function() {
      var el = document.getElementById(initialHash);
      if (el) el.scrollIntoView();
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', scrollToTarget);
    } else {
      setTimeout(scrollToTarget, 60);
    }
  }
})();
</script>
`;

    let html = htmlContent;

    if (!html.includes('<base ')) {
      if (html.includes('<head>')) {
        html = html.replace('<head>', `<head>${baseTag}`);
      } else if (html.includes('<head ')) {
        html = html.replace(/<head[^>]*>/, `$&${baseTag}`);
      } else {
        html = `${baseTag}\n${html}`;
      }
    }

    if (html.includes('</head>')) {
      html = html.replace('</head>', `${interceptorScript}</head>`);
    } else if (html.includes('</body>')) {
      html = html.replace('</body>', `${interceptorScript}</body>`);
    } else {
      html = `${html}\n${interceptorScript}`;
    }

    return html;
  }, [htmlContent, filePath, projectId, activeHash]);

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

      {/* Full-Bleed Interactive Sandbox Iframe (Opaque Origin: no allow-same-origin) */}
      <iframe
        key={iframeKey}
        ref={iframeRef}
        title="Interactive HTML Application Viewport"
        sandbox="allow-scripts allow-forms allow-popups allow-modals allow-downloads"
        allow="autoplay; fullscreen; encrypted-media"
        srcDoc={processedHtml}
        className="w-full flex-1 border-0 h-full bg-slate-950"
      />
    </div>
  );
};
