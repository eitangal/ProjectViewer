import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { useViewerStore } from '../../store/useViewerStore.js';

export const RawCodeRenderer: React.FC<{ code: string; filePath?: string }> = ({
  code,
  filePath = '',
}) => {
  const { activeHash } = useViewerStore();
  const [copied, setCopied] = useState(false);
  const targetLineRef = useRef<HTMLTableRowElement>(null);

  const lines = useMemo(() => code.split(/\r?\n/), [code]);

  // Parse anchor hash for line range highlight (e.g. #L12-L40 or #L15)
  const targetRange = useMemo(() => {
    if (!activeHash) return null;
    const match = activeHash.match(/^L?(\d+)(?:-L?(\d+))?$/i);
    if (!match) return null;
    const start = parseInt(match[1], 10);
    const end = match[2] ? parseInt(match[2], 10) : start;
    return { start, end };
  }, [activeHash]);

  useEffect(() => {
    if (targetLineRef.current) {
      targetLineRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [targetRange]);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div dir="ltr" className="rounded-2xl border border-slate-800 bg-slate-950 overflow-hidden shadow-xl text-left">
      <div className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-800 text-xs text-slate-400">
        <span className="font-mono text-slate-300">{filePath || 'Source Code'} ({lines.length} lines)</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
        >
          {copied ? (
            <>
              <Check size={13} className="text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy size={13} />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      <div className="p-4 overflow-x-auto font-mono text-xs leading-relaxed max-h-[75vh] select-text">
        <table className="w-full border-collapse">
          <tbody>
            {lines.map((line, idx) => {
              const lineNum = idx + 1;
              const isTargeted =
                targetRange && lineNum >= targetRange.start && lineNum <= targetRange.end;
              const isTargetStart = targetRange && lineNum === targetRange.start;

              return (
                <tr
                  key={lineNum}
                  ref={isTargetStart ? targetLineRef : undefined}
                  className={`transition-colors ${
                    isTargeted ? 'bg-indigo-950/60 border-s-2 border-indigo-500' : 'hover:bg-slate-900/40'
                  }`}
                >
                  <td className="w-12 pe-4 text-right text-slate-600 select-none align-top">
                    <a
                      href={`#L${lineNum}`}
                      className="hover:text-slate-400 text-[11px]"
                    >
                      {lineNum}
                    </a>
                  </td>
                  <td className="whitespace-pre text-slate-200 ps-2 pe-4">
                    {line || '\n'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
