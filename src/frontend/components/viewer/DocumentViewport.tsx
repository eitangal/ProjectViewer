import React, { useEffect, useRef } from 'react';
import { useViewerStore } from '../../store/useViewerStore.js';
import { detectDocumentFormat } from '../../utils/detectDocumentFormat.js';
import { MarkdownRenderer } from '../renderers/MarkdownRenderer.js';
import { MermaidBlock } from '../renderers/MermaidBlock.js';
import { OpenApiSpecRenderer } from '../renderers/OpenApiSpecRenderer.js';
import { SandboxedHtmlRenderer } from '../renderers/SandboxedHtmlRenderer.js';
import { ImageViewer } from '../renderers/ImageViewer.js';
import { RawCodeRenderer } from '../renderers/RawCodeRenderer.js';
import { FileQuestion, Lock, Loader2 } from 'lucide-react';

export const DocumentViewport: React.FC<{
  content: string | null;
  isLoading: boolean;
  isRestricted?: boolean;
  errorMessage?: string | null;
  projectId?: string;
}> = ({ content, isLoading, isRestricted = false, errorMessage = null, projectId }) => {
  const {
    activeFilePath,
    activeHash,
    viewMode,
    projectId: storeProjectId,
    isAiDrawerOpen,
    isAiDrawerMaximized,
    direction,
  } = useViewerStore();
  const viewportRef = useRef<HTMLDivElement>(null);
  const effectiveProjectId = projectId || storeProjectId;
  const isHidden = isAiDrawerOpen && isAiDrawerMaximized;
  const hiddenClass = isHidden ? 'hidden' : '';

  // Handle anchor scrolling after document renders
  useEffect(() => {
    if (activeHash && !isLoading && content) {
      const targetElement = document.getElementById(activeHash);
      if (targetElement) {
        targetElement.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, [activeHash, content, isLoading]);

  if (isLoading) {
    return (
      <main className={`flex-1 min-w-0 flex items-center justify-center p-8 bg-slate-950 ${hiddenClass}`}>
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <Loader2 size={28} className="animate-spin text-indigo-500" />
          <span className="text-xs">Loading document...</span>
        </div>
      </main>
    );
  }

  if (isRestricted) {
    return (
      <main className={`flex-1 min-w-0 flex items-center justify-center p-8 bg-slate-950 ${hiddenClass}`}>
        <div className="max-w-md p-8 bg-slate-900 border border-slate-800 rounded-2xl flex flex-col items-center text-center shadow-xl">
          <div className="p-3 bg-amber-950/40 border border-amber-800/80 rounded-2xl text-amber-400 mb-4">
            <Lock size={28} />
          </div>
          <h2 className="text-base font-semibold text-slate-100 mb-1">Access Restricted</h2>
          <p className="text-xs text-slate-400 mb-2">
            The requested file <span className="font-mono text-slate-300">"{activeFilePath}"</span> is outside your assigned Viewer Group scope.
          </p>
          <span className="text-[11px] text-slate-500">
            Contact the project publisher if you believe you require access to this resource.
          </span>
        </div>
      </main>
    );
  }

  if (errorMessage) {
    return (
      <main className={`flex-1 min-w-0 flex items-center justify-center p-8 bg-slate-950 ${hiddenClass}`}>
        <div className="max-w-md p-8 bg-slate-900 border border-slate-800 rounded-2xl flex flex-col items-center text-center shadow-xl">
          <div className="p-3 bg-rose-950/40 border border-rose-800/80 rounded-2xl text-rose-400 mb-4">
            <FileQuestion size={28} />
          </div>
          <h2 className="text-base font-semibold text-slate-100 mb-1">Unable to load file</h2>
          <p className="text-xs text-rose-300">{errorMessage}</p>
        </div>
      </main>
    );
  }

  if (!activeFilePath || content === null) {
    return (
      <main className={`flex-1 min-w-0 flex items-center justify-center p-8 bg-slate-950 text-slate-500 ${hiddenClass}`}>
        <div className="flex flex-col items-center gap-2 max-w-sm text-center">
          <FileQuestion size={36} className="text-slate-700" />
          <p className="text-sm font-medium text-slate-400">No document selected</p>
          <p className="text-xs text-slate-600">
            Select a file from the repository sidebar to view its rendered specification or raw source code.
          </p>
        </div>
      </main>
    );
  }

  const format = detectDocumentFormat(activeFilePath, content);

  // 1. Full-Bleed Interactive HTML Application (Full Workarea, with Scripts and Audio)
  if (format === 'html' && viewMode !== 'raw') {
    return (
      <main ref={viewportRef} className={`flex-1 min-w-0 h-full w-full overflow-hidden flex flex-col bg-slate-950 ${hiddenClass}`}>
        <SandboxedHtmlRenderer
          htmlContent={content}
          filePath={activeFilePath}
          projectId={effectiveProjectId}
          activeHash={activeHash}
        />
      </main>
    );
  }

  // 2. Full-Bleed OpenAPI Reference View
  if (format === 'openapi' && viewMode !== 'raw') {
    return (
      <main ref={viewportRef} className={`flex-1 min-w-0 h-full w-full overflow-y-auto bg-slate-950 p-2 md:p-6 ${hiddenClass}`}>
        <OpenApiSpecRenderer rawSpec={content} />
      </main>
    );
  }

  // 3. Full-Bleed Image Viewport (PNG, JPG, SVG, WebP, GIF, etc.)
  if (format === 'image' && viewMode !== 'raw') {
    return (
      <main ref={viewportRef} className={`flex-1 min-w-0 h-full w-full overflow-hidden flex flex-col bg-slate-950 ${hiddenClass}`}>
        <ImageViewer
          filePath={activeFilePath}
          projectId={effectiveProjectId}
          content={content}
        />
      </main>
    );
  }

  // 4. Fluid Responsive Document & Code Viewport
  return (
    <main
      ref={viewportRef}
      dir={direction}
      className={`flex-1 min-w-0 overflow-y-auto px-6 py-6 md:px-10 bg-slate-950 relative ${hiddenClass} ${
        direction === 'rtl' ? 'text-right' : 'text-left'
      }`}
    >
      <div className="w-full min-h-full" dir={direction}>
        {viewMode === 'raw' ? (
          <RawCodeRenderer code={content} filePath={activeFilePath} />
        ) : (
          (() => {
            switch (format) {
              case 'markdown':
                return <MarkdownRenderer markdown={content} />;
              case 'mermaid':
                return <MermaidBlock chart={content} />;
              case 'code':
              default:
                return <RawCodeRenderer code={content} filePath={activeFilePath} />;
            }
          })()
        )}
      </div>
    </main>
  );
};
