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
  var rawBaseHref = ${JSON.stringify(safeBaseHref)};

  // 1. Preset Docsify basePath so Docsify router resolves files against the raw file serving endpoint
  try {
    var _docsifyConfig = { basePath: rawBaseHref };
    Object.defineProperty(window, '$docsify', {
      configurable: true,
      enumerable: true,
      get: function() {
        return _docsifyConfig;
      },
      set: function(val) {
        if (val && typeof val === 'object') {
          if (!val.basePath) {
            val.basePath = rawBaseHref;
          }
        }
        _docsifyConfig = val;
      }
    });
  } catch (e) {}

  // 2. URL normalizer for subresource requests within sandboxed iframe
  function rewriteViewerUrl(url) {
    if (typeof url !== 'string' || !url) return url;

    // Strip srcdoc/ or /srcdoc/ prefix (iframe routing artifact)
    var cleanUrl = url.replace(/^(\\/)?srcdoc\\//, '$1');

    // Root-relative path (e.g. /docs/...) - rewrite against rawBaseHref directory
    if (cleanUrl.startsWith('/') && !cleanUrl.startsWith('/api/viewer/') && !cleanUrl.startsWith('//')) {
      return rawBaseHref + cleanUrl.replace(/^\\/+/, '');
    }

    // Relative path that previously had srcdoc/ prefix
    if (url.startsWith('srcdoc/')) {
      return rawBaseHref + url.replace(/^srcdoc\\//, '');
    }

    return cleanUrl;
  }

  // 3. Monkey-patch XMLHttpRequest.prototype.open
  try {
    var origXhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
      var targetUrl = rewriteViewerUrl(url);
      return origXhrOpen.call(this, method, targetUrl, async, user, password);
    };
  } catch (e) {}

  // 4. Monkey-patch window.fetch
  try {
    var origFetch = window.fetch;
    if (typeof origFetch === 'function') {
      window.fetch = function(input, init) {
        if (typeof input === 'string') {
          return origFetch.call(this, rewriteViewerUrl(input), init);
        } else if (input && typeof input.url === 'string') {
          var targetUrl = rewriteViewerUrl(input.url);
          if (targetUrl !== input.url) {
            try {
              input = new Request(targetUrl, input);
            } catch (err) {
              return origFetch.call(this, targetUrl, init);
            }
          }
          return origFetch.call(this, input, init);
        }
        return origFetch.apply(this, arguments);
      };
    }
  } catch (e) {}

  // 5. Link click interception
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
        html = html.replace('<head>', `<head>${baseTag}${interceptorScript}`);
      } else if (html.includes('<head ')) {
        html = html.replace(/<head[^>]*>/, `$&${baseTag}${interceptorScript}`);
      } else {
        html = `${baseTag}\n${interceptorScript}\n${html}`;
      }
    } else {
      if (html.includes('<head>')) {
        html = html.replace('<head>', `<head>${interceptorScript}`);
      } else if (html.includes('<head ')) {
        html = html.replace(/<head[^>]*>/, `$&${interceptorScript}`);
      } else {
        html = `${interceptorScript}\n${html}`;
      }
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

      {/* Full-Bleed Interactive Sandbox Iframe (allow-same-origin enables authenticated relative subresource fetching) */}
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
