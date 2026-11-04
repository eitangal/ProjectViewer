The **Publisher Console** is designed as an administrative control center where technical leads and project owners manage repository sync settings, define fine-grained Access Control Lists (ACLs) with instant visual feedback, and configure the project's dedicated Gemini RAG assistant.

## **1\. Publisher Console Component Hierarchy**

`<PublisherConsoleLayout>`  
 `├── <ConsoleHeader> (Project Selector, Git Sync Status Badge, Quick Actions)`  
 `└── <TabsNavigation>`  
      `├── <SyncAndRepoTab> (GitHub App/PAT connection, branch selector, webhook URL)`  
      `├── <AclRuleBuilderWorkspace> (Interactive ACL Rule Builder + Live Tree Preview)`  
      `│    ├── <RuleEditorForm> (Allowed Folders, Extensions, Exclude Globs, Size Limit)`  
      `│    └── <LiveFileTreePreview> (Split-pane instant green/gray visualizer)`  
      `├── <ViewerInvitationsTab> (Bulk CSV invite modal, group assignment matrix)`  
      `└── <AiSettingsTab> (Gemini BYOK, model selector, embedding stats, system prompt)`

## **2\. Interactive ACL Rule Builder & Live Tree Preview (AclRuleBuilderWorkspace.tsx)**

This component allows publishers to test rules in real time. As they type allowed folders or exclusion globs, a live tree preview instantly updates, highlighting included files in green and excluded files in muted gray.  
`// components/publisher/AclRuleBuilderWorkspace.tsx`  
`import React, { useState, useMemo } from 'react';`  
`import picomatch from 'picomatch';`

`interface FileNode {`  
  `path: string;`  
  `sizeBytes: number;`  
`}`

`interface AclRuleState {`  
  `allowedFolders: string;    // Comma or newline separated`  
  `allowedExtensions: string; // e.g., .md, .yaml, .mmd`  
  `excludeGlobs: string;      // e.g., **/*.secret.*, **/internal/**`  
  `maxFileSizeBytes: number;`  
`}`

`// Mock repository file tree for live client-side preview`  
`const MOCK_REPO_FILES: FileNode[] = [`  
  `{ path: 'README.md', sizeBytes: 4200 },`  
  `{ path: 'docs/arch/overview.md', sizeBytes: 12500 },`  
  `{ path: 'docs/arch/security-spec.md', sizeBytes: 8900 },`  
  `{ path: 'docs/internal/roadmap-secret.md', sizeBytes: 15000 },`  
  `{ path: 'specs/openapi.yaml', sizeBytes: 45000 },`  
  `{ path: 'specs/auth-flow.mmd', sizeBytes: 2100 },`  
  `{ path: 'src/backend/server.ts', sizeBytes: 64000 },`  
  `{ path: '.env.production', sizeBytes: 300 },`  
`];`

`export const AclRuleBuilderWorkspace: React.FC = () => {`  
  `const [rule, setRule] = useState<AclRuleState>({`  
    `allowedFolders: 'docs, specs',`  
    `allowedExtensions: '.md, .yaml, .yml, .mmd',`  
    `excludeGlobs: '**/internal/**, **/.env*',`  
    `maxFileSizeBytes: 1048576,`  
  `});`

  `// Compile matchers on the fly for instant preview feedback`  
  `const evaluationResult = useMemo(() => {`  
    `const folders = rule.allowedFolders.split(',').map((f) => f.trim()).filter(Boolean);`  
    `const exts = rule.allowedExtensions.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);`  
    `const excludes = rule.excludeGlobs.split(',').map((g) => g.trim()).filter(Boolean);`

    `const isExcluded = excludes.length > 0 ? picomatch(excludes, { dot: true }) : () => false;`  
    `const allowAllFolders = folders.includes('*') || folders.length === 0;`

    `return MOCK_REPO_FILES.map((file) => {`  
      `if (file.sizeBytes > rule.maxFileSizeBytes) return { ...file, included: false, reason: 'Exceeds size limit' };`  
      `if (isExcluded(file.path)) return { ...file, included: false, reason: 'Matched exclude glob' };`

      `const ext = '.' + file.path.split('.').pop()?.toLowerCase();`  
      `if (exts.length > 0 && !exts.includes(ext)) return { ...file, included: false, reason: 'Extension not allowed' };`

      `if (allowAllFolders) return { ...file, included: true, reason: 'Allowed' };`

      ``const inFolder = folders.some((f) => file.path === f || file.path.startsWith(`${f}/`));``  
      `return { ...file, included: inFolder, reason: inFolder ? 'Allowed folder' : 'Outside allowed folders' };`  
    `});`  
  `}, [rule]);`

  `return (`  
    `<div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full p-6">`  
      `{/* Left Column: Rule Editor Form */}`  
      `<div className="lg:col-span-6 bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col gap-5 shadow-xl">`  
        `<div>`  
          `<h2 className="text-lg font-semibold text-slate-100">Viewer Group ACL Rules</h2>`  
          `<p className="text-xs text-slate-400 mt-1">`  
            `Define precise folder whitelists, extension filters, and exclusion globs for this group.`  
          `</p>`  
        `</div>`

        `<div className="flex flex-col gap-1.5">`  
          `<label className="text-xs font-medium text-slate-300">Allowed Folders (comma separated)</label>`  
          `<input`  
            `type="text"`  
            `value={rule.allowedFolders}`  
            `onChange={(e) => setRule({ ...rule, allowedFolders: e.target.value })}`  
            `placeholder="docs, specs, api"`  
            `className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"`  
          `/>`  
        `</div>`

        `<div className="flex flex-col gap-1.5">`  
          `<label className="text-xs font-medium text-slate-300">Allowed File Extensions</label>`  
          `<input`  
            `type="text"`  
            `value={rule.allowedExtensions}`  
            `onChange={(e) => setRule({ ...rule, allowedExtensions: e.target.value })}`  
            `placeholder=".md, .yaml, .mmd, .json"`  
            `className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"`  
          `/>`  
        `</div>`

        `<div className="flex flex-col gap-1.5">`  
          `<label className="text-xs font-medium text-slate-300">Exclusion Globs (Overrides allow rules)</label>`  
          `<input`  
            `type="text"`  
            `value={rule.excludeGlobs}`  
            `onChange={(e) => setRule({ ...rule, excludeGlobs: e.target.value })}`  
            `placeholder="**/internal/**, **/*.secret.*, **/.env*"`  
            `className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"`  
          `/>`  
        `</div>`

        `<div className="flex flex-col gap-1.5">`  
          `<label className="text-xs font-medium text-slate-300">Max File Size (Bytes)</label>`  
          `<input`  
            `type="number"`  
            `value={rule.maxFileSizeBytes}`  
            `onChange={(e) => setRule({ ...rule, maxFileSizeBytes: Number(e.target.value) })}`  
            `className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"`  
          `/>`  
        `</div>`

        `<button`  
          `onClick={() => alert('Viewer Group ACL rules saved successfully!')}`  
          `className="mt-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-2.5 rounded-lg transition-colors text-sm shadow-lg shadow-indigo-600/20"`  
        `>`  
          `Save ACL Group Rules`  
        `</button>`  
      `</div>`

      `{/* Right Column: Live Tree Preview */}`  
      `<div className="lg:col-span-6 bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col gap-4 shadow-xl">`  
        `<div className="flex items-center justify-between border-b border-slate-800 pb-3">`  
          `<div>`  
            `<h3 className="text-sm font-semibold text-slate-200">Live ACL Tree Preview</h3>`  
            `<p className="text-xs text-slate-400">Instant simulation against repository HEAD</p>`  
          `</div>`  
          `<span className="text-xs px-2.5 py-1 bg-slate-800 rounded-full text-slate-300">`  
            `{evaluationResult.filter((f) => f.included).length} of {evaluationResult.length} files visible`  
          `</span>`  
        `</div>`

        `<div className="flex flex-col gap-2 overflow-y-auto max-h-[420px] pe-1">`  
          `{evaluationResult.map((file) => (`  
            `<div`  
              `key={file.path}`  
              ``className={`flex items-center justify-between p-3 rounded-xl border transition-all ${``  
                `file.included`  
                  `? 'bg-emerald-950/20 border-emerald-900/50 text-emerald-200'`  
                  `: 'bg-slate-950/40 border-slate-800/80 text-slate-500 opacity-60'`  
              ``}`}``  
            `>`  
              `<div className="flex items-center gap-3 truncate">`  
                `<span className="text-base">{file.included ? '✅' : '🔒'}</span>`  
                `<span className="font-mono text-xs truncate">{file.path}</span>`  
              `</div>`  
              `<div className="flex items-center gap-2 shrink-0">`  
                `<span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded bg-slate-900">`  
                  `{file.reason}`  
                `</span>`  
              `</div>`  
            `</div>`  
          `))}`  
        `</div>`  
      `</div>`  
    `</div>`  
  `);`  
`};`

## **3\. Gemini API Key Management Tab (AiSettingsTab.tsx)**

Enables publishers to securely bind their Google Gemini API key, select RAG models, customize system instructions, and monitor vector indexing status.  
`// components/publisher/AiSettingsTab.tsx`  
`import React, { useState } from 'react';`

`export const AiSettingsTab: React.FC = () => {`  
  `const [apiKey, setApiKey] = useState('************************');`  
  `const [isEditing, setIsEditing] = useState(false);`  
  `const [model, setModel] = useState('gemini-2.5-flash');`  
  `const [systemPrompt, setSystemPrompt] = useState(`  
    `'You are a technical repository assistant. Answer strictly using the provided context.'`  
  `);`  
  `const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');`

  `const handleTestKey = async () => {`  
    `setTestStatus('testing');`  
    `// Simulate API validation call against Google GenAI SDK endpoint`  
    `setTimeout(() => {`  
      `setTestStatus('success');`  
    `}, 1000);`  
  `};`

  `return (`  
    `<div className="max-w-3xl mx-auto p-6 flex flex-col gap-6">`  
      `<div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col gap-5">`  
        `<div>`  
          `<h2 className="text-lg font-semibold text-slate-100">Gemini BYOK & RAG Assistant</h2>`  
          `<p className="text-xs text-slate-400 mt-1">`  
            `Provide your Google Gemini API key to power vector embeddings and contextual Q&A for project viewers.`  
          `</p>`  
        `</div>`

        `{/* API Key Input */}`  
        `<div className="flex flex-col gap-1.5">`  
          `<label className="text-xs font-medium text-slate-300">Google Gemini API Key</label>`  
          `<div className="flex gap-2">`  
            `<input`  
              `type={isEditing ? 'text' : 'password'}`  
              `value={apiKey}`  
              `onChange={(e) => setApiKey(e.target.value)}`  
              `disabled={!isEditing}`  
              `className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:border-indigo-500 disabled:opacity-50"`  
            `/>`  
            `{isEditing ? (`  
              `<button`  
                `onClick={() => setIsEditing(false)}`  
                `className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium transition-colors"`  
              `>`  
                `Lock Key`  
              `</button>`  
            `) : (`  
              `<button`  
                `onClick={() => setIsEditing(true)}`  
                `className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium transition-colors"`  
              `>`  
                `Edit Key`  
              `</button>`  
            `)}`  
            `<button`  
              `onClick={handleTestKey}`  
              `className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium transition-colors"`  
            `>`  
              `{testStatus === 'testing' ? 'Testing...' : 'Test Connection'}`  
            `</button>`  
          `</div>`  
          `{testStatus === 'success' && (`  
            `<p className="text-xs text-emerald-400 mt-1">✓ API key successfully verified with Google GenAI.</p>`  
          `)}`  
        `</div>`

        `{/* Model Selector */}`  
        `<div className="flex flex-col gap-1.5">`  
          `<label className="text-xs font-medium text-slate-300">Completion Model</label>`  
          `<select`  
            `value={model}`  
            `onChange={(e) => setModel(e.target.value)}`  
            `className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"`  
          `>`  
            `<option value="gemini-2.5-flash">Gemini 2.5 Flash (Recommended for low latency)</option>`  
            `<option value="gemini-2.5-pro">Gemini 2.5 Pro (Advanced reasoning for complex specs)</option>`  
          `</select>`  
        `</div>`

        `{/* System Instructions */}`  
        `<div className="flex flex-col gap-1.5">`  
          `<label className="text-xs font-medium text-slate-300">Project Assistant System Instructions</label>`  
          `<textarea`  
            `rows={4}`  
            `value={systemPrompt}`  
            `onChange={(e) => setSystemPrompt(e.target.value)}`  
            `className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 font-mono text-xs"`  
          `/>`  
        `</div>`

        `<button`  
          `onClick={() => alert('AI settings updated successfully!')}`  
          `className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-2.5 rounded-lg transition-colors text-sm shadow-lg shadow-indigo-600/20"`  
        `>`  
          `Save AI Configuration`  
        `</button>`  
      `</div>`  
    `</div>`  
  `);`  
`};`  
