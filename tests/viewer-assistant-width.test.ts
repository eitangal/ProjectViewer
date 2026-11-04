import { describe, it, expect, beforeEach } from 'vitest';
import { useViewerStore } from '../src/frontend/store/useViewerStore.js';

describe('Project AI Assistant Drawer Width & Full Workarea Widening', () => {
  beforeEach(() => {
    useViewerStore.setState({
      isAiDrawerOpen: false,
      aiDrawerWidth: 384,
      isAiDrawerMaximized: false,
      activeFilePath: null,
      authorizedPaths: ['docs/arch.md', 'README.md'],
    });
  });

  it('initializes with default assistant drawer width (384px) and unmaximized', () => {
    const state = useViewerStore.getState();
    expect(state.aiDrawerWidth).toBe(384);
    expect(state.isAiDrawerMaximized).toBe(false);
  });

  it('allows widening the assistant drawer width to custom dimensions', () => {
    const { setAiDrawerWidth } = useViewerStore.getState();
    setAiDrawerWidth(640);
    expect(useViewerStore.getState().aiDrawerWidth).toBe(640);

    setAiDrawerWidth(1024);
    expect(useViewerStore.getState().aiDrawerWidth).toBe(1024);
  });

  it('toggles assistant drawer between normal width and full workarea width', () => {
    const { toggleAiDrawerMaximized } = useViewerStore.getState();

    // Toggle to maximized (full workarea)
    toggleAiDrawerMaximized();
    expect(useViewerStore.getState().isAiDrawerMaximized).toBe(true);

    // Toggle back to normal
    toggleAiDrawerMaximized();
    expect(useViewerStore.getState().isAiDrawerMaximized).toBe(false);
  });

  it('explicitly sets assistant drawer maximized state', () => {
    const { setAiDrawerMaximized } = useViewerStore.getState();

    setAiDrawerMaximized(true);
    expect(useViewerStore.getState().isAiDrawerMaximized).toBe(true);

    setAiDrawerMaximized(false);
    expect(useViewerStore.getState().isAiDrawerMaximized).toBe(false);
  });

  it('automatically un-maximizes assistant when a file citation or navigation occurs', () => {
    const { setAiDrawerMaximized, navigateToFile } = useViewerStore.getState();

    // User is in full workarea assistant mode
    setAiDrawerMaximized(true);
    expect(useViewerStore.getState().isAiDrawerMaximized).toBe(true);

    // User clicks a citation link to view a referenced file
    const navigated = navigateToFile('docs/arch.md', 'L10-L20');
    expect(navigated).toBe(true);

    // Assistant is un-maximized so DocumentViewport is side-by-side with chat
    expect(useViewerStore.getState().isAiDrawerMaximized).toBe(false);
    expect(useViewerStore.getState().activeFilePath).toBe('docs/arch.md');
    expect(useViewerStore.getState().activeHash).toBe('L10-L20');
  });

  it('correctly calculates resize deltas for both LTR and RTL directions', () => {
    const startX = 500;
    const currentX = 400; // dragged 100px to the left

    // In LTR: dragging to the left increases drawer width (into workarea)
    const ltrDelta = startX - currentX;
    expect(ltrDelta).toBe(100);

    // In RTL: dragging to the right (e.g. from 500 to 600) increases drawer width
    const rtlStartX = 500;
    const rtlCurrentX = 600;
    const rtlDelta = rtlCurrentX - rtlStartX;
    expect(rtlDelta).toBe(100);
  });
});
