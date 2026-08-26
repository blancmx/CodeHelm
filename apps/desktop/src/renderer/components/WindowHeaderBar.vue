<template>
  <div
    class="h-8 w-full select-none flex items-center justify-between flex-shrink-0 z-50 transition-colors duration-200 drag-header"
    :class="themeStore.isDark ? 'bg-[#0f0f12] border-b border-[#27272a] text-zinc-400' : 'bg-[#f4f4f5] border-b border-[#e4e4e7] text-zinc-600'"
    @dblclick="handleToggleMaximize"
  >
    <!-- Full Draggable Titlebar Spacer -->
    <div class="flex-1 h-full min-w-0" />

    <!-- Right: Windows 11 Native Style Window Controls -->
    <div class="flex items-center h-full no-drag">
      <!-- Minimize Button -->
      <button
        type="button"
        title="最小化"
        class="h-8 w-11 flex items-center justify-center transition-colors focus:outline-none cursor-pointer"
        :class="themeStore.isDark ? 'hover:bg-white/10 text-zinc-400 hover:text-white' : 'hover:bg-zinc-200 text-zinc-600 hover:text-zinc-950'"
        @click="handleMinimize"
      >
        <svg width="10" height="1" viewBox="0 0 10 1">
          <rect width="10" height="1" fill="currentColor" />
        </svg>
      </button>

      <!-- Maximize / Restore Button -->
      <button
        type="button"
        :title="isMaximized ? '还原' : '最大化'"
        class="h-8 w-11 flex items-center justify-center transition-colors focus:outline-none cursor-pointer"
        :class="themeStore.isDark ? 'hover:bg-white/10 text-zinc-400 hover:text-white' : 'hover:bg-zinc-200 text-zinc-600 hover:text-zinc-950'"
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
          stroke-width="1"
        >
          <path d="M2.5 1.5h6v6h-6z" />
          <path d="M1.5 3.5h-1v6h6v-1" />
        </svg>
        <!-- Maximize Icon (when normal window) -->
        <svg
          v-else
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          stroke-width="1"
        >
          <rect x="0.5" y="0.5" width="9" height="9" rx="0.5" />
        </svg>
      </button>

      <!-- Close Button -->
      <button
        type="button"
        title="关闭"
        class="h-8 w-11 flex items-center justify-center transition-colors focus:outline-none cursor-pointer hover:bg-[#e81123] hover:text-white active:bg-[#c4101f]"
        :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-600'"
        @click="handleClose"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          stroke-width="1.1"
          stroke-linecap="round"
        >
          <path d="M1 1l8 8M9 1L1 9" />
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useThemeStore } from '../stores/themeStore.js';

const themeStore = useThemeStore();
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
