import React, { useMemo } from 'react';
import DOMPurify from 'dompurify';

export const SandboxedHtmlRenderer: React.FC<{ htmlContent: string }> = ({ htmlContent }) => {
  const sanitized = useMemo(() => {
    return DOMPurify.sanitize(htmlContent, {
      WHOLE_DOCUMENT: true,
      RETURN_TRUSTED_TYPE: false,
    });
  }, [htmlContent]);

  return (
    <div dir="ltr" className="h-full w-full flex flex-col rounded-2xl border border-slate-800 bg-white overflow-hidden shadow-xl">
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-2 text-xs font-mono text-slate-400 flex items-center justify-between">
        <span>Sandboxed HTML View (Scripts & external navigation disabled)</span>
      </div>
      <iframe
        title="Sandboxed Document View"
        sandbox=""
        srcDoc={sanitized}
        className="w-full flex-1 border-0 min-h-[600px] bg-white"
      />
    </div>
  );
};
