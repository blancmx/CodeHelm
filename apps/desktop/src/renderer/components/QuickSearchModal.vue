<template>
  <n-modal
    v-model:show="projectStore.searchModalVisible"
    :mask-closable="true"
    :auto-focus="true"
    transform-origin="center"
    @after-enter="handleAfterEnter"
    @after-leave="handleAfterLeave"
  >
    <div
      class="w-[620px] max-w-[92vw] rounded-2xl border shadow-2xl overflow-hidden flex flex-col select-none transition-all duration-200"
      :class="themeStore.isDark
        ? 'bg-[#121216] border-[#27272a] shadow-black/90 text-white'
        : 'bg-white border-zinc-200 shadow-zinc-400/30 text-zinc-950'"
      @keydown="handleKeyDown"
    >
      <!-- Top Search Input Bar -->
      <div
        class="h-14 px-4 flex items-center gap-3 border-b transition-colors"
        :class="themeStore.isDark ? 'border-[#27272a] bg-[#15151a]' : 'border-zinc-100 bg-zinc-50/70'"
      >
        <IconSearch :size="18" class="text-zinc-400 flex-shrink-0" />
        <input
          ref="inputRef"
          v-model="query"
          type="text"
          placeholder="搜索工程名称、本地路径、框架或语言画像..."
          class="flex-1 bg-transparent border-0 outline-none text-sm font-sans placeholder:text-zinc-400"
          :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'"
          @input="selectedIndex = 0"
        />
        <kbd
          class="text-[10px] font-mono font-semibold px-2 py-0.5 rounded border flex-shrink-0"
          :class="themeStore.isDark ? 'bg-[#1e1e24] text-zinc-400 border-[#2f2f38]' : 'bg-white text-zinc-500 border-zinc-300 shadow-2xs'"
        >
          ESC
        </kbd>
      </div>

      <!-- Search Results List -->
      <div
        ref="listRef"
        class="max-h-[380px] overflow-y-auto p-2 space-y-1.5 focus:outline-none"
      >
        <!-- Project Item -->
        <div
          v-for="(project, index) in filteredProjects"
          :key="project.id"
          class="p-2.5 rounded-xl flex items-center justify-between gap-3 cursor-pointer transition-all duration-100 border"
          :class="[
            selectedIndex === index
              ? (themeStore.isDark ? 'bg-[#1c1c22] border-white/20 shadow-xs' : 'bg-zinc-100 border-zinc-300 shadow-2xs')
              : 'border-transparent hover:bg-zinc-500/5'
          ]"
          @mouseenter="selectedIndex = index"
          @click="selectProject(project.id)"
        >
          <!-- Left: Project Info -->
          <div class="flex items-center gap-3 min-w-0 flex-1">
            <!-- Project Avatar Square -->
            <div
              class="w-9 h-9 rounded-lg flex items-center justify-center font-bold text-xs flex-shrink-0 border font-mono shadow-2xs"
              :class="themeStore.isDark ? 'bg-[#18181b] border-[#27272a] text-white' : 'bg-white border-zinc-200 text-zinc-900'"
            >
              {{ (project.name || 'P').slice(0, 2).toUpperCase() }}
            </div>

            <!-- Project Names & Metadata -->
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="font-bold text-xs truncate" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
                  {{ project.name }}
                </span>
                <span
                  class="text-[10px] font-mono px-1.5 py-0.2 rounded border flex-shrink-0"
                  :class="themeStore.isDark ? 'bg-[#18181b] text-zinc-400 border-[#27272a]' : 'bg-zinc-100 text-zinc-600 border-zinc-200'"
                >
                  {{ project.moduleCount || 0 }} 模块 / {{ project.serviceCount || 0 }} 服务
                </span>
              </div>
              <p
                class="font-mono text-[11px] truncate mt-0.5"
                :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'"
              >
                {{ project.rootPath }}
              </p>
            </div>
          </div>

          <!-- Right: Tags & Quick Enter Hint -->
          <div class="flex items-center gap-2 flex-shrink-0">
            <!-- Primary Stack Tags -->
            <div class="hidden sm:flex items-center gap-1">
              <span
                v-for="lang in (project.primaryLanguages || []).slice(0, 2)"
                :key="lang"
                class="text-[9px] font-mono px-1.5 py-0.2 rounded border"
                :class="themeStore.isDark ? 'bg-[#18181b] text-zinc-300 border-[#27272a]' : 'bg-zinc-100 text-zinc-700 border-zinc-200'"
              >
                {{ lang }}
              </span>
            </div>

            <!-- Enter Icon on Selected -->
            <div
              v-if="selectedIndex === index"
              class="flex items-center gap-1 text-[10px] font-medium font-sans px-2 py-0.5 rounded-md"
              :class="themeStore.isDark ? 'text-white bg-white/10' : 'text-zinc-900 bg-zinc-200/80'"
            >
              <span>进入</span>
              <span class="font-mono text-xs">⏎</span>
            </div>
          </div>
        </div>

        <!-- Empty State -->
        <div
          v-if="filteredProjects.length === 0"
          class="py-12 text-center select-none"
        >
          <IconSearch :size="32" class="mx-auto text-zinc-400/60 mb-2.5" />
          <p class="text-xs font-bold" :class="themeStore.isDark ? 'text-zinc-300' : 'text-zinc-700'">
            未找到匹配的工程项目
          </p>
          <p class="text-[11px] mt-1 text-zinc-400">
            可尝试搜索其他名称、本地路径或语言画像关键词
          </p>
        </div>
      </div>

      <!-- Bottom Status & Quick Shortcuts Footer -->
      <div
        class="h-9 px-4 flex items-center justify-between border-t text-[11px] transition-colors"
        :class="themeStore.isDark ? 'border-[#1f1f24] bg-[#0e0e11] text-zinc-400' : 'border-zinc-100 bg-zinc-50 text-zinc-500'"
      >
        <div class="flex items-center gap-3">
          <span>共找到 <strong :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">{{ filteredProjects.length }}</strong> 个匹配项目</span>
        </div>
        <div class="flex items-center gap-3 text-[10px] font-mono">
          <span><kbd>↑</kbd> <kbd>↓</kbd> 切换</span>
          <span><kbd>Enter</kbd> 打开</span>
          <span><kbd>Esc</kbd> 退出</span>
        </div>
      </div>
    </div>
  </n-modal>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { useProjectStore } from '../stores/projectStore.js';
import { useThemeStore } from '../stores/themeStore.js';
import { IconSearch } from './icons/index.js';

const router = useRouter();
const projectStore = useProjectStore();
const themeStore = useThemeStore();

const query = ref('');
const selectedIndex = ref(0);
const inputRef = ref<HTMLInputElement | null>(null);
const listRef = ref<HTMLElement | null>(null);

const filteredProjects = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) {
    return projectStore.projects;
  }
  return projectStore.projects.filter((p) => {
    const nameMatch = (p.name || '').toLowerCase().includes(q);
    const pathMatch = (p.rootPath || '').toLowerCase().includes(q);
    const langMatch = (p.primaryLanguages || []).some((l) => l.toLowerCase().includes(q));
    const fwMatch = (p.primaryFrameworks || []).some((f) => f.toLowerCase().includes(q));
    return nameMatch || pathMatch || langMatch || fwMatch;
  });
});

function handleAfterEnter() {
  query.value = '';
  selectedIndex.value = 0;
  nextTick(() => {
    inputRef.value?.focus();
  });
}

function handleAfterLeave() {
  query.value = '';
  selectedIndex.value = 0;
}

function selectProject(id: string) {
  projectStore.closeSearchModal();
  router.push(`/projects/${id}`);
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (filteredProjects.value.length > 0) {
      selectedIndex.value = (selectedIndex.value + 1) % filteredProjects.value.length;
      scrollToSelected();
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (filteredProjects.value.length > 0) {
      selectedIndex.value = (selectedIndex.value - 1 + filteredProjects.value.length) % filteredProjects.value.length;
      scrollToSelected();
    }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const item = filteredProjects.value[selectedIndex.value];
    if (item) {
      selectProject(item.id);
    }
  } else if (e.key === 'Escape') {
    projectStore.closeSearchModal();
  }
}

function scrollToSelected() {
  nextTick(() => {
    if (!listRef.value) return;
    const items = listRef.value.children;
    const activeItem = items[selectedIndex.value] as HTMLElement;
    if (activeItem) {
      activeItem.scrollIntoView({ block: 'nearest' });
    }
  });
}
</script>
