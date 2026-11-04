The Viewer UI is architected as a modular React 19 Single-Page Application (or Next.js App Router client boundary) using **Zustand** for low-overhead UI state, **TanStack Query** for ACL-scoped file fetching/caching, and **Tailwind CSS v4 logical properties** for zero-layout-shift bi-directional (LTR/RTL) rendering.

## **1\. Component Hierarchy & Responsibility Tree**

`<ViewerWorkspaceLayout> (Sets dir="ltr|rtl" on root container)`  
 `├── <TopNavigationBar>`  
 `│    ├── <SidebarToggleButton /> (☰ Hamburger menu trigger)`  
 `│    ├── <ProjectSwitcherDropdown />`  
 `│    ├── <InteractiveBreadcrumbs />`  
 `│    └── <WorkspaceToolbar>`  
 `│         ├── <ViewModeSegmentedControl /> (Formatted | Raw Code)`  
 `│         ├── <DirectionSegmentedControl /> (LTR | RTL)`  
 `│         └── <AiDrawerToggleButton /> (✨ AI Assistant)`  
 `│`  
 `├── <MainContentSplitPane>`  
 `│    ├── <CollapsibleFileSidebar> (Logical start dock; Drawer on mobile)`  
 `│    │    ├── <QuickFileSearchFilter /> (Cmd/Ctrl + K fuzzy filter)`  
 `│    │    └── <VirtualizedFileTree>`  
 `│    │         └── <FileTreeNode /> (Recursive folder/file item)`  
 `│    │`  
 `│    ├── <DocumentViewport> (Central scrollable canvas)`  
 `│    │    ├── <DocumentRouterSwitch> (Dispatches by extension & content sniff)`  
 `│    │    │    ├── <MarkdownRenderer /> (.md, .mdx + embedded Mermaid)`  
 `│    │    │    ├── <OpenApiSpecRenderer /> (.yaml/.json with openapi/swagger root)`  
 `│    │    │    ├── <StandaloneMermaidRenderer /> (.mmd, .mermaid)`  
 `│    │    │    ├── <SandboxedHtmlRenderer /> (.html)`  
 `│    │    │    └── <RawCodeRenderer /> (Fallback & explicit "Raw" mode via Shiki)`  
 `│    │    └── <AnchorScrollManager /> (Handles #hash scrolling after render)`  
 `│    │`  
 `│    └── <RagAssistantDrawer> (Logical end dock; conditional on Gemini Key)`  
 `│         ├── <ChatTranscriptList />`  
 `│         │    └── <ChatMessageItem /> (Parses [filepath:line] citations)`  
 `│         └── <ChatPromptComposer />`

## **2\. State Management Architecture (Zustand \+ URL Sync)**

Selected file paths and heading anchors are kept in the URL (?path=docs/arch/overview.md\#auth-flow) so viewers can bookmark or share links with co-workers in the same Viewer Group, while layout preferences persist in localStorage.  
`// store/useViewerStore.ts`  
`import { create } from 'zustand';`  
`import { persist } from 'zustand/middleware';`

`export type TextDirection = 'ltr' | 'rtl';`  
`export type ViewMode = 'formatted' | 'raw';`

`interface ViewerState {`  
  `// Layout & UI Toggles`  
  `isSidebarOpen: boolean;`  
  `isAiDrawerOpen: boolean;`  
  `direction: TextDirection;`  
  `viewMode: ViewMode;`

  `// Active Navigation Context`  
  `projectId: string;`  
  `activeFilePath: string | null;`  
  `activeHash: string | null;`  
  `authorizedPathsSet: Set<string>; // Pre-loaded from backend ACL manifest`

  `// Actions`  
  `toggleSidebar: () => void;`  
  `toggleAiDrawer: () => void;`  
  `setDirection: (dir: TextDirection) => void;`  
  `setViewMode: (mode: ViewMode) => void;`  
  `navigateToFile: (path: string, hash?: string | null) => boolean;`  
  `setAuthorizedPaths: (paths: string[]) => void;`  
`}`

`export const useViewerStore = create<ViewerState>()(`  
  `persist(`  
    `(set, get) => ({`  
      `isSidebarOpen: true,`  
      `isAiDrawerOpen: false,`  
      `direction: 'ltr',`  
      `viewMode: 'formatted',`  
      `projectId: '',`  
      `activeFilePath: null,`  
      `activeHash: null,`  
      `authorizedPathsSet: new Set(),`

      `toggleSidebar: () => set((s) => ({ isSidebarOpen: !s.isSidebarOpen })),`  
      `toggleAiDrawer: () => set((s) => ({ isAiDrawerOpen: !s.isAiDrawerOpen })),`  
      `setDirection: (direction) => set({ direction }),`  
      `setViewMode: (viewMode) => set({ viewMode }),`

      `setAuthorizedPaths: (paths) =>`  
        `set({ authorizedPathsSet: new Set(paths) }),`

      `navigateToFile: (targetPath, hash = null) => {`  
        `const normalized = targetPath.replace(/^\/+/, '');`  
        `const { authorizedPathsSet } = get();`

        `// Client-side ACL gate check before switching view`  
        `if (!authorizedPathsSet.has(normalized)) {`  
          `return false; // Caller triggers "Access Restricted" toast`  
        `}`

        `set({ activeFilePath: normalized, activeHash: hash });`  
        `window.history.pushState(`  
          `null,`  
          `'',`  
          `` `?path=$encodeURIComponent(normalized)${hash ? `#${hash}` : ''}` ``  
        `);`  
        `return true;`  
      `},`  
    `}),`  
    `{`  
      `name: 'gitportal-viewer-prefs',`  
      `partialize: (state) => ({`  
        `isSidebarOpen: state.isSidebarOpen,`  
        `direction: state.direction,`  
        `viewMode: state.viewMode,`  
      `}),`  
    `}`  
  `)`  
`);`

## **3\. Bi-Directional (RTL / LTR) Layout Engine**

To ensure seamless switching between English and Hebrew/Arabic documentation without breaking code blocks, diagrams, or sidebar animations, the UI relies on **CSS Logical Properties** rather than physical left/right utilities:

> * **Physical Utilities (Avoided):** ml-4, border-r, left-0, text-left  
> * **Logical Utilities (Enforced):** ms-4 (margin-inline-start), border-e (border-inline-end), start-0 (inset-inline-start), text-start

`// components/ViewerWorkspaceLayout.tsx`  
`import React from 'react';`  
`import { useViewerStore } from '../store/useViewerStore';`

`export const ViewerWorkspaceLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {`  
  `const { direction, isSidebarOpen, toggleSidebar, setDirection } = useViewerStore();`

  `return (`  
    `<div`  
      `dir={direction}`  
      `className="flex flex-col h-screen w-screen overflow-hidden bg-slate-950 text-slate-100"`  
    `>`  
      `{/* Top Bar */}`  
      `<header className="h-14 border-b border-slate-800 flex items-center justify-between px-4 shrink-0">`  
        `<div className="flex items-center gap-3">`  
          `<button`  
            `onClick={toggleSidebar}`  
            `aria-label="Toggle File Tree"`  
            `className="p-2 rounded-lg hover:bg-slate-800 transition-colors"`  
          `>`  
            `☰`  
          `</button>`  
          `<span className="font-semibold text-sm tracking-wide">Project Portal</span>`  
        `</div>`

        `{/* LTR / RTL Switcher */}`  
        `<div className="flex items-center gap-2 bg-slate-900 p-1 rounded-lg border border-slate-800">`  
          `<button`  
            `onClick={() => setDirection('ltr')}`  
            ``className={`px-2.5 py-1 text-xs rounded ${``  
              `direction === 'ltr' ? 'bg-indigo-600 text-white' : 'text-slate-400'`  
            ``}`}``  
          `>`  
            `LTR`  
          `</button>`  
          `<button`  
            `onClick={() => setDirection('rtl')}`  
            ``className={`px-2.5 py-1 text-xs rounded ${``  
              `direction === 'rtl' ? 'bg-indigo-600 text-white' : 'text-slate-400'`  
            ``}`}``  
          `>`  
            `RTL`  
          `</button>`  
        `</div>`  
      `</header>`

      `{/* Main Split Workspace */}`  
      `<div className="flex flex-1 overflow-hidden relative">`  
        `{children}`  
      `</div>`  
    `</div>`  
  `);`  
`};`

**Code & Diagram Isolation Rule:** Inside \<MarkdownRenderer/\> and \<RawCodeRenderer/\>, every \<pre\>, \<code\>, and .mermaid-wrapper explicitly enforces dir="ltr" and className="text-left font-mono" so source code and diagrams never invert token order when the document is viewed in RTL mode.

## **4\. Relative Link Interception & Resolution**

When a viewer clicks a link inside a rendered Markdown or HTML file (e.g., \[See Auth Spec\](../specs/auth-api.yaml\#token-endpoint)), the portal must resolve the relative path against the directory of the currently open file, verify ACL permissions, and transition the viewport without a full page reload.  
`// utils/resolveRepoLink.ts`  
`export interface ResolvedLink {`  
  `type: 'external' | 'anchor-only' | 'internal-repo';`  
  `targetPath?: string;`  
  `hash?: string;`  
  `rawHref: string;`  
`}`

`export function resolveRepoLink(currentFilePath: string, rawHref: string): ResolvedLink {`  
  `// 1. External protocols (http, https, mailto, tel)`  
  `if (/^(https?:|mailto:|tel:)/i.test(rawHref)) {`  
    `return { type: 'external', rawHref };`  
  `}`

  `// 2. Same-document anchor (#section-name)`  
  `if (rawHref.startsWith('#')) {`  
    `return { type: 'anchor-only', hash: rawHref.slice(1), rawHref };`  
  `}`

  `// 3. Relative or root-relative repository path`  
  `const [pathPart, hashPart] = rawHref.split('#');`  
  `const currentDirSegments = currentFilePath.split('/').slice(0, -1);`

  `const inputSegments = pathPart.startsWith('/')`  
    `? pathPart.slice(1).split('/')`  
    `: [...currentDirSegments, ...pathPart.split('/')];`

  `const resolvedStack: string[] = [];`  
  `for (const segment of inputSegments) {`  
    `if (!segment || segment === '.') continue;`  
    `if (segment === '..') {`  
      `resolvedStack.pop();`  
    `} else {`  
      `resolvedStack.push(segment);`  
    `}`  
  `}`

  `return {`  
    `type: 'internal-repo',`  
    `targetPath: resolvedStack.join('/'),`  
    `hash: hashPart || undefined,`  
    `rawHref,`  
  `};`  
`}`

### **Custom Anchor Override for react-markdown**

`// components/renderers/SmartMarkdownLink.tsx`  
`import React from 'react';`  
`import { useViewerStore } from '../../store/useViewerStore';`  
`import { resolveRepoLink } from '../../utils/resolveRepoLink';`

`export const SmartMarkdownLink: React.FC<`  
  `React.AnchorHTMLAttributes<HTMLAnchorElement>`  
`> = ({ href = '', children, ...props }) => {`  
  `const { activeFilePath, navigateToFile } = useViewerStore();`

  `const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {`  
    `if (!activeFilePath || !href) return;`  
    `const resolved = resolveRepoLink(activeFilePath, href);`

    `if (resolved.type === 'external') {`  
      `return; // Allow browser default new-tab navigation`  
    `}`

    `e.preventDefault();`

    `if (resolved.type === 'anchor-only' && resolved.hash) {`  
      `document.getElementById(resolved.hash)?.scrollIntoView({ behavior: 'smooth' });`  
      `return;`  
    `}`

    `if (resolved.type === 'internal-repo' && resolved.targetPath) {`  
      `const allowed = navigateToFile(resolved.targetPath, resolved.hash);`  
      `if (!allowed) {`  
        `// Trigger non-intrusive toast notification`  
        `window.dispatchEvent(`  
          `new CustomEvent('portal:toast', {`  
            `detail: {`  
              `type: 'warning',`  
              ``message: `Access restricted: "${resolved.targetPath}" is outside your viewer group scope.`,``  
            `},`  
          `})`  
        `);`  
      `}`  
    `}`  
  `};`

  `const isExternal = /^(https?:|mailto:)/i.test(href);`

  `return (`  
    `<a`  
      `href={href}`  
      `onClick={handleClick}`  
      `target={isExternal ? '_blank' : undefined}`  
      `rel={isExternal ? 'noopener noreferrer' : undefined}`  
      `className="text-indigo-400 hover:text-indigo-300 underline underline-offset-4 cursor-pointer"`  
      `{...props}`  
    `>`  
      `{children}`  
    `</a>`  
  `);`  
`};`

## **5\. Multi-Format Dispatcher & Specialized Renderers**

### **5.1 Document Router Switch (\<DocumentRouterSwitch/\>)**

Inspects both the file extension and, for .yaml/.yml/.json files, the top-level keys to distinguish a standard configuration file from an OpenAPI/Swagger specification.  
`// utils/detectDocumentFormat.ts`  
`export type DocumentFormat = 'markdown' | 'openapi' | 'mermaid' | 'html' | 'code';`

`export function detectDocumentFormat(filePath: string, content: string): DocumentFormat {`  
  `const ext = filePath.split('.').pop()?.toLowerCase() ?? '';`

  `if (['md', 'mdx', 'markdown'].includes(ext)) return 'markdown';`  
  `if (['mmd', 'mermaid'].includes(ext)) return 'mermaid';`  
  `if (['html', 'htm'].includes(ext)) return 'html';`

  `if (['yaml', 'yml', 'json'].includes(ext)) {`  
    `// Fast regex check on first 500 chars for OpenAPI / Swagger signature`  
    `const headerSlice = content.slice(0, 500);`  
    `if (/^\s*["']?(openapi|swagger)["']?\s*:/m.test(headerSlice)) {`  
      `return 'openapi';`  
    `}`  
  `}`

  `return 'code';`  
`}`

### **5.2 Interactive Mermaid Renderer (\<MermaidBlock/\>)**

Used both for standalone .mmd files and fenced \`\`\`mermaid blocks inside Markdown. Includes pan/zoom controls and isolation from RTL reversal.  
`// components/renderers/MermaidBlock.tsx`  
`import React, { useEffect, useId, useRef, useState } from 'react';`  
`import mermaid from 'mermaid';`

`mermaid.initialize({`  
  `startOnLoad: false,`  
  `theme: 'dark',`  
  `securityLevel: 'strict', // Prevents script injection inside diagram labels`  
  `fontFamily: 'Inter, system-ui, sans-serif',`  
`});`

`export const MermaidBlock: React.FC<{ chart: string }> = ({ chart }) => {`  
  `const id = useId().replace(/:/g, '');`  
  `const containerRef = useRef<HTMLDivElement>(null);`  
  `const [svgContent, setSvgContent] = useState<string>('');`  
  `const [scale, setScale] = useState<number>(1);`  
  `const [error, setError] = useState<string | null>(null);`

  `useEffect(() => {`  
    `let isMounted = true;`  
    `mermaid`  
      ``.render(`mermaid-svg-${id}`, chart)``  
      `.then(({ svg }) => {`  
        `if (isMounted) {`  
          `setSvgContent(svg);`  
          `setError(null);`  
        `}`  
      `})`  
      `.catch((err) => {`  
        `if (isMounted) setError(err.message || 'Invalid Mermaid syntax');`  
      `});`  
    `return () => {`  
      `isMounted = false;`  
    `};`  
  `}, [chart, id]);`

  `if (error) {`  
    `return (`  
      `<pre dir="ltr" className="p-4 bg-rose-950/40 border border-rose-800 rounded-lg text-rose-300 text-xs">`  
        `Mermaid Render Error: {error}`  
      `</pre>`  
    `);`  
  `}`

  `return (`  
    `<div dir="ltr" className="my-4 rounded-xl border border-slate-800 bg-slate-900/70 overflow-hidden">`  
      `<div className="flex items-center justify-end gap-2 px-3 py-1.5 bg-slate-900 border-b border-slate-800 text-xs">`  
        `<button onClick={() => setScale((s) => Math.max(0.5, s - 0.25))} className="px-2 py-0.5 bg-slate-800 rounded">-</button>`  
        `<span className="text-slate-400">{Math.round(scale * 100)}%</span>`  
        `<button onClick={() => setScale((s) => Math.min(2.5, s + 0.25))} className="px-2 py-0.5 bg-slate-800 rounded">+</button>`  
        `<button onClick={() => setScale(1)} className="px-2 py-0.5 bg-slate-800 rounded">Reset</button>`  
      `</div>`  
      `<div className="p-6 overflow-auto flex justify-center">`  
        `<div`  
          `ref={containerRef}`  
          ``style={{ transform: `scale(${scale})`, transformOrigin: 'top center' }}``  
          `className="transition-transform duration-150"`  
          `dangerouslySetInnerHTML={{ __html: svgContent }}`  
        `/>`  
      `</div>`  
    `</div>`  
  `);`  
`};`

### **5.3 OpenAPI / Swagger Renderer (\<OpenApiSpecRenderer /\>)**

Uses @scalar/api-reference-react (or swagger-ui-react lazy-loaded via React.lazy) to render interactive API schemas while intercepting relative \$ref or external description links.  
`// components/renderers/OpenApiSpecRenderer.tsx`  
`import React from 'react';`  
`import { ApiReferenceReact } from '@scalar/api-reference-react';`  
`import '@scalar/api-reference-react/style.css';`

`export const OpenApiSpecRenderer: React.FC<{ rawSpec: string }> = ({ rawSpec }) => {`  
  `return (`  
    `<div dir="ltr" className="h-full w-full overflow-y-auto rounded-lg border border-slate-800">`  
      `<ApiReferenceReact configuration="{{" content: darkMode: false, hideDownloadButton: rawSpec showSidebar: spec: true, { }, }}/>`  
    `</div>`  
  `);`  
`};`

### **5.4 Citation Interception in the AI RAG Drawer**

When the Gemini RAG assistant streams back responses containing \[docs/arch/overview.md\#auth\] citations, a lightweight regex parser converts them into interactive \<CitationPill /\> buttons that invoke useViewerStore.getState().navigateToFile(path, hash), smoothly opening the referenced file in the central viewport alongside the chat.