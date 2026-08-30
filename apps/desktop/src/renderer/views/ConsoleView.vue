<template>
  <div class="h-full flex flex-col p-6 overflow-hidden max-w-7xl mx-auto w-full font-sans">
    <!-- Top Header -->
    <header
      class="flex items-center justify-between pb-4 border-b flex-shrink-0 transition-colors duration-200"
      :class="themeStore.isDark ? 'border-[#27272a]' : 'border-zinc-200'"
    >
      <div>
        <div class="flex items-center gap-3">
          <h1 class="text-xl font-bold tracking-tight" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
            实时控制台
          </h1>
          <span
            v-if="runnerStore.runningCount > 0"
            class="text-[11px] font-medium px-2.5 py-0.5 rounded-full border flex items-center gap-1.5 shadow-2xs"
            :class="themeStore.isDark ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/40' : 'bg-emerald-50 text-emerald-700 border-emerald-300'"
          >
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 pulsing-dot-active flex-shrink-0 -translate-y-[0.5px]" />
            <span>{{ runnerStore.runningCount }} 个活跃进程捕获中</span>
          </span>
          <span
            v-else
            class="text-[11px] font-medium px-2.5 py-0.5 rounded-full border"
            :class="themeStore.isDark ? 'bg-[#18181b] text-zinc-400 border-[#27272a]' : 'bg-zinc-100 text-zinc-600 border-zinc-200'"
          >
            服务空闲中
          </span>

          <span
            v-if="stderrLogsCount > 0"
            class="text-[11px] font-sans font-medium px-2.5 py-0.5 rounded-full border flex items-center gap-1.5 shadow-2xs select-none"
            :class="themeStore.isDark
              ? 'bg-rose-950/40 text-rose-300 border-rose-800/80'
              : 'bg-rose-50 text-rose-700 border-rose-200'"
          >
            <span class="w-1.5 h-1.5 rounded-full bg-rose-500 flex-shrink-0" />
            <span>{{ stderrLogsCount }} 条错误 (ERR)</span>
          </span>
        </div>
        <p class="text-xs mt-1" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
          多项目统一终端日志流与进程标准输出捕获，支持按工程、服务组件与输出流多维过滤
        </p>
      </div>

      <!-- Top Right Global Actions -->
      <div class="flex items-center gap-2 flex-shrink-0">
        <!-- Export All Logs -->
        <button
          type="button"
          class="h-8 px-3 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer select-none"
          :class="themeStore.isDark
            ? 'bg-[#18181b] border-[#27272a] text-zinc-300 hover:text-white hover:border-zinc-500'
            : 'bg-white border-zinc-200 text-zinc-700 hover:text-zinc-950 hover:border-zinc-400 shadow-2xs'"
          title="导出当前过滤日志为 .log 文件"
          @click="exportLogsToFile"
        >
          <IconDownload :size="13" />
          <span>导出日志</span>
        </button>

        <!-- Clear Logs -->
        <button
          type="button"
          class="h-8 px-3 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer select-none border"
          :class="themeStore.isDark
            ? 'bg-rose-950/30 border-rose-900/60 text-rose-300 hover:bg-rose-900/40 hover:text-rose-200'
            : 'bg-rose-50 border-rose-200 text-rose-600 hover:bg-rose-100 hover:text-rose-700 shadow-2xs'"
          title="清空控制台实时历史日志"
          @mouseenter="isTrashHovered = true"
          @mouseleave="isTrashHovered = false"
          @click="handleClearLogs"
        >
          <IconTrash :size="13" :open="isTrashHovered" />
          <span>清屏</span>
        </button>
      </div>
    </header>

    <!-- Main Professional Terminal Window (Framed Dark macOS IDE Style) -->
    <div class="flex-1 mt-4 flex flex-col bg-[#09090b] border border-[#27272a] rounded-2xl overflow-hidden shadow-2xl transition-all">
      <!-- 1. Terminal Titlebar (macOS Style Traffic Lights & Project Switcher) -->
      <div class="h-11 px-4 bg-[#121216] border-b border-[#27272a] flex items-center justify-between flex-shrink-0 select-none">
        <!-- Left: Traffic Lights + Project Filter Tabs -->
        <div class="flex items-center gap-3 min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]">
          <div class="flex items-center gap-1.5 flex-shrink-0">
            <span class="w-2.5 h-2.5 rounded-full bg-[#ff5f56]/90 border border-[#e0443e]/50 inline-block shadow-xs" />
            <span class="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]/90 border border-[#dea123]/50 inline-block shadow-xs" />
            <span class="w-2.5 h-2.5 rounded-full bg-[#27c93f]/90 border border-[#1aab29]/50 inline-block shadow-xs" />
          </div>

          <div class="h-4 w-[1px] bg-[#27272a] flex-shrink-0" />

          <!-- Project Filter Tabs -->
          <div class="flex items-center gap-1 flex-shrink-0">
            <button
              type="button"
              class="px-2.5 py-1 rounded-md text-xs transition-colors cursor-pointer select-none font-medium flex items-center gap-1.5"
              :class="selectedProjectFilter === 'ALL'
                ? 'bg-zinc-700 text-white font-semibold shadow-xs'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#1c1c22]'"
              @click="handleSelectProject('ALL')"
            >
              <span>全部项目</span>
              <span class="font-mono text-[10px] opacity-75">({{ runnerStore.logs.length }})</span>
            </button>

            <button
              v-for="p in activeOrLoggedProjects"
              :key="p.id"
              type="button"
              class="px-2.5 py-1 rounded-md text-xs transition-colors cursor-pointer select-none font-medium flex items-center gap-1.5"
              :class="selectedProjectFilter === p.id
                ? 'bg-zinc-700 text-white font-semibold shadow-xs'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#1c1c22]'"
              @click="handleSelectProject(p.id)"
            >
              <span
                class="w-1.5 h-1.5 rounded-full flex-shrink-0"
                :class="runnerStore.getProjectState(p.id).runningCount > 0 ? 'bg-emerald-400 pulsing-dot-active' : 'bg-zinc-600'"
              />
              <span class="truncate max-w-[130px]">{{ p.name }}</span>
              <span class="font-mono text-[10px] opacity-75">
                ({{ getProjectLogCount(p.id) }})
              </span>
            </button>
          </div>
        </div>

        <!-- Right: Status / Line Count Badge -->
        <div class="flex items-center gap-2 flex-shrink-0 pl-3">
          <div class="flex items-center gap-1.5 text-xs font-mono font-medium text-zinc-300 bg-[#18181b] border border-[#27272a] px-2 py-0.5 rounded-md">
            <IconTerminal :size="12" class="text-zinc-400" />
            <span>{{ filteredLogs.length }} 行</span>
          </div>

          <div
            class="flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] font-sans font-medium"
            :class="isAnyServiceActive
              ? 'bg-emerald-950/50 border-emerald-800/80 text-emerald-300'
              : 'bg-[#18181b] border-[#27272a] text-zinc-500'"
          >
            <span
              class="w-1.5 h-1.5 rounded-full flex-shrink-0"
              :class="isAnyServiceActive ? 'bg-emerald-400 pulsing-dot-active' : 'bg-zinc-600'"
            />
            <span>{{ isAnyServiceActive ? '捕获活跃中' : '服务未运行' }}</span>
          </div>
        </div>
      </div>

      <!-- 2. Integrated Terminal Sub-Toolbar (Filters & Terminal Controls) -->
      <div class="px-3.5 py-2 bg-[#101014] border-b border-[#202028] flex items-center justify-between gap-3 flex-wrap flex-shrink-0 text-xs font-sans">
        <!-- Left: Service Selector + Stream Level + Search Box -->
        <div class="flex items-center gap-2 flex-wrap min-w-0">
          <!-- Service Selector Pills -->
          <div v-if="availableServicesForFilter.length > 0" class="flex items-center gap-1 bg-[#18181b] p-0.5 rounded-lg border border-[#27272a]">
            <button
              type="button"
              class="px-2.5 py-1 rounded text-xs transition-colors cursor-pointer select-none font-medium flex items-center gap-1"
              :class="selectedServiceFilter === 'ALL'
                ? 'bg-white text-black font-semibold shadow-xs'
                : 'text-zinc-400 hover:text-zinc-200'"
              @click="selectedServiceFilter = 'ALL'"
            >
              <span>全部服务</span>
              <span class="font-mono text-[10px] opacity-80">({{ projectScopedTotalLogs }})</span>
            </button>

            <button
              v-for="svc in availableServicesForFilter"
              :key="svc"
              type="button"
              class="px-2.5 py-1 rounded text-xs transition-colors cursor-pointer select-none flex items-center gap-1.5 font-medium"
              :class="selectedServiceFilter === svc
                ? 'bg-white text-black font-semibold shadow-xs'
                : 'text-zinc-400 hover:text-zinc-200'"
              @click="selectedServiceFilter = svc"
            >
              <span>{{ svc }}</span>
              <span class="font-mono text-[10px] opacity-75">
                ({{ getServiceLogCount(svc) }})
              </span>
            </button>
          </div>

          <!-- Stream Level Filter (ALL / OUT / ERR) -->
          <div class="flex items-center gap-0.5 bg-[#18181b] p-0.5 rounded-lg border border-[#27272a] font-mono text-[11px]">
            <button
              type="button"
              class="px-2 py-1 rounded transition-colors cursor-pointer select-none font-semibold"
              :class="selectedStreamFilter === 'ALL'
                ? 'bg-zinc-700 text-white shadow-xs'
                : 'text-zinc-400 hover:text-zinc-200'"
              @click="selectedStreamFilter = 'ALL'"
            >
              ALL
            </button>
            <button
              type="button"
              class="px-2 py-1 rounded transition-colors cursor-pointer select-none font-semibold"
              :class="selectedStreamFilter === 'stdout'
                ? 'bg-zinc-700 text-white shadow-xs'
                : 'text-zinc-400 hover:text-zinc-200'"
              @click="selectedStreamFilter = 'stdout'"
            >
              OUT
            </button>
            <button
              type="button"
              class="px-2 py-1 rounded transition-colors cursor-pointer select-none font-semibold flex items-center gap-1"
              :class="selectedStreamFilter === 'stderr'
                ? 'bg-rose-900 text-rose-200 shadow-xs'
                : 'text-zinc-400 hover:text-rose-400'"
              @click="selectedStreamFilter = 'stderr'"
            >
              <span>ERR</span>
              <span v-if="filteredStderrCount > 0" class="text-[10px]">({{ filteredStderrCount }})</span>
            </button>
          </div>

          <!-- Terminal Search Box -->
          <div class="relative flex items-center">
            <input
              v-model="logSearch"
              type="text"
              placeholder="检索日志关键字..."
              class="h-7 w-44 bg-[#18181b] border border-[#27272a] text-zinc-200 placeholder-zinc-500 text-xs rounded-lg pl-7 pr-6 outline-none focus:border-zinc-400 transition-colors font-sans"
            />
            <IconSearch :size="12" class="text-zinc-500 absolute left-2 pointer-events-none" />
            <button
              v-if="logSearch"
              type="button"
              class="text-zinc-500 hover:text-zinc-300 absolute right-2 text-xs cursor-pointer"
              @click="logSearch = ''"
            >
              ×
            </button>
          </div>
        </div>

        <!-- Right: Quick Utilities Toolbar -->
        <div class="flex items-center gap-1.5 flex-shrink-0 font-sans">
          <!-- Auto-scroll Toggle -->
          <button
            type="button"
            class="h-7 px-2.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer select-none"
            :class="autoScroll
              ? 'bg-emerald-950/50 border-emerald-700 text-emerald-300 shadow-xs'
              : 'bg-[#18181b] border-[#27272a] text-zinc-400 hover:text-zinc-200'"
            :title="autoScroll ? '自动滚动已开启' : '点击开启自动滚动'"
            @click="autoScroll = !autoScroll"
          >
            <IconZap :size="12" />
            <span>{{ autoScroll ? '滚屏锁定' : '自由滚动' }}</span>
          </button>

          <!-- Show Timestamps Toggle -->
          <button
            type="button"
            class="h-7 px-2.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer select-none"
            :class="showTimestamps
              ? 'bg-[#27272a] border-zinc-600 text-zinc-200 shadow-xs'
              : 'bg-[#18181b] border-[#27272a] text-zinc-500 hover:text-zinc-300'"
            title="切换时间戳显示"
            @click="showTimestamps = !showTimestamps"
          >
            时间戳
          </button>

          <!-- Show Line Numbers Toggle -->
          <button
            type="button"
            class="h-7 px-2.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer select-none"
            :class="showLineNumbers
              ? 'bg-[#27272a] border-zinc-600 text-zinc-200 shadow-xs'
              : 'bg-[#18181b] border-[#27272a] text-zinc-500 hover:text-zinc-300'"
            title="切换行号显示"
            @click="showLineNumbers = !showLineNumbers"
          >
            行号
          </button>

          <div class="h-4 w-[1px] bg-[#27272a] mx-0.5" />

          <!-- Copy Filtered Logs -->
          <button
            type="button"
            class="h-7 px-2.5 bg-[#18181b] border border-[#27272a] text-zinc-300 hover:text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer select-none hover:border-zinc-500"
            title="复制当前过滤的所有日志"
            @click="copyAllLogs"
          >
            <IconCopy :size="12" />
            <span>复制</span>
          </button>
        </div>
      </div>

      <!-- 3. Terminal Output Stream Window -->
      <div
        ref="logContainerRef"
        class="flex-1 overflow-y-auto p-4 terminal-code-stream space-y-1 select-text bg-[#09090b] text-zinc-300 [scrollbar-gutter:stable]"
      >
        <!-- Empty State -->
        <div
          v-if="filteredLogs.length === 0"
          class="text-zinc-500 text-center py-24 flex flex-col items-center justify-center gap-3 select-none font-sans"
        >
          <div class="w-14 h-14 rounded-2xl bg-[#121216] border border-[#27272a] flex items-center justify-center text-zinc-400 shadow-md">
            <IconTerminal :size="28" />
          </div>
          <div class="text-sm font-bold tracking-tight text-zinc-200">
            {{ isAnyServiceActive ? '等待服务进程产生终端输出...' : '当前无正在运行的服务进程' }}
          </div>
          <div class="text-xs text-zinc-400 max-w-md leading-relaxed">
            {{ isAnyServiceActive
              ? '受管服务正在后台运行中，新的 stdout / stderr 输出流将自动实时捕获并滚动呈现。'
              : '您可以在【项目总览】或【运行中心】一键启动服务，控制台将自动汇聚多进程实时输出。'
            }}
          </div>
          <div v-if="!isAnyServiceActive" class="mt-2">
            <button
              type="button"
              class="px-3.5 py-1.5 bg-[#18181b] hover:bg-[#202028] border border-[#27272a] hover:border-zinc-500 text-zinc-200 text-xs font-medium rounded-lg transition-colors cursor-pointer shadow-xs"
              @click="$router.push('/')"
            >
              前往项目总览启动服务
            </button>
          </div>
        </div>

        <!-- Log Rows -->
        <div
          v-for="(entry, idx) in filteredLogs"
          :key="idx"
          class="leading-relaxed break-all flex items-start gap-2.5 hover:bg-[#15151a] px-2 py-0.5 rounded transition-colors group"
        >
          <!-- Line Number -->
          <span
            v-if="showLineNumbers"
            class="text-zinc-600 text-xs select-none flex-shrink-0 w-8 text-right font-mono"
          >
            {{ String(idx + 1).padStart(3, '0') }}
          </span>

          <!-- Timestamp -->
          <span
            v-if="showTimestamps"
            class="text-zinc-500 text-xs select-none flex-shrink-0 font-mono"
          >
            {{ entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '' }}
          </span>

          <!-- Project Tag (when in ALL projects mode) -->
          <span
            v-if="selectedProjectFilter === 'ALL' && getEntryProjectName(entry)"
            class="text-zinc-400 text-[10px] bg-[#14141c] px-1.5 py-0.2 rounded flex-shrink-0 select-none border border-[#27272a] font-sans truncate max-w-[120px]"
            :title="getEntryProjectName(entry)"
          >
            {{ getEntryProjectName(entry) }}
          </span>

          <!-- Service Name Capsule -->
          <span
            class="text-zinc-200 font-medium text-[11px] bg-[#1a1a22] px-2 py-0.2 rounded-md flex-shrink-0 select-none border border-zinc-700/80 font-sans"
          >
            {{ entry.serviceName }}
          </span>

          <!-- Stream Type Badge (ERR / OUT) -->
          <span
            class="text-[10px] font-bold px-1.5 py-0.2 rounded flex-shrink-0 select-none uppercase font-mono"
            :class="entry.stream === 'stderr' ? 'bg-rose-950 text-rose-300 border border-rose-800' : 'text-zinc-500'"
          >
            {{ entry.stream === 'stderr' ? 'ERR' : 'OUT' }}
          </span>

          <!-- Log Message -->
          <span
            class="flex-1 text-xs font-mono"
            :class="entry.stream === 'stderr' ? 'text-rose-400 font-medium' : 'text-zinc-200'"
          >
            {{ entry.message }}
          </span>

          <!-- Hover Copy Line Button -->
          <button
            type="button"
            class="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-white px-1.5 py-0.5 text-xs rounded transition-opacity flex-shrink-0 select-none bg-[#202028] border border-zinc-700 cursor-pointer shadow-2xs"
            title="复制单行日志"
            @click="copySingleLogLine(entry.message)"
          >
            <IconCopy :size="11" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import { useRoute } from 'vue-router';
import { useRunnerStore } from '../stores/runnerStore.js';
import { useProjectStore } from '../stores/projectStore.js';
import { useThemeStore } from '../stores/themeStore.js';
import { message, dialog } from '../utils/discrete.js';
import {
  IconTerminal,
  IconSearch,
  IconCopy,
  IconDownload,
  IconTrash,
  IconZap,
} from '../components/icons/index.js';
import type { LogEntryDto } from '@codehelm/contracts';

const route = useRoute();
const runnerStore = useRunnerStore();
const projectStore = useProjectStore();
const themeStore = useThemeStore();

const selectedProjectFilter = ref<string>('ALL');
const selectedServiceFilter = ref<string>('ALL');
const selectedStreamFilter = ref<'ALL' | 'stdout' | 'stderr'>('ALL');
const logSearch = ref('');
const showTimestamps = ref(true);
const showLineNumbers = ref(true);
const autoScroll = ref(true);
const isTrashHovered = ref(false);
const logContainerRef = ref<HTMLDivElement | null>(null);

// Initialize filter from query if present (?project=xxx)
watch(
  () => route.query.project,
  (projId) => {
    if (typeof projId === 'string' && projId) {
      selectedProjectFilter.value = projId;
    }
  },
  { immediate: true }
);

function handleSelectProject(projId: string) {
  selectedProjectFilter.value = projId;
  selectedServiceFilter.value = 'ALL';
}

// Mapping serviceSessionId or serviceName or projectId to projectId
const serviceToProjectMap = computed(() => {
  const map = new Map<string, string>();
  for (const s of runnerStore.serviceStatuses.values()) {
    if (s.projectId) {
      if (s.sessionServiceId) map.set(s.sessionServiceId, s.projectId);
      if (s.serviceName) map.set(s.serviceName, s.projectId);
    }
  }
  return map;
});

function getEntryProjectId(entry: LogEntryDto): string | undefined {
  if (entry.serviceSessionId && serviceToProjectMap.value.has(entry.serviceSessionId)) {
    return serviceToProjectMap.value.get(entry.serviceSessionId);
  }
  if (entry.serviceName && serviceToProjectMap.value.has(entry.serviceName)) {
    return serviceToProjectMap.value.get(entry.serviceName);
  }
  return undefined;
}

function getEntryProjectName(entry: LogEntryDto): string {
  const pId = getEntryProjectId(entry);
  if (!pId) return '';
  const p = projectStore.projects.find((x) => x.id === pId);
  return p?.name || '';
}

function getProjectLogCount(projectId: string): number {
  return runnerStore.logs.filter((l) => getEntryProjectId(l) === projectId).length;
}

// Only show projects that are currently started/running or have captured logs
const activeOrLoggedProjects = computed(() => {
  return projectStore.projects.filter((p) => {
    const isRunning = runnerStore.getProjectState(p.id).runningCount > 0;
    const hasLogs = getProjectLogCount(p.id) > 0;
    return isRunning || hasLogs;
  });
});

watch(activeOrLoggedProjects, (list) => {
  if (selectedProjectFilter.value !== 'ALL' && !list.some((p) => p.id === selectedProjectFilter.value)) {
    selectedProjectFilter.value = 'ALL';
  }
});

const isAnyServiceActive = computed(() => {
  if (selectedProjectFilter.value === 'ALL') {
    return runnerStore.runningCount > 0;
  }
  return runnerStore.getProjectState(selectedProjectFilter.value).runningCount > 0;
});

const projectScopedTotalLogs = computed(() => {
  if (selectedProjectFilter.value === 'ALL') return runnerStore.logs.length;
  return getProjectLogCount(selectedProjectFilter.value);
});

function getServiceLogCount(serviceName: string): number {
  return runnerStore.logs.filter((l) => {
    if (selectedProjectFilter.value !== 'ALL') {
      const pId = getEntryProjectId(l);
      if (pId !== selectedProjectFilter.value) return false;
    }
    return l.serviceName === serviceName;
  }).length;
}

const availableServicesForFilter = computed(() => {
  const set = new Set<string>();
  for (const log of runnerStore.logs) {
    if (selectedProjectFilter.value === 'ALL') {
      if (log.serviceName) set.add(log.serviceName);
    } else {
      const pId = getEntryProjectId(log);
      if (pId === selectedProjectFilter.value && log.serviceName) {
        set.add(log.serviceName);
      }
    }
  }

  // Also include services from activeSessions
  for (const session of runnerStore.activeSessions) {
    if (selectedProjectFilter.value === 'ALL' || session.projectId === selectedProjectFilter.value) {
      for (const s of session.services) {
        if (s.serviceName) set.add(s.serviceName);
      }
    }
  }

  // Also include running service statuses
  for (const s of runnerStore.serviceStatuses.values()) {
    if (selectedProjectFilter.value === 'ALL' || s.projectId === selectedProjectFilter.value) {
      if (s.serviceName) set.add(s.serviceName);
    }
  }

  return Array.from(set);
});

const stderrLogsCount = computed(() => {
  return runnerStore.logs.filter((l) => l.stream === 'stderr').length;
});

const filteredStderrCount = computed(() => {
  return filteredLogs.value.filter((l) => l.stream === 'stderr').length;
});

const filteredLogs = computed(() => {
  return runnerStore.logs.filter((log) => {
    // Project filter
    if (selectedProjectFilter.value !== 'ALL') {
      const pId = getEntryProjectId(log);
      if (pId && pId !== selectedProjectFilter.value) return false;
    }

    // Service filter
    if (selectedServiceFilter.value !== 'ALL') {
      if (log.serviceName !== selectedServiceFilter.value) return false;
    }

    // Stream level filter
    if (selectedStreamFilter.value !== 'ALL') {
      if (log.stream !== selectedStreamFilter.value) return false;
    }

    // Keyword search filter
    if (logSearch.value.trim()) {
      const q = logSearch.value.toLowerCase();
      const msg = log.message.toLowerCase();
      const svc = log.serviceName.toLowerCase();
      if (!msg.includes(q) && !svc.includes(q)) return false;
    }

    return true;
  });
});

// Auto-scroll watcher
watch(
  () => filteredLogs.value.length,
  () => {
    if (autoScroll.value) {
      nextTick(() => {
        if (logContainerRef.value) {
          logContainerRef.value.scrollTop = logContainerRef.value.scrollHeight;
        }
      });
    }
  }
);

function copySingleLogLine(text: string) {
  navigator.clipboard.writeText(text);
  message.success('已复制单行日志');
}

function copyAllLogs() {
  if (filteredLogs.value.length === 0) {
    message.warning('当前没有可复制的日志');
    return;
  }
  const text = filteredLogs.value
    .map((e) => {
      const ts = e.timestamp ? `[${new Date(e.timestamp).toLocaleTimeString()}] ` : '';
      const stream = e.stream === 'stderr' ? '[ERR] ' : '';
      return `${ts}[${e.serviceName}] ${stream}${e.message}`;
    })
    .join('\n');
  navigator.clipboard.writeText(text);
  message.success(`已复制 ${filteredLogs.value.length} 条日志到剪贴板`);
}

function exportLogsToFile() {
  if (filteredLogs.value.length === 0) {
    message.warning('当前没有可导出的日志');
    return;
  }
  const text = filteredLogs.value
    .map((e) => {
      const ts = e.timestamp ? `[${new Date(e.timestamp).toISOString()}] ` : '';
      const stream = e.stream === 'stderr' ? '[ERR] ' : '[OUT] ';
      return `${ts}[${e.serviceName}] ${stream}${e.message}`;
    })
    .join('\n');

  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const projName = selectedProjectFilter.value !== 'ALL'
    ? projectStore.projects.find((p) => p.id === selectedProjectFilter.value)?.name || 'project'
    : 'all-projects';
  a.download = `codehelm-console-${projName}-${Date.now()}.log`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  message.success('已导出日志文件');
}

function handleClearLogs() {
  dialog.warning({
    title: '清空控制台日志',
    content: '确定要清空当前所有受管服务的实时历史日志吗？清空后无法撤销。',
    positiveText: '确认清空',
    negativeText: '取消',
    positiveButtonProps: { type: 'error' },
    onPositiveClick: () => {
      runnerStore.clearLogs();
      message.success('控制台日志已清空');
    },
  });
}

onMounted(async () => {
  runnerStore.setupListeners();
  await Promise.all([
    runnerStore.fetchState(),
    projectStore.fetchProjects(),
  ]);
  if (autoScroll.value && logContainerRef.value) {
    logContainerRef.value.scrollTop = logContainerRef.value.scrollHeight;
  }
});
</script>

<style scoped>
.terminal-code-stream {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 12px;
  line-height: 1.6;
}
</style>
