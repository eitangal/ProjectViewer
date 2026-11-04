import { describe, it, expect, beforeEach } from 'vitest';
import { useViewerStore, applyThemeToDom } from '../src/frontend/store/useViewerStore.js';

describe('Viewer Theme, User State & Full Workarea Layout', () => {
  beforeEach(() => {
    useViewerStore.setState({
      theme: 'dark',
      isSidebarOpen: true,
      activeFilePath: null,
    });
  });

  it('initializes with default dark theme', () => {
    const state = useViewerStore.getState();
    expect(state.theme).toBe('dark');
  });

  it('allows explicitly setting theme to light or dark', () => {
    const { setTheme } = useViewerStore.getState();

    setTheme('light');
    expect(useViewerStore.getState().theme).toBe('light');

    setTheme('dark');
    expect(useViewerStore.getState().theme).toBe('dark');
  });

  it('toggles theme between dark and light', () => {
    const { toggleTheme } = useViewerStore.getState();

    // dark -> light
    toggleTheme();
    expect(useViewerStore.getState().theme).toBe('light');

    // light -> dark
    toggleTheme();
    expect(useViewerStore.getState().theme).toBe('dark');
  });

  it('correctly updates DOM documentElement attributes when applying theme', () => {
    // Create a mock document element if in node test environment
    const docElem = {
      classList: new Set<string>(),
      attributes: {} as Record<string, string>,
      style: {} as Record<string, string>,
      setAttribute(key: string, val: string) {
        this.attributes[key] = val;
      },
    };

    // Mock global document if not present
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
      // Test Light Mode
      applyThemeToDom('light');
      expect(docElem.classList.has('light')).toBe(true);
      expect(docElem.classList.has('dark')).toBe(false);
      expect(docElem.attributes['data-theme']).toBe('light');
      expect(docElem.style.colorScheme).toBe('light');

      // Test Dark Mode
      applyThemeToDom('dark');
      expect(docElem.classList.has('dark')).toBe(true);
      expect(docElem.classList.has('light')).toBe(false);
      expect(docElem.attributes['data-theme']).toBe('dark');
      expect(docElem.style.colorScheme).toBe('dark');
    } finally {
      (globalThis as any).document = originalDoc;
    }
  });

  it('confirms centered workarea toggle function is removed and store enforces full workarea layout', () => {
    const state = useViewerStore.getState() as any;
    // contentWidth and toggleContentWidth must no longer exist on state
    expect(state.contentWidth).toBeUndefined();
    expect(state.toggleContentWidth).toBeUndefined();
  });
});
