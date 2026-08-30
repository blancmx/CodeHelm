import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useNavHistoryStore, MAX_NAV_HISTORY_STEPS } from '../navHistoryStore.js';
import type { Router } from 'vue-router';

describe('navHistoryStore - 5-step navigation history stack', () => {
  let store: ReturnType<typeof useNavHistoryStore>;
  let mockRouter: Router;

  beforeEach(() => {
    setActivePinia(createPinia());
    store = useNavHistoryStore();
    mockRouter = {
      push: vi.fn(),
      replace: vi.fn(),
      go: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
    } as unknown as Router;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes with empty history stacks and disabled buttons', () => {
    expect(store.backStack).toEqual([]);
    expect(store.forwardStack).toEqual([]);
    expect(store.canGoBack).toBe(false);
    expect(store.canGoForward).toBe(false);
    expect(store.backCount).toBe(0);
    expect(store.forwardCount).toBe(0);
  });

  it('records first navigation without adding to back stack, but sets currentPath', () => {
    store.recordNavigation('/');
    expect(store.currentPath).toBe('/');
    expect(store.backStack).toEqual([]);
    expect(store.canGoBack).toBe(false);
    expect(store.canGoForward).toBe(false);
  });

  it('pushes previous path to backStack on subsequent navigations and keeps forwardStack empty', () => {
    store.recordNavigation('/');
    store.recordNavigation('/runner');

    expect(store.currentPath).toBe('/runner');
    expect(store.backStack).toEqual(['/']);
    expect(store.canGoBack).toBe(true);
    expect(store.backCount).toBe(1);
    expect(store.canGoForward).toBe(false);

    store.recordNavigation('/console');
    expect(store.currentPath).toBe('/console');
    expect(store.backStack).toEqual(['/', '/runner']);
    expect(store.backCount).toBe(2);
    expect(store.canGoForward).toBe(false);
  });

  it('caps backStack at exactly MAX_NAV_HISTORY_STEPS (5 steps)', () => {
    expect(MAX_NAV_HISTORY_STEPS).toBe(5);

    store.recordNavigation('/step-0');
    store.recordNavigation('/step-1');
    store.recordNavigation('/step-2');
    store.recordNavigation('/step-3');
    store.recordNavigation('/step-4');
    store.recordNavigation('/step-5');

    expect(store.backStack).toEqual([
      '/step-0',
      '/step-1',
      '/step-2',
      '/step-3',
      '/step-4',
    ]);
    expect(store.backCount).toBe(5);

    // 6th navigation: oldest /step-0 should be shifted out
    store.recordNavigation('/step-6');
    expect(store.backStack).toEqual([
      '/step-1',
      '/step-2',
      '/step-3',
      '/step-4',
      '/step-5',
    ]);
    expect(store.backCount).toBe(5);
    expect(store.currentPath).toBe('/step-6');
  });

  it('correctly handles goBack: pops from backStack, pushes to forwardStack, and calls router.push', () => {
    store.recordNavigation('/page-1');
    store.recordNavigation('/page-2');
    store.recordNavigation('/page-3');

    expect(store.backStack).toEqual(['/page-1', '/page-2']);
    expect(store.currentPath).toBe('/page-3');

    // Go back once
    store.goBack(mockRouter);

    expect(mockRouter.push).toHaveBeenCalledWith('/page-2');
    expect(store.currentPath).toBe('/page-2');
    expect(store.backStack).toEqual(['/page-1']);
    expect(store.forwardStack).toEqual(['/page-3']);
    expect(store.canGoBack).toBe(true);
    expect(store.canGoForward).toBe(true);
    expect(store.forwardCount).toBe(1);

    // Go back second time
    store.goBack(mockRouter);

    expect(mockRouter.push).toHaveBeenCalledWith('/page-1');
    expect(store.currentPath).toBe('/page-1');
    expect(store.backStack).toEqual([]);
    expect(store.forwardStack).toEqual(['/page-3', '/page-2']);
    expect(store.canGoBack).toBe(false);
    expect(store.canGoForward).toBe(true);
    expect(store.forwardCount).toBe(2);
  });

  it('correctly handles goForward: pops from forwardStack, pushes to backStack, and calls router.push', () => {
    store.recordNavigation('/page-1');
    store.recordNavigation('/page-2');
    store.recordNavigation('/page-3');

    // Back to page-1
    store.goBack(mockRouter);
    store.goBack(mockRouter);

    expect(store.currentPath).toBe('/page-1');
    expect(store.forwardStack).toEqual(['/page-3', '/page-2']);

    // Forward to page-2
    store.goForward(mockRouter);

    expect(mockRouter.push).toHaveBeenCalledWith('/page-2');
    expect(store.currentPath).toBe('/page-2');
    expect(store.backStack).toEqual(['/page-1']);
    expect(store.forwardStack).toEqual(['/page-3']);
    expect(store.canGoBack).toBe(true);
    expect(store.canGoForward).toBe(true);

    // Forward to page-3
    store.goForward(mockRouter);

    expect(mockRouter.push).toHaveBeenCalledWith('/page-3');
    expect(store.currentPath).toBe('/page-3');
    expect(store.backStack).toEqual(['/page-1', '/page-2']);
    expect(store.forwardStack).toEqual([]);
    expect(store.canGoForward).toBe(false); // Grayed out when forward history is exhausted!
  });

  it('resets forwardStack to empty (grayed out) when user makes a normal new navigation from a back state', () => {
    store.recordNavigation('/page-1');
    store.recordNavigation('/page-2');
    store.recordNavigation('/page-3');

    // User backs up to page-2
    store.goBack(mockRouter);
    expect(store.canGoForward).toBe(true);
    expect(store.forwardStack).toEqual(['/page-3']);

    // User now navigates to a new page-4 directly (e.g. clicking sidebar menu)
    store.recordNavigation('/page-4');

    expect(store.currentPath).toBe('/page-4');
    expect(store.backStack).toEqual(['/page-1', '/page-2']);
    expect(store.forwardStack).toEqual([]); // Cleared!
    expect(store.canGoForward).toBe(false); // Forward is grayed out!
  });

  it('caps forwardStack at maximum 5 steps', () => {
    store.recordNavigation('/s0');
    store.recordNavigation('/s1');
    store.recordNavigation('/s2');
    store.recordNavigation('/s3');
    store.recordNavigation('/s4');
    store.recordNavigation('/s5');
    store.recordNavigation('/s6');

    // Back 6 times
    for (let i = 0; i < 6; i++) {
      store.goBack(mockRouter);
    }

    expect(store.forwardCount).toBeLessThanOrEqual(5);
    expect(store.forwardStack.length).toBe(5);
  });

  it('ignores consecutive duplicate navigation calls to the exact same path', () => {
    store.recordNavigation('/overview');
    store.recordNavigation('/overview');
    store.recordNavigation('/overview');

    expect(store.currentPath).toBe('/overview');
    expect(store.backStack).toEqual([]);
  });
});
