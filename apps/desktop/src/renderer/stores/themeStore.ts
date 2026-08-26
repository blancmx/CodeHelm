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
    // 1. Immediately apply the theme changes so the clicked mode card and icons update without being blocked
    callback();

    // 2. Radiate the color wave across the background layer (z-index: 5, beneath cards and controls at z-20)
    const existing = document.getElementById('theme-background-radial-ripple');
    if (existing) existing.remove();

    const ripple = document.createElement('div');
    ripple.id = 'theme-background-radial-ripple';
    ripple.style.position = 'fixed';
    ripple.style.top = '0';
    ripple.style.left = '0';
    ripple.style.width = '100vw';
    ripple.style.height = '100vh';
    ripple.style.zIndex = '5'; // Above background canvas, below cards/controls at z-20
    ripple.style.pointerEvents = 'none';
    ripple.style.backgroundColor = targetIsDark ? '#09090b' : '#fafafa';
    ripple.style.willChange = 'clip-path';
    document.body.appendChild(ripple);

    const animation = ripple.animate(
      [
        { clipPath: `circle(0px at ${x}px ${y}px)` },
        { clipPath: `circle(${radius}px at ${x}px ${y}px)` },
      ],
      {
        duration: 480,
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
        fill: 'forwards',
      }
    );

    animation.onfinish = () => {
      ripple.remove();
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
