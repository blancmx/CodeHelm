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

  function setMode(newMode: ThemeMode) {
    mode.value = newMode;
    localStorage.setItem('codehelm_theme', newMode);
    applyTheme();
  }

  function toggleTheme() {
    if (isDark.value) {
      setMode('light');
    } else {
      setMode('dark');
    }
  }

  function applyTheme() {
    if (isDark.value) {
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
