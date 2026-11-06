import { describe, it, expect, beforeEach } from 'vitest';
import {
  CompiledGroupMatcher,
  resolveAuthorizedFiles,
  buildPrunedFileTree,
} from '../src/backend/services/aclMatcher.js';
import { resolveRepoLink } from '../src/frontend/utils/resolveRepoLink.js';
import { detectDocumentFormat } from '../src/frontend/utils/detectDocumentFormat.js';
import { useViewerStore } from '../src/frontend/store/useViewerStore.js';
import { GroupAclRule, RepoFileEntry } from '../src/shared/types.js';

describe('1. Compiled ACL Matcher Engine (aclMatcher.ts)', () => {
  const mockFiles: RepoFileEntry[] = [
    { filePath: 'README.md', sizeBytes: 2000 },
    { filePath: 'docs/arch/overview.md', sizeBytes: 5000 },
    { filePath: 'docs/arch/security-spec.md', sizeBytes: 6000 },
    { filePath: 'docs/internal/roadmap-secret.md', sizeBytes: 8000 },
    { filePath: 'docs/internal/database-passwords.txt', sizeBytes: 1500 },
    { filePath: 'specs/openapi.yaml', sizeBytes: 15000 },
    { filePath: 'specs/auth-flow.mmd', sizeBytes: 1200 },
    { filePath: 'src/backend/server.ts', sizeBytes: 45000 },
    { filePath: 'src/backend/secret.key', sizeBytes: 256 },
    { filePath: '.env.production', sizeBytes: 300 },
    { filePath: 'large-dump.json', sizeBytes: 5000000 }, // 5MB
  ];

  it('matches files matching allowed folders and extensions while enforcing exclusion globs', () => {
    const rule: GroupAclRule = {
      groupId: 'external-partners',
      allowedFolders: ['docs', 'specs'],
      allowedExtensions: ['.md', '.yaml', '.mmd'],
      excludeGlobs: ['**/internal/**', '**/*.secret.*', '**/.env*'],
      maxFileSizeBytes: 2 * 1024 * 1024,
    };

    const matcher = new CompiledGroupMatcher(rule);

    // Allowed docs/specs
    expect(matcher.matches({ filePath: 'docs/arch/overview.md', sizeBytes: 5000 }).matches).toBe(true);
    expect(matcher.matches({ filePath: 'specs/openapi.yaml', sizeBytes: 15000 }).matches).toBe(true);
    expect(matcher.matches({ filePath: 'specs/auth-flow.mmd', sizeBytes: 1200 }).matches).toBe(true);

    // Disallowed by folder
    expect(matcher.matches({ filePath: 'src/backend/server.ts', sizeBytes: 45000 }).matches).toBe(false);

    // Disallowed by extension (.txt not in .md, .yaml, .mmd)
    expect(matcher.matches({ filePath: 'docs/internal/database-passwords.txt', sizeBytes: 1500 }).matches).toBe(false);

    // Overridden by exclude glob (**/internal/** and **/*.secret.*)
    expect(matcher.matches({ filePath: 'docs/internal/roadmap-secret.md', sizeBytes: 8000 }).matches).toBe(false);
  });

  it('evaluates union of multiple viewer groups (PUB-06)', () => {
    const groupA: GroupAclRule = {
      groupId: 'group-a',
      allowedFolders: ['docs/arch'],
      allowedExtensions: ['.md'],
      excludeGlobs: [],
      maxFileSizeBytes: 1048576,
    };

    const groupB: GroupAclRule = {
      groupId: 'group-b',
      allowedFolders: ['specs'],
      allowedExtensions: ['.yaml', '.mmd'],
      excludeGlobs: [],
      maxFileSizeBytes: 1048576,
    };

    const authorized = resolveAuthorizedFiles(mockFiles, [groupA, groupB]);

    expect(authorized).toContain('docs/arch/overview.md');
    expect(authorized).toContain('docs/arch/security-spec.md');
    expect(authorized).toContain('specs/openapi.yaml');
    expect(authorized).toContain('specs/auth-flow.mmd');

    // Neither group permits src/backend/server.ts or .env
    expect(authorized).not.toContain('src/backend/server.ts');
    expect(authorized).not.toContain('.env.production');
  });

  it('prunes empty folders resulting from filtering (VIE-02)', () => {
    const authorizedEntries: RepoFileEntry[] = [
      { filePath: 'docs/arch/overview.md', sizeBytes: 5000 },
      { filePath: 'specs/openapi.yaml', sizeBytes: 15000 },
    ];

    const tree = buildPrunedFileTree(authorizedEntries);

    expect(tree).toHaveLength(2); // docs and specs
    expect(tree[0].name).toBe('docs');
    expect(tree[0].children?.[0].name).toBe('arch');
    expect(tree[0].children?.[0].children?.[0].name).toBe('overview.md');

    // Unrelated empty folders like 'src' or 'internal' are never present
    const findFolder = (name: string) => tree.find((n) => n.name === name);
    expect(findFolder('src')).toBeUndefined();
    expect(findFolder('internal')).toBeUndefined();
  });
});

describe('2. Link Interception & Resolution (resolveRepoLink.ts)', () => {
  it('correctly categorizes external web URLs', () => {
    const res = resolveRepoLink('docs/arch/overview.md', 'https://cloud.google.com/gemini');
    expect(res.type).toBe('external');
    expect(res.rawHref).toBe('https://cloud.google.com/gemini');
  });

  it('correctly handles same-document anchor links', () => {
    const res = resolveRepoLink('docs/arch/overview.md', '#system-architecture');
    expect(res.type).toBe('anchor-only');
    expect(res.hash).toBe('system-architecture');
  });

  it('resolves relative file links with directory climbing and anchor preservation', () => {
    const res = resolveRepoLink('docs/arch/overview.md', '../../specs/openapi.yaml#token-endpoint');
    expect(res.type).toBe('internal-repo');
    expect(res.targetPath).toBe('specs/openapi.yaml');
    expect(res.hash).toBe('token-endpoint');
  });

  it('resolves sibling directory links', () => {
    const res = resolveRepoLink('docs/arch/overview.md', '../security/audit.md');
    expect(res.type).toBe('internal-repo');
    expect(res.targetPath).toBe('docs/security/audit.md');
  });

  it('strips query parameters while preserving anchors', () => {
    const res = resolveRepoLink('docs/intro.md', 'subpage.html?v=1&theme=dark#auth-flow');
    expect(res.type).toBe('internal-repo');
    expect(res.targetPath).toBe('docs/subpage.html');
    expect(res.hash).toBe('auth-flow');
  });

  it('decodes URL-encoded paths (e.g. %20 for spaces)', () => {
    const res = resolveRepoLink('index.html', 'docs/user%20guide.md');
    expect(res.type).toBe('internal-repo');
    expect(res.targetPath).toBe('docs/user guide.md');
  });

  it('extracts repo paths from /api/viewer/:projectId/raw/ links', () => {
    const res = resolveRepoLink('README.md', '/api/viewer/proj-abc/raw/specs/openapi.yaml');
    expect(res.type).toBe('internal-repo');
    expect(res.targetPath).toBe('specs/openapi.yaml');
  });

  it('extracts repo paths from full same-origin raw endpoint URLs with hash', () => {
    const res = resolveRepoLink(
      'README.md',
      'http://localhost:5173/api/viewer/proj-abc/raw/specs/openapi.yaml#servers'
    );
    expect(res.type).toBe('internal-repo');
    expect(res.targetPath).toBe('specs/openapi.yaml');
    expect(res.hash).toBe('servers');
  });

  it('extracts repo paths from portal deep link queries (?path=...)', () => {
    const res1 = resolveRepoLink('index.html', '/?path=docs/arch/overview.md#system');
    expect(res1.type).toBe('internal-repo');
    expect(res1.targetPath).toBe('docs/arch/overview.md');
    expect(res1.hash).toBe('system');

    const res2 = resolveRepoLink('index.html', '?path=specs/openapi.yaml');
    expect(res2.type).toBe('internal-repo');
    expect(res2.targetPath).toBe('specs/openapi.yaml');
  });

  it('resolves links within HTML documents to other repository files', () => {
    // Relative link from root index.html to documentation HTML
    const res1 = resolveRepoLink('index.html', 'docs/overview.html');
    expect(res1.type).toBe('internal-repo');
    expect(res1.targetPath).toBe('docs/overview.html');

    // Climbing link from nested HTML file to root README.md
    const res2 = resolveRepoLink('docs/sub/page.html', '../../README.md');
    expect(res2.type).toBe('internal-repo');
    expect(res2.targetPath).toBe('README.md');

    // Link from HTML file to Markdown specification
    const res3 = resolveRepoLink('reports/summary.html', '../docs/arch/overview.md#arch');
    expect(res3.type).toBe('internal-repo');
    expect(res3.targetPath).toBe('docs/arch/overview.md');
    expect(res3.hash).toBe('arch');
  });

  it('infers missing file extensions against authorizedPaths (e.g. extensionless doc links)', () => {
    useViewerStore.setState({
      authorizedPaths: ['specs/openapi.yaml', 'docs/guide.md', 'apps/demo.html'],
    });

    const res1 = resolveRepoLink('README.md', 'specs/openapi');
    expect(res1.type).toBe('internal-repo');
    expect(res1.targetPath).toBe('specs/openapi.yaml');

    const res2 = resolveRepoLink('README.md', 'docs/guide');
    expect(res2.type).toBe('internal-repo');
    expect(res2.targetPath).toBe('docs/guide.md');

    const res3 = resolveRepoLink('README.md', 'apps/demo');
    expect(res3.type).toBe('internal-repo');
    expect(res3.targetPath).toBe('apps/demo.html');
  });
});

describe('3. Multi-Format Detection (detectDocumentFormat.ts)', () => {
  it('detects Markdown files', () => {
    expect(detectDocumentFormat('docs/arch/overview.md')).toBe('markdown');
    expect(detectDocumentFormat('README.mdx')).toBe('markdown');
  });

  it('detects Mermaid diagram files', () => {
    expect(detectDocumentFormat('specs/flow.mmd')).toBe('mermaid');
    expect(detectDocumentFormat('diagrams/arch.mermaid')).toBe('mermaid');
  });

  it('detects HTML files', () => {
    expect(detectDocumentFormat('reports/coverage.html')).toBe('html');
    expect(detectDocumentFormat('index.html')).toBe('html');
  });

  it('detects image files (PNG, JPG, SVG, WebP, GIF)', () => {
    expect(detectDocumentFormat('docs/pmo/project_phases.png')).toBe('image');
    expect(detectDocumentFormat('assets/logo.jpg')).toBe('image');
    expect(detectDocumentFormat('assets/icon.svg')).toBe('image');
    expect(detectDocumentFormat('assets/hero.webp')).toBe('image');
    expect(detectDocumentFormat('assets/animation.gif')).toBe('image');
  });

  it('detects OpenAPI / Swagger specification files via content signature', () => {
    const openapiYaml = `
openapi: 3.0.0
info:
  title: Sample API
  version: 1.0.0
`;
    expect(detectDocumentFormat('specs/api.yaml', openapiYaml)).toBe('openapi');

    const standardYaml = `
server:
  port: 8080
  host: 0.0.0.0
`;
    expect(detectDocumentFormat('config/server.yaml', standardYaml)).toBe('code');
  });
});

describe('4. In-Scope Navigation & ACL Gate Enforcement (navigateToFile)', () => {
  beforeEach(() => {
    useViewerStore.setState({
      activeFilePath: 'README.md',
      activeHash: null,
      authorizedPaths: [
        'README.md',
        'docs/arch/overview.md',
        'reports/coverage.html',
        'specs/openapi.yaml',
        'assets/logo.png',
      ],
    });
  });

  it('navigates successfully to authorized HTML and Markdown files within viewer scope', () => {
    const { navigateToFile } = useViewerStore.getState();

    // Navigate to authorized Markdown file
    const navMd = navigateToFile('docs/arch/overview.md', 'arch-summary');
    expect(navMd).toBe(true);
    expect(useViewerStore.getState().activeFilePath).toBe('docs/arch/overview.md');
    expect(useViewerStore.getState().activeHash).toBe('arch-summary');

    // Navigate to authorized HTML file
    const navHtml = navigateToFile('reports/coverage.html');
    expect(navHtml).toBe(true);
    expect(useViewerStore.getState().activeFilePath).toBe('reports/coverage.html');
    expect(useViewerStore.getState().activeHash).toBeNull();
  });

  it('blocks navigation to files outside viewer scope and emits restricted toast event', () => {
    const { navigateToFile } = useViewerStore.getState();

    const target = new EventTarget();
    const originalWindow = (globalThis as any).window;
    const originalCustomEvent = (globalThis as any).CustomEvent;

    class MockCustomEvent extends Event {
      detail: any;
      constructor(type: string, dict?: any) {
        super(type);
        this.detail = dict?.detail;
      }
    }

    (globalThis as any).CustomEvent = MockCustomEvent;
    (globalThis as any).window = {
      dispatchEvent: (e: Event) => target.dispatchEvent(e),
      addEventListener: (type: string, listener: any) => target.addEventListener(type, listener),
      removeEventListener: (type: string, listener: any) => target.removeEventListener(type, listener),
      location: { href: 'http://localhost:5173' },
      history: { pushState: () => {} },
    };

    let toastReceived: any = null;
    const toastListener = (e: Event) => {
      toastReceived = (e as any).detail;
    };
    (globalThis as any).window.addEventListener('portal:toast', toastListener);

    try {
      // Attempt to navigate to an unauthorized secret file
      const allowed = navigateToFile('docs/internal/roadmap-secret.md');

      expect(allowed).toBe(false);
      // Active file path should NOT change
      expect(useViewerStore.getState().activeFilePath).toBe('README.md');
      // Warning toast must be emitted with explanation
      expect(toastReceived).toBeDefined();
      expect(toastReceived.type).toBe('warning');
      expect(toastReceived.message).toContain('Access restricted');
      expect(toastReceived.message).toContain('docs/internal/roadmap-secret.md');
    } finally {
      (globalThis as any).window.removeEventListener('portal:toast', toastListener);
      (globalThis as any).window = originalWindow;
      (globalThis as any).CustomEvent = originalCustomEvent;
    }
  });
});
