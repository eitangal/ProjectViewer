import React, { useState } from 'react';
import { ApiReferenceReact } from '@scalar/api-reference-react';
import '@scalar/api-reference-react/style.css';
import { useViewerStore } from '../../store/useViewerStore.js';

export const OpenApiSpecRenderer: React.FC<{ rawSpec: string }> = ({ rawSpec }) => {
  const [hasError, setHasError] = useState(false);
  const { theme } = useViewerStore();

  if (hasError) {
    return (
      <div dir="ltr" className="p-6 bg-slate-900 border border-slate-800 rounded-2xl">
        <h3 className="text-amber-400 font-semibold mb-2">Unable to render interactive OpenAPI view</h3>
        <p className="text-sm text-slate-400 mb-4">You can switch to the "Raw Code" view in the top navigation bar to inspect the raw specification file.</p>
        <pre className="p-4 bg-slate-950 rounded-xl overflow-x-auto text-xs font-mono text-slate-300 max-h-[600px]">
          {rawSpec}
        </pre>
      </div>
    );
  }

  return (
    <div dir="ltr" className="h-full w-full overflow-y-auto rounded-2xl border border-slate-800 bg-slate-950">
      <ApiReferenceReact
        configuration={{
          spec: {
            content: rawSpec,
          },
          darkMode: theme === 'dark',
          hideDownloadButton: false,
          showSidebar: true,
        }}
      />
    </div>
  );
};
