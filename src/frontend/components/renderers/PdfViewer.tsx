import React, { useState, useEffect, useRef } from 'react';
import {
  FileText,
  Download,
  ExternalLink,
  Maximize2,
  Minimize2,
  AlertCircle,
} from 'lucide-react';

export const PdfViewer: React.FC<{
  filePath: string;
  projectId?: string;
  content: string | null;
}> = ({ filePath, projectId, content }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  const fileName = filePath.split('/').pop() || filePath;
  const rawUrl = projectId ? `/api/viewer/${projectId}/raw/${encodeURI(filePath)}` : '';

  useEffect(() => {
    if (!content) return;

    if (content.startsWith('data:application/pdf;base64,')) {
      try {
        const base64Data = content.slice('data:application/pdf;base64,'.length);
        const byteCharacters = atob(base64Data);
        const byteNumbers = new Uint8Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const blob = new Blob([byteNumbers], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        setBlobUrl(url);

        return () => {
          URL.revokeObjectURL(url);
        };
      } catch (e) {
        console.error('Failed to create object URL for PDF', e);
      }
    }
  }, [content]);

  // Use blobUrl (client-side data URL) if available, otherwise raw endpoint URL
  const effectivePdfUrl = blobUrl || rawUrl || (content && content.startsWith('data:') ? content : '');

  const handleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  const handleDownload = () => {
    if (!effectivePdfUrl) return;
    const downloadLink = document.createElement('a');
    downloadLink.href = effectivePdfUrl;
    downloadLink.download = fileName;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
  };

  const handleOpenNewTab = () => {
    if (!effectivePdfUrl) return;
    window.open(effectivePdfUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      ref={containerRef}
      dir="ltr"
      className="h-full w-full flex flex-col bg-slate-950 overflow-hidden select-none"
    >
      {/* Top Application Bar */}
      <div className="h-10 px-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between text-xs text-slate-400 shrink-0 z-10">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="flex items-center gap-1.5 text-rose-400 font-semibold tracking-wide shrink-0">
            <FileText size={14} />
            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-rose-950/80 border border-rose-800/60 text-rose-300 font-bold">
              PDF
            </span>
          </span>
          <span className="font-mono text-slate-200 truncate" title={filePath}>
            {fileName}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleOpenNewTab}
            title="Open in New Tab"
            className="flex items-center gap-1 px-2.5 py-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg text-xs font-medium transition-colors"
          >
            <ExternalLink size={13} />
            <span className="hidden sm:inline">Open in Tab</span>
          </button>

          <button
            type="button"
            onClick={handleDownload}
            title="Download PDF"
            className="flex items-center gap-1 px-2.5 py-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg text-xs font-medium transition-colors"
          >
            <Download size={13} />
            <span className="hidden sm:inline">Download</span>
          </button>

          <button
            type="button"
            onClick={handleFullscreen}
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors ml-1"
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>

      {/* PDF Viewport */}
      <div className="flex-1 w-full h-full relative overflow-hidden bg-slate-950">
        {effectivePdfUrl ? (
          <object
            data={effectivePdfUrl}
            type="application/pdf"
            className="w-full h-full border-0"
          >
            <iframe
              src={effectivePdfUrl}
              className="w-full h-full border-0"
              title={fileName}
            >
              <div className="flex flex-col items-center justify-center h-full p-8 text-center text-slate-400">
                <AlertCircle size={40} className="text-rose-400 mb-3" />
                <p className="text-sm font-medium text-slate-200 mb-1">
                  Unable to display PDF directly
                </p>
                <p className="text-xs text-slate-400 mb-4 max-w-sm">
                  Your browser does not support embedded PDF preview or plugin is disabled.
                </p>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleDownload}
                    className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg inline-flex items-center gap-1.5 transition-colors"
                  >
                    <Download size={13} /> Download PDF
                  </button>
                  <button
                    onClick={handleOpenNewTab}
                    className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg inline-flex items-center gap-1.5 transition-colors"
                  >
                    <ExternalLink size={13} /> Open in New Tab
                  </button>
                </div>
              </div>
            </iframe>
          </object>
        ) : (
          <div className="flex flex-col items-center justify-center h-full p-8 text-center text-slate-500">
            <FileText size={40} className="text-slate-700 mb-3" />
            <p className="text-xs">No PDF content available</p>
          </div>
        )}
      </div>
    </div>
  );
};
