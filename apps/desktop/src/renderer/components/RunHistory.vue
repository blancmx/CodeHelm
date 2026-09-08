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
          分页查询已保存会话，每页 20 次。历史 PID 和端口不是实时状态，不提供直接启停。刷新只重新读取记录，不重新核验进程。
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

    <form class="history-filters" @submit.prevent="searchHistory">
      <label>方案名称<input v-model="profileFilter" aria-label="历史方案名称" maxlength="100" /></label>
      <label>服务名称<input v-model="serviceFilter" aria-label="历史服务名称" maxlength="100" /></label>
      <label>会话状态<select v-model="statusFilter" aria-label="历史会话状态"><option value="">全部状态</option><option v-for="(label,status) in statusLabels" :key="status" :value="status">{{ label }}</option></select></label>
      <label>开始时间下限<input v-model="fromFilter" type="datetime-local" aria-label="会话开始时间下限" /></label>
      <label>开始时间上限<input v-model="toFilter" type="datetime-local" aria-label="会话开始时间上限" /></label>
      <n-button size="small" attr-type="submit" :loading="historyLoading">检索会话</n-button>
    </form>
    <p v-if="historyError" role="alert" class="text-rose-500 mt-3 text-sm">{{ historyError }}</p>
    <p v-if="runner.persistenceError" role="alert" class="text-rose-500 mt-3 text-sm">{{ runner.persistenceError }}</p>
    <p v-if="runner.stateError" role="alert" class="text-rose-500 mt-3 text-sm">{{ runner.stateError }}；已有记录可能不是最新状态。</p>
    <p v-if="historyLoading" class="text-sm text-zinc-500 py-5">正在读取运行记录…</p>
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
              class="px-2 py-0.5 rounded text-[11px] font-sans font-bold uppercase tracking-wider transition-colors leading-none"
              :class="session.status === 'INTERRUPTED'
                ? (theme.isDark ? 'bg-amber-950/40 text-amber-300 border border-amber-800' : 'bg-amber-50 text-amber-800 border border-amber-300')
                : session.status === 'FAILED'
                  ? (theme.isDark ? 'bg-rose-950/40 text-rose-300 border border-rose-800' : 'bg-rose-50 text-rose-800 border border-rose-300')
                  : (theme.isDark ? 'bg-zinc-800 text-zinc-300 border border-zinc-700' : 'bg-zinc-100 text-zinc-700 border border-zinc-200')"
            >
              {{ statusLabels[session.status] || session.status }}
            </span>
          </div>
          <span class="text-xs text-zinc-500 font-sans"><span class="font-mono">{{ session.profileName || '旧版方案记录' }} · {{ formatTime(session.startedAt) }}</span> · <span class="font-mono">{{ session.services.length }}</span> 条服务记录</span>
        </div>

        <!-- Buttery-Smooth CSS Grid Expand & Collapse Container -->
        <div
          class="grid transition-all duration-300 ease-[cubic-bezier(0.25,1,0.5,1)] overflow-hidden"
          :class="isExpanded(session.id) ? 'grid-rows-[1fr] opacity-100 mt-2' : 'grid-rows-[0fr] opacity-0 mt-0 pointer-events-none'"
        >
          <div class="min-h-0 overflow-hidden">
            <p v-if="session.servicesTruncated" role="status" class="text-xs my-2 text-amber-600">本次会话共 {{ session.serviceCount }} 条服务记录，此处仅显示前 200 条；会话日志仍可查询全部服务的已保存输出。</p>
            <p class="text-xs my-2">会话开始：{{ formatTime(session.startedAt) }} · 会话结束：{{ session.stoppedAt ? formatTime(session.stoppedAt) : '未知（未记录）' }} · 配置保存时间：{{ session.profileUpdatedAt ? formatTime(session.profileUpdatedAt) : '未知（旧版未记录）' }}</p>
            <n-button size="small" class="mb-2" @click="openLogs(session)">查看会话日志</n-button>
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
                    class="px-1.5 py-0.5 rounded text-[11px] font-sans font-bold uppercase leading-none"
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
                <p v-if="failureGuidance(service)" class="text-xs mt-2 break-words">处理建议：{{ failureGuidance(service) }}</p>
                <router-link v-if="failureGuidance(service)" :to="{ path: `/projects/${session.projectId}`, query: { tab: 'environment' } }" class="inline-block mt-2 text-xs underline">检查此项目运行环境</router-link>
                <p class="text-xs mt-1 text-zinc-500 font-sans">
                  结束时间：{{ service.stoppedAt ? formatTime(service.stoppedAt) : '未记录（不等于仍在运行）' }}
                  <span> · 退出码 {{ service.exitCode ?? '未知（未记录）' }}</span>
                  <span v-if="service.exitSignal"> · 信号 {{ service.exitSignal }}</span>
                </p>
                <n-button size="tiny" class="mt-2" @click="openLogs(session,service.id)">查看此服务日志</n-button>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
    <div class="flex items-center gap-3 mt-3">
      <n-button size="small" :disabled="historyLoading || cursorIndex===0" @click="previousHistory">上一页会话</n-button>
      <span class="text-xs">会话页 {{ cursorIndex+1 }} · {{ sessions.length }} 条</span>
      <n-button size="small" :disabled="historyLoading || !historyPage.nextCursor" @click="nextHistory">下一页会话</n-button>
    </div>
    <StoredLogs :run="logRun" :service-id="logService" @close="logRun=null" />
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue';
import { useRunnerStore } from '../stores/runnerStore.js';
import { useProjectStore } from '../stores/projectStore.js';
import { useThemeStore } from '../stores/themeStore.js';
import { IconRefresh, IconChevronRight, IconArrowRight } from './icons/index.js';
import { message } from '../utils/discrete.js';
import { failureGuidance } from '../utils/failure-guidance.js';
import StoredLogs from './StoredLogs.vue';
import type { HistoryQuery, HistoryPage, RunSessionDto } from '@codehelm/contracts';
import { displayIpcError } from '../utils/ipc-error.js';

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

const profileFilter=ref(''),serviceFilter=ref(''),statusFilter=ref(''),fromFilter=ref(''),toFilter=ref('');
const historyLoading=ref(false),historyError=ref('');
const historyPage=ref<HistoryPage>({sessions:[]});
const cursors=ref<Array<HistoryQuery['cursor']>>([undefined]),cursorIndex=ref(0);
const appliedFilters=ref<HistoryQuery>({limit:20});
const sessions=computed(()=>historyPage.value.sessions);
const logRun=ref<RunSessionDto|null>(null),logService=ref<string>();
let historyRevision=0;
function openLogs(run:RunSessionDto,serviceId?:string) { logService.value=serviceId; logRun.value=run; }
async function loadHistory() {
  const request=++historyRevision;historyLoading.value=true;historyError.value='';
  try {
    const page=await window.codehelm.runner.queryHistory(JSON.parse(JSON.stringify({...appliedFilters.value,cursor:cursors.value[cursorIndex.value]})));
    if(request===historyRevision) historyPage.value=page;
  } catch(error) { if(request===historyRevision) historyError.value=displayIpcError(error,'历史读取失败'); }
  finally { if(request===historyRevision) historyLoading.value=false; }
}
async function searchHistory() {
  try {
    appliedFilters.value={limit:20,projectId:props.projectId||(selectedProjectFilter.value==='ALL'?undefined:selectedProjectFilter.value),
      profileName:profileFilter.value||undefined,serviceName:serviceFilter.value||undefined,status:(statusFilter.value||undefined) as HistoryQuery['status'],
      from:fromFilter.value?new Date(fromFilter.value).toISOString():undefined,to:toFilter.value?new Date(toFilter.value).toISOString():undefined};
    cursorIndex.value=0;cursors.value=[undefined]; await loadHistory();
  } catch(error) { historyError.value=displayIpcError(error,'时间范围无效'); }
}
async function nextHistory() { if(historyPage.value.nextCursor) { cursors.value[++cursorIndex.value]=historyPage.value.nextCursor;await loadHistory(); } }
async function previousHistory() { if(cursorIndex.value>0) { cursorIndex.value--;await loadHistory(); } }
watch(()=>[props.projectId,selectedProjectFilter.value],()=>{void searchHistory();},{immediate:true});

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
  await searchHistory();
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
  STARTING: '启动中（记录状态）', RUNNING: '运行中（记录状态）', STOPPING: '停止中（记录状态）',
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

const formatTime = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : '未知（未记录）';
</script>

<style scoped>
.history-filters { display:flex; flex-wrap:wrap; align-items:end; gap:10px; margin-top:16px; }
.history-filters label { display:flex; flex-direction:column; gap:4px; font-size:12px; }
.history-filters input,.history-filters select { background:transparent; border:1px solid #71717a; border-radius:6px; padding:5px 8px; max-width:185px; }
.history-filters input { color-scheme:dark; }
:global(.light) .history-filters input { color-scheme:light; }
.history-filters select option { color:#18181b; }
</style>
