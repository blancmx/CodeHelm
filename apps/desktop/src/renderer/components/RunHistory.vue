<template>
  <section
    id="run-history"
    ref="section"
    tabindex="-1"
    class="border rounded-2xl p-5 flex-shrink-0 transition-colors"
    :class="theme.isDark ? 'border-zinc-700/80 bg-[#121216] text-zinc-200' : 'border-zinc-200 bg-white text-zinc-800'"
  >
    <div class="flex items-center justify-between gap-4">
      <div>
        <h3 class="font-bold text-sm tracking-tight" :class="theme.isDark ? 'text-white' : 'text-zinc-950'">
          {{ projectId ? '本项目运行记录' : '运行历史' }}
        </h3>
        <p class="text-xs text-zinc-500 mt-1 leading-relaxed">
          全部遗留待处理记录及最近 50 次历史。历史 PID 和端口不是实时状态，不提供直接启停。刷新只重新读取记录，不重新核验进程。
        </p>
        <router-link
          v-if="projectId"
          to="/runner#run-history"
          class="inline-flex items-center gap-1.5 mt-2 text-xs font-sans font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200 transition-colors group/link select-none"
        >
          <span class="group-hover/link:underline underline-offset-4 decoration-zinc-400 dark:decoration-zinc-600">查看全部项目记录</span>
          <IconArrowRight :size="12" stroke-width="2" class="transition-transform duration-150 group-hover/link:translate-x-0.5" />
        </router-link>
      </div>

      <!-- Modern Refresh Button with Half-Turn Rotation on Click -->
      <button
        type="button"
        class="group h-8 px-3 rounded-lg border text-xs font-sans font-medium inline-flex items-center gap-1.5 transition-all duration-200 cursor-pointer select-none relative shadow-2xs active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
        :class="theme.isDark
          ? 'bg-[#18181b] hover:bg-[#27272a] text-zinc-200 hover:text-white border-[#27272a] hover:border-zinc-500 hover:shadow-xs'
          : 'bg-white hover:bg-zinc-50 text-zinc-700 hover:text-zinc-950 border-zinc-200 hover:border-zinc-300 hover:shadow-xs'"
        :disabled="runner.stateLoading"
        title="刷新运行历史记录"
        @click="handleRefresh"
      >
        <IconRefresh
          :size="13"
          stroke-width="2"
          class="flex-shrink-0 transition-transform duration-500 ease-[cubic-bezier(0.25,1,0.5,1)] group-hover:scale-110"
          :style="{ transform: `rotate(${refreshRotation}deg)` }"
          :class="theme.isDark ? 'text-zinc-400 group-hover:text-white' : 'text-zinc-500 group-hover:text-zinc-950'"
        />
        <span>{{ runner.stateLoading ? '正在读取…' : '刷新记录' }}</span>
      </button>
    </div>

    <!-- Quick Project Filter Tabs when viewing all projects -->
    <div
      v-if="!projectId && projects.projects.length > 0"
      class="mt-4 pt-3 border-t flex items-center gap-2 overflow-x-auto pb-1 text-xs select-none"
      :class="theme.isDark ? 'border-zinc-800/80' : 'border-zinc-100'"
    >
      <span class="text-zinc-500 flex-shrink-0 text-[11px]">筛选工程：</span>
      <button
        type="button"
        class="px-2.5 py-1 rounded-lg border transition-colors cursor-pointer select-none font-medium text-xs flex-shrink-0"
        :class="selectedProjectFilter === 'ALL'
          ? (theme.isDark ? 'bg-white text-black border-white font-bold' : 'bg-black text-white border-black font-bold')
          : (theme.isDark ? 'bg-[#18181b] text-zinc-400 border-[#27272a] hover:text-white' : 'bg-zinc-100 text-zinc-600 border-zinc-200 hover:text-black')"
        @click="selectedProjectFilter = 'ALL'"
      >
        全部项目 ({{ runner.displayHistory.length }})
      </button>
      <button
        v-for="p in projects.projects"
        :key="p.id"
        type="button"
        class="px-2.5 py-1 rounded-lg border transition-colors cursor-pointer select-none truncate max-w-[160px] text-xs flex-shrink-0"
        :class="selectedProjectFilter === p.id
          ? (theme.isDark ? 'bg-white text-black border-white font-bold' : 'bg-black text-white border-black font-bold')
          : (theme.isDark ? 'bg-[#18181b] text-zinc-400 border-[#27272a] hover:text-white' : 'bg-zinc-100 text-zinc-600 border-zinc-200 hover:text-black')"
        :title="p.name"
        @click="selectedProjectFilter = p.id"
      >
        {{ p.name }}
      </button>
    </div>

    <p v-if="runner.persistenceError" role="alert" class="text-rose-500 mt-3 text-sm">{{ runner.persistenceError }}</p>
    <p v-if="runner.stateError" role="alert" class="text-rose-500 mt-3 text-sm">{{ runner.stateError }}；已有记录可能不是最新状态。</p>
    <p v-if="!runner.stateLoaded" class="text-sm text-zinc-500 py-5">{{ runner.stateLoading ? '正在读取运行记录…' : '运行记录尚未读取成功' }}</p>
    <p v-else-if="sessions.length === 0" class="text-sm text-zinc-500 py-5">暂无符合条件的运行记录。之前版本未保存的会话无法补录。</p>

    <!-- Sessions List with Fluid Accordion Transitions -->
    <div v-else class="divide-y mt-4" :class="theme.isDark ? 'divide-zinc-800' : 'divide-zinc-100'">
      <div
        v-for="session in sessions"
        :key="session.id"
        class="py-3 group/session transition-colors"
      >
        <!-- Summary Header Clickable Row -->
        <div
          class="cursor-pointer text-sm font-sans select-none flex items-center justify-between py-1.5 px-2 -mx-2 rounded-lg hover:bg-zinc-500/10 transition-colors"
          @click="toggleSession(session.id)"
        >
          <div class="flex items-center gap-2.5 min-w-0">
            <!-- Smooth Rotating Chevron Arrow with Spring Easing -->
            <IconChevronRight
              :size="14"
              class="text-zinc-400 transition-transform duration-300 ease-[cubic-bezier(0.25,1,0.5,1)] flex-shrink-0"
              :class="isExpanded(session.id) ? 'rotate-90 text-zinc-700 dark:text-zinc-200' : 'rotate-0'"
            />
            <span class="font-semibold text-xs truncate" :class="theme.isDark ? 'text-white' : 'text-zinc-950'">
              {{ projects.projects.find(p => p.id === session.projectId)?.name || '项目 ' + session.projectId }}
            </span>
            <span
              class="px-2 py-0.5 rounded text-[10px] font-sans font-bold uppercase tracking-wider transition-colors"
              :class="session.status === 'INTERRUPTED'
                ? (theme.isDark ? 'bg-amber-950/40 text-amber-300 border border-amber-800' : 'bg-amber-50 text-amber-800 border border-amber-300')
                : session.status === 'FAILED'
                  ? (theme.isDark ? 'bg-rose-950/40 text-rose-300 border border-rose-800' : 'bg-rose-50 text-rose-800 border border-rose-300')
                  : (theme.isDark ? 'bg-zinc-800 text-zinc-300 border border-zinc-700' : 'bg-zinc-100 text-zinc-700 border border-zinc-200')"
            >
              {{ statusLabels[session.status] || session.status }}
            </span>
          </div>
          <span class="text-xs text-zinc-500 font-sans"><span class="font-mono">{{ formatTime(session.startedAt) }}</span> · <span class="font-mono">{{ session.services.length }}</span> 条服务记录</span>
        </div>

        <!-- Buttery-Smooth CSS Grid Expand & Collapse Container -->
        <div
          class="grid transition-all duration-300 ease-[cubic-bezier(0.25,1,0.5,1)] overflow-hidden"
          :class="isExpanded(session.id) ? 'grid-rows-[1fr] opacity-100 mt-2' : 'grid-rows-[0fr] opacity-0 mt-0 pointer-events-none'"
        >
          <div class="min-h-0 overflow-hidden">
            <p v-if="session.status === 'INTERRUPTED'" class="text-xs text-amber-600 dark:text-amber-400 mb-3 pl-6">
              上次应用退出前未记录完整结束状态。下方仅为启动时核验结果，不会自动接管或结束遗留进程。
            </p>
            <ul class="space-y-3 pl-6 pb-1">
              <li
                v-for="service in session.services"
                :key="service.id"
                class="text-sm border-l-2 pl-3 border-zinc-400 dark:border-zinc-600"
              >
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <strong :class="theme.isDark ? 'text-zinc-200' : 'text-zinc-800'">{{ service.serviceName }}</strong>
                  <span
                    class="px-1.5 py-0.2 rounded text-[10px] font-sans font-bold uppercase"
                    :class="service.status === 'STOPPED' ? 'text-zinc-400' : service.status === 'FAILED' ? 'text-rose-400' : 'text-zinc-300'"
                  >
                    {{ service.status }}
                  </span>
                  <span v-if="service.pid" class="text-zinc-500 text-xs font-sans">记录 PID <span class="font-mono font-medium">{{ service.pid }}</span></span>
                  <span v-if="service.port" class="text-zinc-500 text-xs font-sans">记录端口 <span class="font-mono font-medium">{{ service.port }}</span></span>
                </div>
                <p v-if="service.recovery" class="text-xs mt-1 text-amber-600 dark:text-amber-400">
                  {{ recoveryLabels[service.recovery.outcome] }} · 核验于 {{ formatTime(service.recovery.checkedAt) }}
                </p>
                <p v-if="service.errorMessage" class="text-xs mt-1 text-rose-500 break-words">{{ service.errorMessage }}</p>
                <p class="text-xs mt-1 text-zinc-500 font-sans">
                  结束时间：{{ service.stoppedAt ? formatTime(service.stoppedAt) : '未记录（不等于仍在运行）' }}
                  <span v-if="service.exitCode !== undefined"> · 退出码 {{ service.exitCode }}</span>
                  <span v-if="service.exitSignal"> · 信号 {{ service.exitSignal }}</span>
                </p>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue';
import { useRunnerStore } from '../stores/runnerStore.js';
import { useProjectStore } from '../stores/projectStore.js';
import { useThemeStore } from '../stores/themeStore.js';
import { IconRefresh, IconChevronRight, IconArrowRight } from './icons/index.js';
import { message } from '../utils/discrete.js';

const runner = useRunnerStore();
const projects = useProjectStore();
const theme = useThemeStore();
const props = defineProps<{ projectId?: string; focusRequested?: boolean }>();
const section = ref<HTMLElement>();

const selectedProjectFilter = ref<string>('ALL');
const expandedSessionIds = ref<Set<string>>(new Set());
const refreshRotation = ref(0);

function isExpanded(id: string): boolean {
  return expandedSessionIds.value.has(id);
}

function toggleSession(id: string) {
  const next = new Set(expandedSessionIds.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  expandedSessionIds.value = next;
}

const sessions = computed(() => {
  const targetProj = props.projectId || (selectedProjectFilter.value !== 'ALL' ? selectedProjectFilter.value : undefined);
  return runner.displayHistory.filter(session => !targetProj || session.projectId === targetProj);
});

// Auto-expand orphaned or focus-requested sessions
watch(
  () => sessions.value,
  (list) => {
    const next = new Set(expandedSessionIds.value);
    for (const session of list) {
      if (props.projectId && session.services.some(s => s.status === 'ORPHANED')) {
        next.add(session.id);
      }
    }
    expandedSessionIds.value = next;
  },
  { immediate: true }
);

async function handleRefresh() {
  refreshRotation.value += 180;
  await runner.fetchState();
  if (runner.stateError) {
    message.error(runner.stateError);
  } else {
    message.success('已刷新运行记录');
  }
}

watch(
  () => [props.projectId, props.focusRequested, runner.stateLoaded],
  async () => {
    if (!props.focusRequested || !runner.stateLoaded) return;
    await nextTick();
    section.value?.focus({ preventScroll: true });
  },
  { immediate: true }
);

const statusLabels: Record<string, string> = {
  STOPPED: '已结束',
  FAILED: '失败',
  INTERRUPTED: '中断 · 已核验',
  PARTIAL_FAILED: '部分失败',
};

const recoveryLabels: Record<string, string> = {
  'not-running': '原 PID 当前不存在；不据此判断其子进程状态',
  'identity-match': 'PID 与创建时间匹配，但未接管；请人工检查遗留进程',
  'pid-reused': 'PID 已被其他进程复用，未进行任何控制操作',
  unverified: '无法确认进程身份或缺少指纹，未进行任何控制操作',
};

const formatTime = (value: string) => new Date(value).toLocaleString();
</script>
