import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Router } from 'vue-router';

export const MAX_NAV_HISTORY_STEPS = 5;

export const useNavHistoryStore = defineStore('navHistory', () => {
  const backStack = ref<string[]>([]);
  const forwardStack = ref<string[]>([]);
  const currentPath = ref<string>('');
  const isNavigatingHistory = ref(false);

  const canGoBack = computed(() => backStack.value.length > 0);
  const canGoForward = computed(() => forwardStack.value.length > 0);
  const backCount = computed(() => backStack.value.length);
  const forwardCount = computed(() => forwardStack.value.length);

  function recordNavigation(newPath: string) {
    if (!newPath) return;

    // If navigation was triggered by goBack or goForward
    if (isNavigatingHistory.value) {
      isNavigatingHistory.value = false;
      if (currentPath.value === newPath) {
        return;
      }
    }

    // Ignore identical consecutive path navigation
    if (currentPath.value === newPath) return;

    // If this is a subsequent navigation (currentPath already set)
    if (currentPath.value) {
      backStack.value.push(currentPath.value);
      if (backStack.value.length > MAX_NAV_HISTORY_STEPS) {
        backStack.value.shift();
      }
    }

    // Reset forward history whenever a new navigation branch is initiated
    forwardStack.value = [];
    currentPath.value = newPath;
  }

  function goBack(router: Router) {
    if (backStack.value.length === 0) return;
    const prevPath = backStack.value.pop()!;

    if (currentPath.value) {
      forwardStack.value.push(currentPath.value);
      if (forwardStack.value.length > MAX_NAV_HISTORY_STEPS) {
        forwardStack.value.shift();
      }
    }

    isNavigatingHistory.value = true;
    currentPath.value = prevPath;
    void router.push(prevPath);
  }

  function goForward(router: Router) {
    if (forwardStack.value.length === 0) return;
    const nextPath = forwardStack.value.pop()!;

    if (currentPath.value) {
      backStack.value.push(currentPath.value);
      if (backStack.value.length > MAX_NAV_HISTORY_STEPS) {
        backStack.value.shift();
      }
    }

    isNavigatingHistory.value = true;
    currentPath.value = nextPath;
    void router.push(nextPath);
  }

  function reset() {
    backStack.value = [];
    forwardStack.value = [];
    currentPath.value = '';
    isNavigatingHistory.value = false;
  }

  return {
    backStack,
    forwardStack,
    currentPath,
    isNavigatingHistory,
    canGoBack,
    canGoForward,
    backCount,
    forwardCount,
    recordNavigation,
    goBack,
    goForward,
    reset,
  };
});
