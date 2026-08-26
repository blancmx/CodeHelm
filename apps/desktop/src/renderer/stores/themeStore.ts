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

  function setMode(newMode: ThemeMode, event?: MouseEvent) {
    const nextIsDark = newMode === 'dark' ? true : newMode === 'light' ? false : systemPrefersDark.value;
    const isAppearanceChanging = nextIsDark !== isDark.value;

    // Use native View Transitions API with circular ripple radiation if supported and theme changes
    if ((document as any).startViewTransition && isAppearanceChanging) {
      const x = event?.clientX ?? window.innerWidth / 2;
      const y = event?.clientY ?? window.innerHeight / 2;

      // Distance to furthest corner
      const endRadius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y)
      );

      const transition = (document as any).startViewTransition(() => {
        mode.value = newMode;
        localStorage.setItem('codehelm_theme', newMode);
        applyTheme(nextIsDark);
      });

      transition.ready.then(() => {
        const clipPath = [
          `circle(0px at ${x}px ${y}px)`,
          `circle(${endRadius}px at ${x}px ${y}px)`,
        ];

        document.documentElement.animate(
          {
            clipPath: clipPath,
          },
          {
            duration: 480,
            easing: 'cubic-bezier(0.2, 0, 0, 1)',
            pseudoElement: '::view-transition-new(root)',
          }
        );
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
