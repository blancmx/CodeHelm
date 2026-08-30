<template>
  <div
    class="h-8 w-full select-none flex items-center justify-between flex-shrink-0 transition-colors duration-200 drag-header"
    :class="themeStore.isDark ? 'bg-[#0f0f12] text-zinc-400' : 'bg-[#f4f4f5] text-zinc-600'"
    @dblclick="handleToggleMaximize"
  >
    <!-- Left: Sidebar Collapse/Expand Toggle Button on Top-Left -->
    <div class="flex items-center h-full no-drag pl-2">
      <button
        type="button"
        :title="sidebarStore.isCollapsed ? '展开侧边栏' : '折叠侧边栏'"
        class="w-7 h-7 rounded-lg border flex items-center justify-center transition-all duration-200 cursor-pointer select-none group/toggle active:scale-90"
        :class="[
          sidebarStore.isCollapsed
            ? (themeStore.isDark
                ? 'bg-[#18181b] border-[#3f3f46] text-white shadow-2xs hover:bg-[#27272a] hover:border-zinc-400'
                : 'bg-white border-zinc-300 text-zinc-950 shadow-2xs hover:bg-zinc-50 hover:border-zinc-400')
            : (themeStore.isDark
                ? 'border-transparent text-zinc-400 hover:text-white hover:bg-white/10 hover:border-[#27272a]'
                : 'border-transparent text-zinc-600 hover:text-zinc-950 hover:bg-zinc-200/80 hover:border-zinc-300')
        ]"
        @click.stop="sidebarStore.toggleCollapse"
      >
        <IconSidebarAnimated :collapsed="sidebarStore.isCollapsed" :size="16" />
      </button>
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
          <rect x="2.5" y="0.75" width="6.75" height="6.75" rx="1.5" />
          <path d="M0.75 3.25v4.5a1.5 1.5 0 0 0 1.5 1.5h4.5" stroke-linecap="round" />
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
import { useThemeStore } from '../stores/themeStore.js';
import { useSidebarStore } from '../stores/sidebarStore.js';
import { IconSidebarAnimated } from './icons/index.js';

const themeStore = useThemeStore();
const sidebarStore = useSidebarStore();
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
