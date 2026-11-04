import React, { useEffect, useId, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { ZoomIn, ZoomOut, RotateCcw, Copy, Check } from 'lucide-react';
import { useViewerStore } from '../../store/useViewerStore.js';

export const MermaidBlock: React.FC<{ chart: string }> = ({ chart }) => {
  const { theme } = useViewerStore();
  const rawId = useId();
  const id = 'mermaid_' + rawId.replace(/[^a-zA-Z0-9]/g, '');
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgContent, setSvgContent] = useState<string>('');
  const [scale, setScale] = useState<number>(1);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;
    try {
      mermaid.initialize({
        startOnLoad: false,
        theme: theme === 'light' ? 'default' : 'dark',
        securityLevel: 'strict',
        fontFamily: 'Inter, system-ui, sans-serif',
      });

      mermaid
        .render(id, chart)
        .then(({ svg }) => {
          if (isMounted) {
            setSvgContent(svg);
            setError(null);
          }
        })
        .catch((err) => {
          if (isMounted) setError(err.message || 'Invalid Mermaid syntax');
        });
    } catch (err: any) {
      if (isMounted) setError(err.message || 'Failed to render Mermaid diagram');
    }

    return () => {
      isMounted = false;
    };
  }, [chart, id, theme]);

  const handleCopySource = () => {
    navigator.clipboard.writeText(chart);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (error) {
    return (
      <div dir="ltr" className="my-4 p-4 bg-rose-950/40 border border-rose-800 rounded-xl text-rose-300 text-xs font-mono">
        <p className="font-semibold mb-1">Mermaid Render Error</p>
        <p>{error}</p>
        <pre className="mt-2 p-2 bg-slate-900 rounded overflow-x-auto text-slate-400">{chart}</pre>
      </div>
    );
  }

  return (
    <div dir="ltr" className="my-6 rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden shadow-lg">
      <div className="flex items-center justify-between px-4 py-2 bg-slate-900/80 border-b border-slate-800 text-xs text-slate-400">
        <span className="font-mono text-[11px] uppercase tracking-wider text-slate-400">Mermaid Diagram</span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setScale((s) => Math.max(0.5, s - 0.2))}
            title="Zoom Out"
            className="p-1 hover:bg-slate-800 rounded text-slate-300 transition-colors"
          >
            <ZoomOut size={14} />
          </button>
          <span className="text-[11px] font-mono px-1">{Math.round(scale * 100)}%</span>
          <button
            onClick={() => setScale((s) => Math.min(2.5, s + 0.2))}
            title="Zoom In"
            className="p-1 hover:bg-slate-800 rounded text-slate-300 transition-colors"
          >
            <ZoomIn size={14} />
          </button>
          <button
            onClick={() => setScale(1)}
            title="Reset Zoom"
            className="p-1 hover:bg-slate-800 rounded text-slate-300 transition-colors"
          >
            <RotateCcw size={14} />
          </button>
          <div className="w-[1px] h-3 bg-slate-800 mx-1" />
          <button
            onClick={handleCopySource}
            title="Copy Mermaid Source"
            className="p-1 hover:bg-slate-800 rounded text-slate-300 transition-colors flex items-center gap-1 text-[11px]"
          >
            {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
          </button>
        </div>
      </div>
      <div className="p-6 overflow-auto flex justify-center bg-slate-950/40">
        <div
          ref={containerRef}
          style={{ transform: `scale(${scale})`, transformOrigin: 'top center' }}
          className="transition-transform duration-150 max-w-full"
          dangerouslySetInnerHTML={{ __html: svgContent }}
        />
      </div>
    </div>
  );
};
