<template>
  <div
    class="h-8 w-full select-none flex items-center justify-between flex-shrink-0 transition-colors duration-200 drag-header"
    :class="themeStore.isDark ? 'bg-black text-zinc-300' : 'bg-white text-zinc-700'"
    @dblclick="handleToggleMaximize"
  >
    <!-- Left: Sidebar Collapse/Expand & Navigation History Controls -->
    <div class="flex items-center h-full no-drag pl-2 gap-0.5">
      <button
        type="button"
        :title="sidebarStore.isCollapsed ? '展开侧边栏' : '折叠侧边栏'"
        class="w-6.5 h-6.5 rounded-md flex items-center justify-center transition-colors duration-150 cursor-pointer select-none group/toggle"
        :class="themeStore.isDark
          ? 'text-zinc-300 hover:text-white hover:bg-white/10'
          : 'text-zinc-700 hover:text-black hover:bg-zinc-100'"
        @click.stop="sidebarStore.toggleCollapse"
      >
        <IconSidebarAnimated :collapsed="sidebarStore.isCollapsed" :size="16" />
      </button>

      <!-- Navigation History: Back & Forward Action Buttons -->
      <div class="flex items-center gap-0.5 ml-0.5">
        <!-- Back Button (返回) -->
        <button
          type="button"
          :disabled="!navHistoryStore.canGoBack"
          title="返回"
          class="w-6.5 h-6.5 rounded-md flex items-center justify-center transition-colors duration-150 select-none"
          :class="navHistoryStore.canGoBack
            ? (themeStore.isDark
                ? 'text-zinc-300 hover:text-white hover:bg-white/10 cursor-pointer'
                : 'text-zinc-700 hover:text-black hover:bg-zinc-100 cursor-pointer')
            : (themeStore.isDark
                ? 'text-zinc-700 cursor-not-allowed opacity-35'
                : 'text-zinc-300 cursor-not-allowed opacity-35')"
          @click="handleGoBack"
        >
          <IconArrowLeft :size="14" stroke-width="2.2" />
        </button>

        <!-- Forward Button (前进) -->
        <button
          type="button"
          :disabled="!navHistoryStore.canGoForward"
          title="前进"
          class="w-6.5 h-6.5 rounded-md flex items-center justify-center transition-colors duration-150 select-none"
          :class="navHistoryStore.canGoForward
            ? (themeStore.isDark
                ? 'text-zinc-300 hover:text-white hover:bg-white/10 cursor-pointer'
                : 'text-zinc-700 hover:text-black hover:bg-zinc-100 cursor-pointer')
            : (themeStore.isDark
                ? 'text-zinc-700 cursor-not-allowed opacity-35'
                : 'text-zinc-300 cursor-not-allowed opacity-35')"
          @click="handleGoForward"
        >
          <IconArrowRight :size="14" stroke-width="2.2" />
        </button>
      </div>
    </div>

    <!-- Full Draggable Titlebar Spacer -->
    <div class="flex-1 h-full min-w-0" />

    <!-- Right: Modern Rounded Window Controls -->
    <div class="flex items-center h-full no-drag pr-1.5 gap-0.5">
      <!-- Minimize Button -->
      <button
        type="button"
        title="最小化"
        class="h-6.5 w-8 rounded-md flex items-center justify-center transition-all duration-150 focus:outline-none cursor-pointer active:scale-95"
        :class="themeStore.isDark ? 'hover:bg-white/10 text-white' : 'hover:bg-zinc-200 text-black'"
        @click="handleMinimize"
      >
        <svg width="10" height="2" viewBox="0 0 10 2">
          <rect width="10" height="1.5" rx="0.75" fill="currentColor" />
        </svg>
      </button>

      <!-- Maximize / Restore Button with Rounded Radius -->
      <button
        type="button"
        :title="isMaximized ? '还原' : '最大化'"
        class="h-6.5 w-8 rounded-md flex items-center justify-center transition-all duration-150 focus:outline-none cursor-pointer active:scale-95"
        :class="themeStore.isDark ? 'hover:bg-white/10 text-white' : 'hover:bg-zinc-200 text-black'"
        @click="handleToggleMaximize"
      >
        <!-- Restore Icon (when maximized) -->
        <svg
          v-if="isMaximized"
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          stroke-width="1.1"
        >
          <path d="M3.25 0.75h4.5a1.5 1.5 0 0 1 1.5 1.5v4.5" stroke-linecap="round" />
          <rect x="0.75" y="2.5" width="6.75" height="6.75" rx="1.5" />
        </svg>
        <!-- Maximize Icon (with distinct rounded corners) -->
        <svg
          v-else
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          stroke-width="1.1"
        >
          <rect x="0.75" y="0.75" width="8.5" height="8.5" rx="2" />
        </svg>
      </button>

      <!-- Close Button -->
      <button
        type="button"
        title="关闭"
        class="h-6.5 w-8 rounded-md flex items-center justify-center transition-all duration-150 focus:outline-none cursor-pointer hover:bg-[#e81123] hover:text-white active:bg-[#c4101f] active:scale-95"
        :class="themeStore.isDark ? 'text-white' : 'text-black'"
        @click="handleClose"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          stroke-width="1.2"
          stroke-linecap="round"
        >
          <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" />
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useThemeStore } from '../stores/themeStore.js';
import { useNavHistoryStore } from '../stores/navHistoryStore.js';
import { IconArrowLeft, IconArrowRight } from './icons/index.js';
import { useSidebarStore } from '../stores/sidebarStore.js';
import { IconSidebarAnimated } from './icons/index.js';

const router = useRouter();
const themeStore = useThemeStore();
const sidebarStore = useSidebarStore();
const navHistoryStore = useNavHistoryStore();

function handleGoBack() {
  navHistoryStore.goBack(router);
}

function handleGoForward() {
  navHistoryStore.goForward(router);
}
const isMaximized = ref(false);
let unsubscribeMaximize: (() => void) | null = null;

onMounted(async () => {
  if (window.codehelm?.window) {
    try {
      isMaximized.value = await window.codehelm.window.isMaximized();
    } catch {
      // safe fallback
    }

    unsubscribeMaximize = window.codehelm.window.onMaximizeChange((max) => {
      isMaximized.value = max;
    });
  }
});

onUnmounted(() => {
  if (unsubscribeMaximize) {
    unsubscribeMaximize();
  }
});

function handleMinimize() {
  window.codehelm?.window?.minimize();
}

function handleToggleMaximize() {
  window.codehelm?.window?.toggleMaximize();
}

function handleClose() {
  window.codehelm?.window?.close();
}
</script>

<style scoped>
.drag-header {
  -webkit-app-region: drag;
}

.no-drag {
  -webkit-app-region: no-drag;
}
</style>
