<template>
  <div
    class="flex h-full w-full overflow-hidden transition-colors duration-200"
    :class="themeStore.isDark ? 'bg-[#09090b]' : 'bg-[#fafafa]'"
  >
    <!-- Sidebar with Smooth Right-to-Left Collapse Animation -->
    <aside
      class="h-full border-r flex flex-col justify-between select-none flex-shrink-0 z-10 overflow-hidden sidebar-transition"
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
          class="h-14 px-2 flex items-center justify-between transition-colors duration-200 overflow-hidden flex-shrink-0"
        >
          <!-- Left: Brand Logo & Title Container -->
          <div
            class="flex items-center min-w-0 overflow-hidden flex-1"
            :class="sidebarStore.isCollapsed ? 'cursor-pointer' : ''"
            :title="sidebarStore.isCollapsed ? '点击展开侧边栏' : ''"
            @click.stop="sidebarStore.isCollapsed ? sidebarStore.expandSidebar() : null"
          >
            <!-- Logo Icon: Fixed 40px container, icon centered at exactly 28px -->
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

            <!-- Brand Text: Smooth fade & slide without affecting logo -->
            <div
              class="min-w-0 overflow-hidden whitespace-nowrap transition-all duration-300 ease-in-out pl-1.5"
              :class="sidebarStore.isCollapsed ? 'max-w-0 opacity-0 pointer-events-none p-0 m-0' : 'max-w-[100px] opacity-100 translate-x-0'"
            >
              <h1 class="font-bold text-xs tracking-tight truncate" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
                CodeHelm
              </h1>
              <p class="text-[9px] font-medium truncate" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
                本地多项目控制台
              </p>
            </div>
          </div>

          <!-- Right: Quick Search Button -->
          <button
            type="button"
            class="w-7 h-7 rounded-lg border flex items-center justify-center transition-all duration-150 cursor-pointer flex-shrink-0 relative z-20 select-none ml-1"
            :class="[
              sidebarStore.isCollapsed ? 'hidden' : 'flex',
              themeStore.isDark
                ? 'bg-[#18181b] hover:bg-[#27272a] text-zinc-400 hover:text-white border-[#27272a] hover:border-zinc-500 shadow-2xs active:scale-95'
                : 'bg-white hover:bg-zinc-100 text-zinc-600 hover:text-zinc-950 border-zinc-200 hover:border-zinc-300 shadow-2xs active:scale-95'
            ]"
            title="搜索项目 (Ctrl+K)"
            @click.stop.prevent="handleQuickSearch"
          >
            <IconSearch :size="14" class="pointer-events-none" />
          </button>
        </div>

        <!-- Navigation Menu with Outline Vector Icons -->
        <nav class="p-2 space-y-1 overflow-hidden" @click.stop>
          <!-- Overview Tab -->
          <router-link
            to="/"
            class="h-9 w-full rounded-lg flex items-center transition-all duration-150 group relative"
            :class="[
              sidebarStore.isCollapsed ? 'overflow-visible' : 'overflow-hidden',
              $route.name === 'overview'
                ? (themeStore.isDark ? 'bg-white/10 text-white border border-white/20 shadow-xs font-semibold' : 'bg-black text-white border border-black font-semibold shadow-xs')
                : (themeStore.isDark ? 'text-zinc-400 hover:bg-[#18181b] hover:text-zinc-100 border border-transparent' : 'text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-950 border border-transparent')
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
              class="flex items-center justify-between min-w-0 flex-1 overflow-hidden transition-all duration-300 ease-in-out whitespace-nowrap pr-2"
              :class="sidebarStore.isCollapsed ? 'max-w-0 opacity-0 -translate-x-2 pointer-events-none' : 'max-w-[145px] opacity-100 translate-x-0'"
            >
              <span class="truncate text-xs font-medium transition-transform duration-200 group-hover:translate-x-0.5">项目总览</span>
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
              class="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-mono font-bold flex items-center justify-center border shadow-xs transition-all duration-200 z-20 select-none leading-none"
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
            class="h-9 w-full rounded-lg flex items-center transition-all duration-150 group relative"
            :class="[
              sidebarStore.isCollapsed ? 'overflow-visible' : 'overflow-hidden',
              $route.name === 'runner'
                ? (themeStore.isDark ? 'bg-white/10 text-white border border-white/20 shadow-xs font-semibold' : 'bg-black text-white border border-black font-semibold shadow-xs')
                : (themeStore.isDark ? 'text-zinc-400 hover:bg-[#18181b] hover:text-zinc-100 border border-transparent' : 'text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-950 border border-transparent')
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
              class="flex items-center justify-between min-w-0 flex-1 overflow-hidden transition-all duration-300 ease-in-out whitespace-nowrap pr-2"
              :class="sidebarStore.isCollapsed ? 'max-w-0 opacity-0 -translate-x-2 pointer-events-none' : 'max-w-[145px] opacity-100 translate-x-0'"
            >
              <span class="truncate text-xs font-medium transition-transform duration-200 group-hover:translate-x-0.5">运行中心</span>
              <div
                v-if="runnerStore.runningCount > 0"
                class="flex items-center gap-1 px-1.5 py-0.2 rounded-full text-[9px] font-mono font-medium flex-shrink-0 ml-1.5"
                :class="themeStore.isDark ? 'bg-white/15 text-white border border-white/30' : ($route.name === 'runner' ? 'bg-zinc-800 text-white border border-zinc-700' : 'bg-black text-white border border-black')"
              >
                <span class="w-1.5 h-1.5 rounded-full bg-white pulsing-dot-active" />
                <span>{{ runnerStore.runningCount }}</span>
              </div>
            </div>

            <!-- Collapsed Float Badge: Positioned at outside square top-right corner, 100% round and unclipped -->
            <span
              v-if="runnerStore.runningCount > 0"
              class="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-mono font-bold flex items-center justify-center border shadow-xs transition-all duration-200 z-20 select-none leading-none"
              :class="[
                sidebarStore.isCollapsed ? 'opacity-100 scale-100' : 'opacity-0 scale-50 pointer-events-none',
                themeStore.isDark ? 'bg-white text-black border-zinc-200' : 'bg-black text-white border-zinc-800'
              ]"
            >
              {{ runnerStore.runningCount }}
            </span>
          </router-link>
        </nav>
      </div>

      <!-- Bottom Settings -->
      <div
        class="border-t p-2 transition-all duration-300 ease-in-out overflow-hidden flex-shrink-0"
        :class="themeStore.isDark ? 'border-[#27272a]' : 'border-[#e4e4e7]'"
        @click.stop
      >
        <router-link
          to="/settings"
          class="h-9 w-full rounded-lg flex items-center overflow-hidden transition-all duration-150 group relative"
          :class="[
            $route.name === 'settings'
              ? (themeStore.isDark ? 'bg-white/10 text-white border border-white/20 shadow-xs font-semibold' : 'bg-black text-white border border-black font-semibold shadow-xs')
              : (themeStore.isDark ? 'text-zinc-400 hover:bg-[#18181b] hover:text-zinc-100 border border-transparent' : 'text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-950 border border-transparent')
          ]"
          :title="sidebarStore.isCollapsed ? '系统设置' : ''"
        >
          <!-- Fixed Icon Box -->
          <div class="w-10 h-9 flex items-center justify-center flex-shrink-0 relative">
            <IconSettings
              :size="16"
              class="transition-transform duration-500 ease-in-out"
              :class="$route.name === 'settings' ? 'rotate-90 scale-105' : 'group-hover:rotate-180 group-hover:scale-110'"
            />
          </div>

          <div
            class="flex items-center justify-between min-w-0 flex-1 overflow-hidden transition-all duration-300 ease-in-out whitespace-nowrap pr-2"
            :class="sidebarStore.isCollapsed ? 'max-w-0 opacity-0 -translate-x-2 pointer-events-none' : 'max-w-[145px] opacity-100 translate-x-0'"
          >
            <span class="truncate text-xs font-medium transition-transform duration-200 group-hover:translate-x-0.5">系统设置</span>
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
    <QuickSearchModal />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useProjectStore } from '../stores/projectStore.js';
import { useRunnerStore } from '../stores/runnerStore.js';
import { useThemeStore } from '../stores/themeStore.js';
import { useSidebarStore } from '../stores/sidebarStore.js';
import ImportProjectModal from '../components/ImportProjectModal.vue';
import QuickSearchModal from '../components/QuickSearchModal.vue';
import {
  IconProjectGrid,
  IconRunnerZap,
  IconSettings,
  IconCodeHelmLogo,
  IconSearch,
} from '../components/icons/index.js';

const projectStore = useProjectStore();
const runnerStore = useRunnerStore();
const themeStore = useThemeStore();
const sidebarStore = useSidebarStore();

// Hover states for icon animations
const isOverviewHovered = ref(false);
const isRunnerHovered = ref(false);

function handleSidebarBlankClick() {
  if (sidebarStore.isCollapsed) {
    sidebarStore.expandSidebar();
  }
}

function handleQuickSearch() {
  projectStore.openSearchModal();
}

function handleGlobalKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    projectStore.searchModalVisible = !projectStore.searchModalVisible;
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
