import React, { useState, useRef } from 'react';
import {
  Image as ImageIcon,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ExternalLink,
  Download,
  Maximize2,
  Minimize2,
} from 'lucide-react';

export const ImageViewer: React.FC<{
  filePath: string;
  projectId?: string;
  content: string | null;
}> = ({ filePath, projectId, content }) => {
  const [zoom, setZoom] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const ext = filePath.split('.').pop()?.toUpperCase() || 'IMAGE';
  const fileName = filePath.split('/').pop() || filePath;

  // Use base64 data URI if provided by blob API, otherwise fallback to raw file URL
  const rawUrl = projectId ? `/api/viewer/${projectId}/raw/${encodeURI(filePath)}` : '';
  const imageSrc = content && content.startsWith('data:image/') ? content : rawUrl;

  const handleZoomIn = () => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)));
  const handleZoomOut = () => setZoom((z) => Math.max(0.25, +(z - 0.25).toFixed(2)));
  const handleResetZoom = () => setZoom(1);

  const handleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
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
          <span className="flex items-center gap-1.5 text-purple-400 font-semibold tracking-wide shrink-0">
            <ImageIcon size={14} />
            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-purple-950/80 border border-purple-800/60 text-purple-300 font-bold">
              {ext}
            </span>
          </span>
          <span className="font-mono text-slate-200 truncate" title={filePath}>
            {fileName}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Zoom Controls */}
          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5 mr-2">
            <button
              onClick={handleZoomOut}
              disabled={zoom <= 0.25}
              title="Zoom Out (-25%)"
              className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent rounded transition-colors"
            >
              <ZoomOut size={13} />
            </button>
            <button
              onClick={handleResetZoom}
              title="Reset Zoom (100%)"
              className="px-2 py-0.5 font-mono text-[11px] text-slate-300 hover:text-white"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              onClick={handleZoomIn}
              disabled={zoom >= 4}
              title="Zoom In (+25%)"
              className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent rounded transition-colors"
            >
              <ZoomIn size={13} />
            </button>
            {zoom !== 1 && (
              <button
                onClick={handleResetZoom}
                title="Reset to 100%"
                className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition-colors border-s border-slate-800"
              >
                <RotateCcw size={12} />
              </button>
            )}
          </div>

          <button
            onClick={handleFullscreen}
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-200 transition-colors"
          >
            {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>

          {rawUrl && (
            <>
              <a
                href={rawUrl}
                download={fileName}
                title="Download Image"
                className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-200 transition-colors"
              >
                <Download size={13} />
              </a>
              <a
                href={rawUrl}
                target="_blank"
                rel="noopener noreferrer"
                title="Open in New Tab"
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white transition-colors text-xs font-medium"
              >
                <span>Open Raw</span>
                <ExternalLink size={12} />
              </a>
            </>
          )}
        </div>
      </div>

      {/* Main Canvas Viewport with Subtle Transparency Grid */}
      <div className="flex-1 w-full h-full overflow-auto flex items-center justify-center p-8 bg-slate-950/90 relative">
        {/* Subtle checkerboard background for transparent PNG/SVG */}
        <div
          className="absolute inset-0 pointer-events-none opacity-20"
          style={{
            backgroundImage: `
              linear-gradient(45deg, #334155 25%, transparent 25%),
              linear-gradient(-45deg, #334155 25%, transparent 25%),
              linear-gradient(45deg, transparent 75%, #334155 75%),
              linear-gradient(-45deg, transparent 75%, #334155 75%)
            `,
            backgroundSize: '16px 16px',
            backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
          }}
        />

        {loadError ? (
          <div className="relative z-10 max-w-sm p-6 bg-slate-900 border border-slate-800 rounded-2xl flex flex-col items-center text-center shadow-xl">
            <div className="p-3 bg-rose-950/40 border border-rose-800/80 rounded-xl text-rose-400 mb-3">
              <ImageIcon size={24} />
            </div>
            <h3 className="text-sm font-semibold text-slate-200 mb-1">Failed to load image</h3>
            <p className="text-xs text-slate-400 font-mono break-all">{filePath}</p>
          </div>
        ) : (
          <div className="relative z-10 flex items-center justify-center transition-transform duration-150 ease-out">
            <img
              src={imageSrc}
              alt={fileName}
              onLoad={() => setIsLoaded(true)}
              onError={() => setLoadError(true)}
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: 'center center',
                maxWidth: zoom === 1 ? '100%' : 'none',
                maxHeight: zoom === 1 ? 'calc(100vh - 120px)' : 'none',
              }}
              className={`rounded-lg shadow-2xl object-contain border border-slate-800/80 bg-slate-900/60 ${
                isLoaded ? 'opacity-100' : 'opacity-0'
              } transition-opacity duration-200`}
            />
          </div>
        )}
      </div>
    </div>
  );
};
