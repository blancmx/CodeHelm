import { defineStore } from 'pinia';
import { ref, computed, nextTick, onScopeDispose } from 'vue';

export type ThemeMode = 'dark' | 'light' | 'auto';

export const useThemeStore = defineStore('theme', () => {
  const savedMode = localStorage.getItem('codehelm_theme');
  const mode = ref<ThemeMode>(savedMode === 'light' || savedMode === 'auto' ? savedMode : 'dark');
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const systemPrefersDark = ref(mediaQuery.matches);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let cancelFeedback: (() => void) | undefined;
  let requestId = 0;

  const isDark = computed(() => mode.value === 'auto' ? systemPrefersDark.value : mode.value === 'dark');

  function showFeedback(x: number, y: number) {
    const ring = document.createElement('div');
    if (typeof ring.animate !== 'function') return;
    ring.className = 'theme-mode-feedback';
    ring.setAttribute('aria-hidden', 'true');
    ring.style.left = `${x - 48}px`;
    ring.style.top = `${y - 48}px`;
    document.body.appendChild(ring);

    return new Promise<void>((resolve) => {
      let animation: Animation | undefined;
      let deadline: ReturnType<typeof setTimeout> | undefined;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(deadline);
        animation?.cancel();
        ring.remove();
        if (cancelFeedback === finish) cancelFeedback = undefined;
        resolve();
      };
      cancelFeedback = finish;
      try {
        // Keep feedback on a small composited layer, without full-window snapshots.
        animation = ring.animate(
          [{ transform: 'scale(0.35)', opacity: 0.28 }, { transform: 'scale(2)', opacity: 0 }],
          { duration: 300, easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'both' },
        );
        void animation.finished.then(finish, finish);
        // An occluded window must not retain a layer or block a later click.
        deadline = setTimeout(finish, 450);
      } catch {
        finish();
      }
    });
  }

  async function changeMode(newMode: ThemeMode, event?: MouseEvent, systemDark = systemPrefersDark.value, animate = true) {
    const currentRequest = ++requestId;
    cancelFeedback?.();
    const nextIsDark = newMode === 'auto' ? systemDark : newMode === 'dark';
    const shouldAnimate = animate && nextIsDark !== isDark.value && !reducedMotion.matches
      && document.visibilityState === 'visible';
    // Pointer clicks need no layout read. Keyboard activation uses the option center.
    const pointer = event && event.detail > 0;
    const bounds = !pointer ? (event?.currentTarget as Element | null)?.getBoundingClientRect?.() : undefined;
    const x = Math.max(0, Math.min(window.innerWidth,
      pointer ? event.clientX : bounds ? bounds.left + bounds.width / 2 : window.innerWidth / 2));
    const y = Math.max(0, Math.min(window.innerHeight,
      pointer ? event.clientY : bounds ? bounds.top + bounds.height / 2 : window.innerHeight / 2));

    const root = document.documentElement;
    root.classList.add('theme-changing');
    try {
      systemPrefersDark.value = systemDark;
      mode.value = newMode;
      localStorage.setItem('codehelm_theme', newMode);
      applyTheme();
      await nextTick();
    } finally {
      if (currentRequest === requestId) {
        // Commit the palette once before restoring local hover transitions.
        void root.offsetWidth;
        root.classList.remove('theme-changing');
      }
    }
    if (currentRequest === requestId && shouldAnimate) await showFeedback(x, y);
  }

  function setMode(newMode: ThemeMode, event?: MouseEvent) {
    return changeMode(newMode, event);
  }

  function toggleTheme(event?: MouseEvent) {
    return setMode(isDark.value ? 'light' : 'dark', event);
  }

  function onSystemChange(event: MediaQueryListEvent) {
    if (mode.value === 'auto') void changeMode('auto', undefined, event.matches, false);
    else systemPrefersDark.value = event.matches;
  }

  mediaQuery.addEventListener('change', onSystemChange);
  onScopeDispose(() => {
    requestId++;
    mediaQuery.removeEventListener('change', onSystemChange);
    cancelFeedback?.();
    document.documentElement.classList.remove('theme-changing');
  });

  function applyTheme() {
    document.documentElement.classList.add(isDark.value ? 'dark' : 'light');
    document.documentElement.classList.remove(isDark.value ? 'light' : 'dark');
  }

  applyTheme();
  return { mode, isDark, setMode, toggleTheme };
});
