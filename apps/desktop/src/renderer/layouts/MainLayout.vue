<template>
  <div
    class="flex h-full w-full overflow-hidden transition-colors duration-200"
    :class="themeStore.isDark ? 'bg-[#09090b]' : 'bg-[#fafafa]'"
  >
    <!-- Sidebar with Smooth Right-to-Left Collapse Animation -->
    <aside
      class="h-full border-r flex flex-col justify-between select-none flex-shrink-0 z-20 relative overflow-hidden sidebar-transition"
      :class="[
        sidebarStore.isCollapsed ? 'w-[56px]' : 'w-[208px]',
        themeStore.isDark ? 'bg-[#0f0f12] border-[#27272a]' : 'bg-[#f4f4f5] border-[#e4e4e7]',
        sidebarStore.isCollapsed ? 'cursor-pointer' : ''
      ]"
      @click="handleSidebarBlankClick"
    >
      <!-- Top Brand & Navigation -->
      <div class="overflow-hidden">
        <!-- Brand Header (Left: Logo, Right: Quick Search) -->
        <div
          class="h-14 px-2 flex items-center transition-colors duration-200 overflow-hidden flex-shrink-0"
        >
          <!-- Left: Brand Logo & Title Container -->
          <div
            class="flex items-center min-w-0 overflow-hidden flex-1"
            :class="sidebarStore.isCollapsed ? 'cursor-pointer' : ''"
            :title="sidebarStore.isCollapsed ? '点击展开侧边栏' : ''"
            @click.stop="sidebarStore.isCollapsed ? sidebarStore.expandSidebar() : null"
          >
            <!-- Logo Icon: Fixed 40px container, icon centered at exactly 28px in sidebar -->
            <div class="w-10 h-10 flex items-center justify-center flex-shrink-0">
              <div
                class="w-8 h-8 rounded-lg border flex items-center justify-center shadow-xs flex-shrink-0 transition-colors"
                :class="[
                  themeStore.isDark ? 'bg-[#18181b] border-[#3f3f46] text-white' : 'bg-white border-zinc-300 text-zinc-950',
                  sidebarStore.isCollapsed ? 'hover:border-zinc-400' : ''
                ]"
              >
                <IconCodeHelmLogo :size="18" stroke-width="1.9" />
              </div>
            </div>

            <!-- Brand Text: Smooth 300ms fade & slide sync with sidebar expansion -->
            <div
              class="min-w-0 overflow-hidden whitespace-nowrap transition-all duration-300 ease-in-out pl-1.5"
              :class="sidebarStore.isCollapsed ? 'max-w-0 opacity-0 pointer-events-none p-0 m-0' : 'max-w-[110px] opacity-100 translate-x-0'"
            >
              <h1 class="font-bold text-xs tracking-tight truncate select-none" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
                CodeHelm
              </h1>
              <p class="text-[9px] font-medium truncate select-none" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
                本地多项目控制台
              </p>
            </div>
          </div>

          <!-- Right: Quick Search Button (Smooth 300ms fade & width expansion sync) -->
          <button
            type="button"
            class="h-7 flex items-center justify-center cursor-pointer flex-shrink-0 relative z-20 select-none transition-all duration-300 ease-in-out active:scale-90 group/search"
            :class="[
              sidebarStore.isCollapsed
                ? 'w-0 max-w-0 opacity-0 pointer-events-none p-0 m-0 border-0 overflow-hidden'
                : 'w-7 max-w-[28px] opacity-100 ml-1',
              themeStore.isDark ? 'text-zinc-400 hover:text-white' : 'text-zinc-500 hover:text-zinc-950'
            ]"
            title="搜索项目"
            @mouseenter="isSearchHovered = true"
            @mouseleave="isSearchHovered = false"
            @click.stop="handleQuickSearch"
          >
            <IconSearchAnimated
              :size="16"
              :hovered="isSearchHovered"
              :active="projectStore.searchModalVisible"
            />
          </button>
        </div>

        <!-- Navigation Menu with Outline Vector Icons -->
        <nav class="p-2 space-y-1 overflow-hidden" @click.stop>
          <!-- Overview Tab -->
          <router-link
            to="/"
            class="h-9 w-full rounded-lg flex items-center group relative select-none transition-colors duration-150"
            :class="[
              sidebarStore.isCollapsed ? 'overflow-visible' : 'overflow-hidden',
              $route.name === 'overview'
                ? (themeStore.isDark ? 'bg-white/10 text-white font-semibold' : 'bg-black text-white font-semibold shadow-xs')
                : (themeStore.isDark ? 'text-zinc-400 hover:bg-[#18181b] hover:text-zinc-100' : 'text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-950')
            ]"
            :title="sidebarStore.isCollapsed ? `项目总览 (${projectStore.projects.length})` : ''"
            @mouseenter="isOverviewHovered = true"
            @mouseleave="isOverviewHovered = false"
          >
            <!-- Fixed Icon Box (40px wide, centered at exactly 28px in sidebar) -->
            <div class="w-10 h-9 flex items-center justify-center flex-shrink-0 relative">
              <IconProjectGrid
                :size="16"
                :hovered="isOverviewHovered"
                :active="$route.name === 'overview'"
              />
            </div>

            <!-- Expanded Mode Text & Badge (Smooth clipping to the right of fixed icon) -->
            <div
              class="flex items-center justify-between min-w-0 flex-1 overflow-hidden whitespace-nowrap pr-2"
              :class="sidebarStore.isCollapsed ? 'max-w-0 opacity-0 -translate-x-2 pointer-events-none' : 'max-w-[145px] opacity-100 translate-x-0'"
            >
              <span class="truncate text-xs font-medium transition-transform duration-150 group-hover:translate-x-0.5">项目总览</span>
              <span
                v-if="projectStore.projects.length"
                class="text-[9px] px-1.5 py-0.2 rounded font-mono font-medium flex-shrink-0 ml-1.5"
                :class="themeStore.isDark ? 'bg-[#27272a] text-zinc-300' : ($route.name === 'overview' ? 'bg-zinc-800 text-zinc-200' : 'bg-zinc-200 text-zinc-700')"
              >
                {{ projectStore.projects.length }}
              </span>
            </div>

            <!-- Collapsed Float Badge: Positioned at outside square top-right corner, 100% round and unclipped -->
            <span
              v-if="projectStore.projects.length"
              class="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-mono font-bold flex items-center justify-center border shadow-xs z-20 select-none leading-none"
              :class="[
                sidebarStore.isCollapsed ? 'opacity-100 scale-100' : 'opacity-0 scale-50 pointer-events-none',
                themeStore.isDark ? 'bg-[#27272a] text-white border-[#3f3f46]' : 'bg-zinc-200 text-zinc-900 border-zinc-300'
              ]"
            >
              {{ projectStore.projects.length }}
            </span>
          </router-link>

          <!-- Runner Center Tab -->
          <router-link
            to="/runner"
            class="h-9 w-full rounded-lg flex items-center group relative select-none transition-colors duration-150"
            :class="[
              sidebarStore.isCollapsed ? 'overflow-visible' : 'overflow-hidden',
              $route.name === 'runner'
                ? (themeStore.isDark ? 'bg-white/10 text-white font-semibold' : 'bg-black text-white font-semibold shadow-xs')
                : (themeStore.isDark ? 'text-zinc-400 hover:bg-[#18181b] hover:text-zinc-100' : 'text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-950')
            ]"
            :title="sidebarStore.isCollapsed ? `运行中心 (${runnerStore.runningCount > 0 ? runnerStore.runningCount + ' 个活跃进程' : '空闲'})` : ''"
            @mouseenter="isRunnerHovered = true"
            @mouseleave="isRunnerHovered = false"
          >
            <!-- Fixed Icon Box -->
            <div class="w-10 h-9 flex items-center justify-center flex-shrink-0 relative">
              <IconRunnerZap
                :size="16"
                :hovered="isRunnerHovered"
                :active="$route.name === 'runner'"
                :is-running="runnerStore.runningCount > 0"
              />
            </div>

            <!-- Expanded Mode Text & Active Badge -->
            <div
              class="flex items-center justify-between min-w-0 flex-1 overflow-hidden whitespace-nowrap pr-2"
              :class="sidebarStore.isCollapsed ? 'max-w-0 opacity-0 -translate-x-2 pointer-events-none' : 'max-w-[145px] opacity-100 translate-x-0'"
            >
              <span class="truncate text-xs font-medium transition-transform duration-150 group-hover:translate-x-0.5">运行中心</span>
              <div
                v-if="runnerStore.runningCount > 0"
                class="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-full text-[9px] font-mono font-medium flex-shrink-0 ml-1.5 leading-none"
                :class="themeStore.isDark ? 'bg-white/15 text-white border border-white/30' : ($route.name === 'runner' ? 'bg-zinc-800 text-white border border-zinc-700' : 'bg-black text-white border border-black')"
              >
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 pulsing-dot-active flex-shrink-0 -translate-y-[0.5px]" />
                <span class="leading-none">{{ runnerStore.runningCount }}</span>
              </div>
            </div>

            <!-- Collapsed Float Badge: Positioned at outside square top-right corner, 100% round and unclipped -->
            <span
              v-if="runnerStore.runningCount > 0"
              class="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-mono font-bold flex items-center justify-center border shadow-xs z-20 select-none leading-none"
              :class="[
                sidebarStore.isCollapsed ? 'opacity-100 scale-100' : 'opacity-0 scale-50 pointer-events-none',
                themeStore.isDark ? 'bg-white text-black border-zinc-200' : 'bg-black text-white border-zinc-800'
              ]"
            >
              {{ runnerStore.runningCount }}
            </span>
          </router-link>

          <!-- Live Console Tab -->
          <router-link
            to="/console"
            class="h-9 w-full rounded-lg flex items-center group relative select-none transition-colors duration-150"
            :class="[
              sidebarStore.isCollapsed ? 'overflow-visible' : 'overflow-hidden',
              $route.name === 'console'
                ? (themeStore.isDark ? 'bg-white/10 text-white font-semibold' : 'bg-black text-white font-semibold shadow-xs')
                : (themeStore.isDark ? 'text-zinc-400 hover:bg-[#18181b] hover:text-zinc-100' : 'text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-950')
            ]"
            :title="sidebarStore.isCollapsed ? `实时控制台 (${runnerStore.logs.length} 条日志)` : ''"
            @mouseenter="isConsoleHovered = true"
            @mouseleave="isConsoleHovered = false"
          >
            <!-- Fixed Icon Box -->
            <div class="w-10 h-9 flex items-center justify-center flex-shrink-0 relative">
              <IconTerminalAnimated
                :size="16"
                :hovered="isConsoleHovered"
                :active="$route.name === 'console'"
              />
            </div>

            <!-- Expanded Mode Text & Active Badge -->
            <div
              class="flex items-center justify-between min-w-0 flex-1 overflow-hidden whitespace-nowrap pr-2"
              :class="sidebarStore.isCollapsed ? 'max-w-0 opacity-0 -translate-x-2 pointer-events-none' : 'max-w-[145px] opacity-100 translate-x-0'"
            >
              <span class="truncate text-xs font-medium transition-transform duration-150 group-hover:translate-x-0.5">实时控制台</span>
              <div
                v-if="runnerStore.logs.length > 0"
                class="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-full text-[9px] font-mono font-medium flex-shrink-0 ml-1.5 leading-none"
                :class="stderrLogsCount > 0
                  ? (themeStore.isDark ? 'bg-rose-950/70 text-rose-300 border border-rose-700/60' : 'bg-rose-100 text-rose-800 border border-rose-300')
                  : (themeStore.isDark ? 'bg-[#27272a] text-zinc-300' : ($route.name === 'console' ? 'bg-zinc-800 text-zinc-200' : 'bg-zinc-200 text-zinc-700'))"
              >
                <span v-if="stderrLogsCount > 0" class="w-1.5 h-1.5 rounded-full bg-rose-400 flex-shrink-0 -translate-y-[0.5px]" />
                <span class="leading-none">{{ stderrLogsCount > 0 ? stderrLogsCount + ' 错' : runnerStore.logs.length }}</span>
              </div>
            </div>

            <!-- Collapsed Float Badge: Positioned at outside square top-right corner, 100% round and unclipped -->
            <span
              v-if="stderrLogsCount > 0 || (runnerStore.runningCount > 0 && runnerStore.logs.length > 0)"
              class="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-mono font-bold flex items-center justify-center border shadow-xs z-20 select-none leading-none"
              :class="[
                sidebarStore.isCollapsed ? 'opacity-100 scale-100' : 'opacity-0 scale-50 pointer-events-none',
                stderrLogsCount > 0
                  ? (themeStore.isDark ? 'bg-rose-950 text-rose-300 border-rose-700' : 'bg-rose-100 text-rose-800 border-rose-300')
                  : (themeStore.isDark ? 'bg-[#27272a] text-white border-[#3f3f46]' : 'bg-zinc-200 text-zinc-900 border-zinc-300')
              ]"
            >
              {{ stderrLogsCount > 0 ? stderrLogsCount : runnerStore.logs.length }}
            </span>
          </router-link>
        </nav>
      </div>

      <!-- Bottom Settings -->
      <div
        class="border-t p-2 overflow-hidden flex-shrink-0"
        :class="themeStore.isDark ? 'border-[#27272a]' : 'border-[#e4e4e7]'"
        @click.stop
      >
        <router-link
          to="/settings"
          class="h-9 w-full rounded-lg flex items-center overflow-hidden group relative select-none transition-colors duration-150"
          :class="[
            $route.name === 'settings'
              ? (themeStore.isDark ? 'bg-white/10 text-white font-semibold' : 'bg-black text-white font-semibold shadow-xs')
              : (themeStore.isDark ? 'text-zinc-400 hover:bg-[#18181b] hover:text-zinc-100' : 'text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-950')
          ]"
          :title="sidebarStore.isCollapsed ? '系统设置' : ''"
        >
          <!-- Fixed Icon Box -->
          <div class="w-10 h-9 flex items-center justify-center flex-shrink-0 relative">
            <IconSettings
              :size="16"
              class="transition-transform duration-400 ease-in-out"
              :class="$route.name === 'settings' ? 'rotate-90 group-hover:rotate-[270deg]' : 'group-hover:rotate-180'"
            />
          </div>

          <div
            class="flex items-center justify-between min-w-0 flex-1 overflow-hidden whitespace-nowrap pr-2"
            :class="sidebarStore.isCollapsed ? 'max-w-0 opacity-0 -translate-x-2 pointer-events-none' : 'max-w-[145px] opacity-100 translate-x-0'"
          >
            <span class="truncate text-xs font-medium transition-transform duration-150 group-hover:translate-x-0.5">系统设置</span>
          </div>
        </router-link>
      </div>
    </aside>

    <!-- Main Content Area with Smooth Page Transitions -->
    <main
      class="flex-1 h-full min-w-0 flex flex-col overflow-hidden transition-colors duration-200"
      :class="themeStore.isDark ? 'bg-[#09090b]' : 'bg-[#fafafa]'"
    >
      <router-view v-slot="{ Component, route }">
        <transition name="page-fade-slide" mode="out-in">
          <component :is="Component" :key="route.fullPath" />
        </transition>
      </router-view>
    </main>

    <!-- Global Modals -->
    <ImportProjectModal />
    <QuickSearchModal v-model:show="searchModalVisible" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useProjectStore } from '../stores/projectStore.js';
import { useRunnerStore } from '../stores/runnerStore.js';
import { useThemeStore } from '../stores/themeStore.js';
import { useSidebarStore } from '../stores/sidebarStore.js';
import ImportProjectModal from '../components/ImportProjectModal.vue';
import QuickSearchModal from '../components/QuickSearchModal.vue';
import {
  IconProjectGrid,
  IconRunnerZap,
  IconTerminalAnimated,
  IconSettings,
  IconCodeHelmLogo,
  IconSearchAnimated,
} from '../components/icons/index.js';

const projectStore = useProjectStore();
const runnerStore = useRunnerStore();
const themeStore = useThemeStore();
const sidebarStore = useSidebarStore();

// Hover states for icon animations
const isOverviewHovered = ref(false);
const isRunnerHovered = ref(false);
const isConsoleHovered = ref(false);
const isSearchHovered = ref(false);
const searchModalVisible = ref(false);

const stderrLogsCount = computed(() => {
  return runnerStore.logs.filter((l) => l.stream === 'stderr').length;
});

watch(
  () => projectStore.searchModalVisible,
  (val) => {
    searchModalVisible.value = val;
  }
);

function handleSidebarBlankClick() {
  if (sidebarStore.isCollapsed) {
    sidebarStore.expandSidebar();
  }
}

function handleQuickSearch() {
  projectStore.openSearchModal();
  searchModalVisible.value = true;
}

function handleGlobalKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (searchModalVisible.value || projectStore.searchModalVisible) {
      searchModalVisible.value = false;
      projectStore.closeSearchModal();
    } else {
      searchModalVisible.value = true;
      projectStore.openSearchModal();
    }
  }
}

onMounted(() => {
  projectStore.fetchProjects();
  runnerStore.setupListeners();
  window.addEventListener('keydown', handleGlobalKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeydown);
});
</script>

<style scoped>
.sidebar-transition {
  transition: width 300ms cubic-bezier(0.4, 0, 0.2, 1), background-color 200ms ease, border-color 200ms ease;
  will-change: width;
}

.page-fade-slide-enter-active,
.page-fade-slide-leave-active {
  transition: opacity 200ms cubic-bezier(0.4, 0, 0.2, 1), transform 200ms cubic-bezier(0.4, 0, 0.2, 1);
  will-change: opacity, transform;
}

.page-fade-slide-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.page-fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
