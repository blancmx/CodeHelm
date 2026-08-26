import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export type ThemeMode = 'dark' | 'light' | 'auto';

export const useThemeStore = defineStore('theme', () => {
  const savedMode = (localStorage.getItem('codehelm_theme') as ThemeMode) || 'dark';
  const mode = ref<ThemeMode>(savedMode);
  const systemPrefersDark = ref(window.matchMedia('(prefers-color-scheme: dark)').matches);

  // Listen to system changes
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', (e) => {
    systemPrefersDark.value = e.matches;
    applyTheme();
  });

  const isDark = computed(() => {
    if (mode.value === 'dark') return true;
    if (mode.value === 'light') return false;
    return systemPrefersDark.value;
  });

  function triggerRadialWaveOverlay(x: number, y: number, radius: number, targetIsDark: boolean, callback: () => void) {
    const overlay = document.createElement('div');
    overlay.id = 'theme-radial-ripple-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.zIndex = '9999999';
    overlay.style.pointerEvents = 'none';
    overlay.style.backgroundColor = targetIsDark ? '#09090b' : '#fafafa';
    overlay.style.willChange = 'clip-path, opacity';
    document.documentElement.appendChild(overlay);

    const animation = overlay.animate(
      [
        { clipPath: `circle(0px at ${x}px ${y}px)` },
        { clipPath: `circle(${radius}px at ${x}px ${y}px)` },
      ],
      {
        duration: 460,
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
        fill: 'forwards',
      }
    );

    // Midway through expansion or when finished, apply the theme underneath
    let applied = false;
    setTimeout(() => {
      if (!applied) {
        applied = true;
        callback();
      }
    }, 280);

    animation.onfinish = () => {
      if (!applied) {
        applied = true;
        callback();
      }
      const fadeAnim = overlay.animate(
        [{ opacity: '1' }, { opacity: '0' }],
        { duration: 160, easing: 'ease-out' }
      );
      fadeAnim.onfinish = () => {
        overlay.remove();
      };
    };
  }

  function setMode(newMode: ThemeMode, event?: MouseEvent) {
    const nextIsDark = newMode === 'dark' ? true : newMode === 'light' ? false : systemPrefersDark.value;
    const isAppearanceChanging = nextIsDark !== isDark.value;

    const x = event?.clientX ?? (window.innerWidth / 2);
    const y = event?.clientY ?? (window.innerHeight / 2);

    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    ) + 30;

    if (isAppearanceChanging) {
      triggerRadialWaveOverlay(x, y, endRadius, nextIsDark, () => {
        mode.value = newMode;
        localStorage.setItem('codehelm_theme', newMode);
        applyTheme(nextIsDark);
      });
      return;
    }

    mode.value = newMode;
    localStorage.setItem('codehelm_theme', newMode);
    applyTheme(nextIsDark);
  }

  function toggleTheme(event?: MouseEvent) {
    if (isDark.value) {
      setMode('light', event);
    } else {
      setMode('dark', event);
    }
  }

  function applyTheme(darkValue = isDark.value) {
    if (darkValue) {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
    }
  }

  // Initial apply
  applyTheme();

  return {
    mode,
    isDark,
    setMode,
    toggleTheme,
  };
});
