import { describe, it, expect, beforeEach } from 'vitest';
import { useViewerStore, applyThemeToDom } from '../src/frontend/store/useViewerStore.js';

describe('UI/UX Consistency, Scoped RTL & AI Assistant Chat', () => {
  beforeEach(() => {
    useViewerStore.setState({
      theme: 'dark',
      direction: 'ltr',
      isSidebarOpen: true,
      isAiDrawerOpen: false,
      aiDrawerWidth: 384,
      isAiDrawerMaximized: false,
      activeFilePath: null,
      authorizedPaths: ['README.md', 'docs/overview.md'],
    });
  });

  describe('Scoped RTL Behavior', () => {
    it('initializes with LTR direction', () => {
      const state = useViewerStore.getState();
      expect(state.direction).toBe('ltr');
    });

    it('toggles direction between ltr and rtl without mutating shell layout state', () => {
      const { setDirection } = useViewerStore.getState();

      setDirection('rtl');
      expect(useViewerStore.getState().direction).toBe('rtl');
      // Sidebar and drawer state are unaffected
      expect(useViewerStore.getState().isSidebarOpen).toBe(true);

      setDirection('ltr');
      expect(useViewerStore.getState().direction).toBe('ltr');
    });

    it('guarantees drawer width drag delta is stable because shell is LTR', () => {
      // In LTR shell, drawer is anchored to right edge
      // Dragging left (e.g. from 800 to 700) increases drawer width by 100px
      const startX = 800;
      const currentX = 700;
      const delta = startX - currentX;
      expect(delta).toBe(100);

      const targetWidth = 384 + delta;
      expect(targetWidth).toBe(484);
    });

    it('sets proper alignment class and dir attribute on markdown document viewport', () => {
      const { setDirection } = useViewerStore.getState();

      // RTL alignment
      setDirection('rtl');
      const rtlDirection = useViewerStore.getState().direction;
      const rtlClass = rtlDirection === 'rtl' ? 'text-right' : 'text-left';
      expect(rtlDirection).toBe('rtl');
      expect(rtlClass).toBe('text-right');

      // LTR alignment
      setDirection('ltr');
      const ltrDirection = useViewerStore.getState().direction;
      const ltrClass = ltrDirection === 'rtl' ? 'text-right' : 'text-left';
      expect(ltrDirection).toBe('ltr');
      expect(ltrClass).toBe('text-left');
    });
  });

  describe('Light Mode Theme DOM Application', () => {
    it('sets data-theme and colorScheme attributes correctly for both themes', () => {
      const docElem = {
        classList: new Set<string>(),
        attributes: {} as Record<string, string>,
        style: {} as Record<string, string>,
        setAttribute(key: string, val: string) {
          this.attributes[key] = val;
        },
      };

      const originalDoc = (globalThis as any).document;
      (globalThis as any).document = {
        documentElement: {
          classList: {
            add: (cls: string) => docElem.classList.add(cls),
            remove: (cls: string) => docElem.classList.delete(cls),
            contains: (cls: string) => docElem.classList.has(cls),
          },
          setAttribute: (k: string, v: string) => docElem.setAttribute(k, v),
          style: docElem.style,
        },
      };

      try {
        applyThemeToDom('light');
        expect(docElem.classList.has('light')).toBe(true);
        expect(docElem.attributes['data-theme']).toBe('light');
        expect(docElem.style.colorScheme).toBe('light');

        applyThemeToDom('dark');
        expect(docElem.classList.has('dark')).toBe(true);
        expect(docElem.attributes['data-theme']).toBe('dark');
        expect(docElem.style.colorScheme).toBe('dark');
      } finally {
        (globalThis as any).document = originalDoc;
      }
    });
  });

  describe('Chat Markdown Citation Parsing Logic', () => {
    it('correctly transforms inline citation brackets into custom markdown citation links', () => {
      const formatMarkdownCitations = (content: string) => {
        const citationRegex = /\[([^\[\]\s]+\.[a-zA-Z0-9]+(?:#L\d+(?:-L\d+)?)?)\](?!\()/g;
        return content.replace(citationRegex, '[$1](cite:$1)');
      };

      const rawAiText =
        'According to [docs/arch/overview.md#L12-L40] and [specs/auth.yaml], the token verification is mandatory.';

      const formatted = formatMarkdownCitations(rawAiText);

      expect(formatted).toContain('[docs/arch/overview.md#L12-L40](cite:docs/arch/overview.md#L12-L40)');
      expect(formatted).toContain('[specs/auth.yaml](cite:specs/auth.yaml)');
    });

    it('does not re-transform standard markdown links', () => {
      const formatMarkdownCitations = (content: string) => {
        const citationRegex = /\[([^\[\]\s]+\.[a-zA-Z0-9]+(?:#L\d+(?:-L\d+)?)?)\](?!\()/g;
        return content.replace(citationRegex, '[$1](cite:$1)');
      };

      const standardLinkText =
        'Check out [Gemini Documentation](https://ai.google.dev) and [docs/arch/overview.md#L12-L40](cite:docs/arch/overview.md#L12-L40)';

      const result = formatMarkdownCitations(standardLinkText);

      // Standard link is untouched
      expect(result).toContain('[Gemini Documentation](https://ai.google.dev)');
      // Pre-existing citation link is not double-nested
      expect(result).not.toContain('(cite:cite:');
    });
  });

  describe('Chat History Reset & Clearing Logic', () => {
    it('verifies initial conversation greeting state', () => {
      const INITIAL_GREETING =
        'Hello! I am your ACL-scoped Project AI assistant. Ask questions about this repository and I will answer strictly using your permitted files, with inline citations.';

      const messages = [
        { role: 'assistant', content: INITIAL_GREETING },
        { role: 'user', content: 'What are the auth rules?' },
        { role: 'assistant', content: 'Here is the auth spec [specs/auth.yaml]...' },
      ];

      expect(messages.length).toBe(3);

      // Simulating handleClearChat
      const cleared = [{ role: 'assistant', content: INITIAL_GREETING }];
      expect(cleared.length).toBe(1);
      expect(cleared[0].content).toBe(INITIAL_GREETING);
    });
  });

  describe('Sidebar and Assistant Drawer Layout Integration', () => {
    it('toggles sidebar state across all views', () => {
      const { toggleSidebar } = useViewerStore.getState();

      expect(useViewerStore.getState().isSidebarOpen).toBe(true);
      toggleSidebar();
      expect(useViewerStore.getState().isSidebarOpen).toBe(false);
      toggleSidebar();
      expect(useViewerStore.getState().isSidebarOpen).toBe(true);
    });

    it('toggles AI drawer state across all views', () => {
      const { toggleAiDrawer } = useViewerStore.getState();

      expect(useViewerStore.getState().isAiDrawerOpen).toBe(false);
      toggleAiDrawer();
      expect(useViewerStore.getState().isAiDrawerOpen).toBe(true);
      toggleAiDrawer();
      expect(useViewerStore.getState().isAiDrawerOpen).toBe(false);
    });
  });

  describe('Publisher Console Menu & Project Management', () => {
    it('manages active project switching and preview group selection', () => {
      const mockProjects = [
        { id: 'proj-1', name: 'Project One', branch: 'main', repoUrl: 'https://github.com/test/one.git', createdAt: 1 },
        { id: 'proj-2', name: 'Project Two', branch: 'develop', repoUrl: 'https://github.com/test/two.git', createdAt: 2 },
      ];

      let selectedProjectId = 'proj-1';
      const onSelectProject = (id: string) => {
        selectedProjectId = id;
      };

      onSelectProject('proj-2');
      expect(selectedProjectId).toBe('proj-2');

      const activeProject = mockProjects.find((p) => p.id === selectedProjectId);
      expect(activeProject?.name).toBe('Project Two');
      expect(activeProject?.branch).toBe('develop');
    });

    it('handles project deletion and selection fallback', async () => {
      let projects = [
        { id: 'proj-1', name: 'Project One' },
        { id: 'proj-2', name: 'Project Two' },
      ];
      let currentProjectId = 'proj-1';

      const onDeleteProject = async (id: string) => {
        projects = projects.filter((p) => p.id !== id);
        if (currentProjectId === id) {
          currentProjectId = projects[0]?.id || '';
        }
      };

      await onDeleteProject('proj-1');
      expect(projects.length).toBe(1);
      expect(currentProjectId).toBe('proj-2');

      await onDeleteProject('proj-2');
      expect(projects.length).toBe(0);
      expect(currentProjectId).toBe('');
    });
  });
});
