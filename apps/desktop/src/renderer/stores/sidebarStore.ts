import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useSidebarStore = defineStore('sidebar', () => {
  const isCollapsed = ref(localStorage.getItem('codehelm_sidebar_collapsed') === 'true');

  function toggleCollapse() {
    isCollapsed.value = !isCollapsed.value;
    localStorage.setItem('codehelm_sidebar_collapsed', String(isCollapsed.value));
  }

  function expandSidebar() {
    if (isCollapsed.value) {
      isCollapsed.value = false;
      localStorage.setItem('codehelm_sidebar_collapsed', 'false');
    }
  }

  function collapseSidebar() {
    if (!isCollapsed.value) {
      isCollapsed.value = true;
      localStorage.setItem('codehelm_sidebar_collapsed', 'true');
    }
  }

  return {
    isCollapsed,
    toggleCollapse,
    expandSidebar,
    collapseSidebar,
  };
});
