import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import { useThemeStore } from '../themeStore.js';

function deferred() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup() {
  const classes = new Set<string>();
  const storage = new Map<string, string>([['codehelm_theme', 'light']]);
  const system = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const reduced = { matches: false };
  const animate = vi.fn(() => ({ finished: Promise.resolve(), cancel: vi.fn() }));
  const rings: Array<{ className: string; style: Record<string, string>; setAttribute: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn>; animate: typeof animate }> = [];
  const doc = {
    documentElement: {
      classList: { add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name) },
      offsetWidth: 1200,
    },
    visibilityState: 'visible',
    startViewTransition: vi.fn(),
    body: { appendChild: vi.fn() },
    createElement: vi.fn(() => {
      const ring = { className: '', style: {}, setAttribute: vi.fn(), remove: vi.fn(), animate };
      rings.push(ring);
      return ring;
    }),
  };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', {
    innerWidth: 1200,
    innerHeight: 800,
    matchMedia: (query: string) => query.includes('reduced-motion') ? reduced : system,
  });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  return { classes, storage, system, reduced, animate, doc, rings };
}

describe('atomic theme switch with local feedback', () => {
  let env: ReturnType<typeof setup>;
  let pinia: ReturnType<typeof createPinia>;
  beforeEach(() => {
    env = setup();
    pinia = createPinia();
    setActivePinia(pinia);
  });
  afterEach(() => {
    disposePinia(pinia);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('applies the theme immediately and animates only a local transform/opacity ring', async () => {
    const store = useThemeStore();
    const layoutRead = vi.fn();
    const pending = store.setMode('dark', {
      detail: 1, clientX: 100, clientY: 120,
      currentTarget: { getBoundingClientRect: layoutRead },
    } as unknown as MouseEvent);
    expect(store.isDark).toBe(true);
    expect(env.classes.has('dark')).toBe(true);
    expect(env.storage.get('codehelm_theme')).toBe('dark');
    await pending;
    expect(layoutRead).not.toHaveBeenCalled();
    expect(env.doc.startViewTransition).not.toHaveBeenCalled();
    expect(env.rings[0].style).toMatchObject({ left: '52px', top: '72px' });
    expect(env.rings[0].setAttribute).toHaveBeenCalledWith('aria-hidden', 'true');
    expect(env.animate).toHaveBeenCalledWith([
      { transform: 'scale(0.35)', opacity: 0.28 }, { transform: 'scale(2)', opacity: 0 },
    ], expect.any(Object));
    expect(env.rings[0].remove).toHaveBeenCalledOnce();
    expect(env.classes.has('theme-changing')).toBe(false);
  });

  it('uses the same feedback when switching dark to light', async () => {
    env.storage.set('codehelm_theme', 'dark');
    const store = useThemeStore();
    await store.setMode('light');
    expect(store.isDark).toBe(false);
    expect(env.rings[0].style).toMatchObject({ left: '552px', top: '352px' });
  });

  it('originates keyboard feedback at the option center', async () => {
    const store = useThemeStore();
    await store.setMode('dark', {
      detail: 0, clientX: 0, clientY: 0,
      currentTarget: { getBoundingClientRect: () => ({ left: 100, top: 160, width: 240, height: 48 }) },
    } as unknown as MouseEvent);
    expect(env.rings[0].style).toMatchObject({ left: '172px', top: '136px' });
  });

  it.each(['reduced-motion', 'unsupported', 'hidden'])('switches without feedback when %s', async (reason) => {
    if (reason === 'reduced-motion') env.reduced.matches = true;
    if (reason === 'unsupported') env.doc.createElement.mockImplementation(() => ({
      className: '', style: {}, setAttribute: vi.fn(), remove: vi.fn(), animate: undefined as unknown as typeof env.animate,
    }));
    if (reason === 'hidden') env.doc.visibilityState = 'hidden';
    const store = useThemeStore();
    await store.setMode('dark');
    expect(store.isDark).toBe(true);
    expect(env.doc.body.appendChild).not.toHaveBeenCalled();
    expect(env.classes.has('theme-changing')).toBe(false);
  });

  it('persists auto without feedback when the effective appearance is unchanged', async () => {
    const store = useThemeStore();
    await store.setMode('auto');
    expect(store.mode).toBe('auto');
    expect(env.storage.get('codehelm_theme')).toBe('auto');
    expect(env.doc.createElement).not.toHaveBeenCalled();
  });

  it('keeps only the latest feedback when clicked again before Vue flushes', async () => {
    const store = useThemeStore();
    const first = store.setMode('dark');
    const latest = store.setMode('light');
    await Promise.all([first, latest]);
    expect(store.mode).toBe('light');
    expect(env.storage.get('codehelm_theme')).toBe('light');
    expect(env.rings).toHaveLength(1);
    expect(env.classes.has('theme-changing')).toBe(false);
  });

  it('accepts another click without waiting for a stuck animation', async () => {
    const stuck = deferred();
    const cancel = vi.fn();
    env.animate.mockReturnValueOnce({ finished: stuck.promise, cancel });
    const store = useThemeStore();
    const first = store.setMode('dark');
    await nextTick();
    expect(env.rings).toHaveLength(1);
    await store.setMode('light');
    await first;
    stuck.reject(new Error('canceled'));
    await nextTick();
    expect(cancel).toHaveBeenCalledOnce();
    expect(store.isDark).toBe(false);
    expect(env.rings).toHaveLength(2);
    expect(env.rings.every((ring) => ring.remove.mock.calls.length === 1)).toBe(true);
  });

  it('cleans up a stalled animation on the deadline', async () => {
    vi.useFakeTimers();
    env.animate.mockReturnValueOnce({ finished: new Promise<void>(() => {}), cancel: vi.fn() });
    const store = useThemeStore();
    const pending = store.setMode('dark');
    await vi.advanceTimersByTimeAsync(450);
    await pending;
    expect(env.rings[0].remove).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(env.classes.has('theme-changing')).toBe(false);
  });

  it('retains the new theme and removes the ring when animation creation fails', async () => {
    env.animate.mockImplementationOnce(() => { throw new Error('unavailable'); });
    const store = useThemeStore();
    await store.setMode('dark');
    expect(store.isDark).toBe(true);
    expect(env.rings[0].remove).toHaveBeenCalledOnce();
    expect(env.classes.has('theme-changing')).toBe(false);
  });

  it('removes feedback when the store is disposed during an animation', async () => {
    vi.useFakeTimers();
    env.animate.mockReturnValueOnce({ finished: new Promise<void>(() => {}), cancel: vi.fn() });
    const store = useThemeStore();
    const pending = store.setMode('dark');
    await nextTick();
    store.$dispose();
    await pending;
    expect(env.rings[0].remove).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not append feedback after disposal during a pending Vue flush', async () => {
    const store = useThemeStore();
    const pending = store.setMode('dark');
    store.$dispose();
    await pending;
    expect(env.doc.body.appendChild).not.toHaveBeenCalled();
    expect(env.classes.has('theme-changing')).toBe(false);
  });

  it('follows system changes without feedback and unregisters its listener', async () => {
    const store = useThemeStore();
    await store.setMode('auto');
    const listener = env.system.addEventListener.mock.calls[0][1];
    listener({ matches: true });
    await nextTick();
    expect(store.isDark).toBe(true);
    expect(env.animate).not.toHaveBeenCalled();
    store.$dispose();
    expect(env.system.removeEventListener).toHaveBeenCalledWith('change', listener);
  });
});
