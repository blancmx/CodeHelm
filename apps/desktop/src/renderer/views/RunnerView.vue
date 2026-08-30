<template>
  <div class="flex-1 flex flex-col h-full overflow-hidden p-6 font-sans">
    <!-- Top Header -->
    <header
      class="flex items-center justify-between pb-5 border-b flex-shrink-0 transition-colors duration-200"
      :class="themeStore.isDark ? 'border-[#27272a]' : 'border-zinc-200'"
    >
      <div>
        <div class="flex items-center gap-2.5">
          <h2 class="text-xl font-bold tracking-tight" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
            全局运行中心
          </h2>
          <span
            v-if="runningProjectGroups.length > 0"
            class="text-xs border px-2.5 py-0.5 rounded-full font-sans font-semibold flex items-center gap-1.5"
            :class="themeStore.isDark ? 'bg-white text-black border-white' : 'bg-black text-white border-black'"
          >
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 pulsing-dot-active" />
            <span>{{ runningProjectGroups.length }} 个受管理项目 · {{ totalActiveServicesCount }} 条服务状态</span>
          </span>
        </div>
        <p class="text-xs mt-1" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
          按项目集中监控与受控管理本地所有运行中的工程实例、服务子进程与端口映射
        </p>
      </div>

      <button
        v-if="runningProjectGroups.length > 0"
        type="button"
        class="group h-8 px-3.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 transition-all duration-200 cursor-pointer select-none relative overflow-hidden bg-rose-500/10 hover:bg-rose-500/20 active:scale-[0.96] text-rose-600 dark:text-rose-400 border-rose-500/30 hover:border-rose-500/70 hover:shadow-[0_0_14px_rgba(244,63,94,0.22)]"
        :disabled="isStoppingAll"
        title="停止当前所有受管理的服务与进程"
        @click="handleStopAll"
      >
        <IconRefresh
          v-if="isStoppingAll"
          :size="13"
          stroke-width="2"
          class="animate-refresh-spin text-rose-500"
        />
        <IconSquare
          v-else
          :size="13"
          stroke-width="2"
          class="text-rose-600 dark:text-rose-400 fill-transparent group-hover:fill-current transition-all duration-200 group-hover:scale-90 flex-shrink-0"
        />
        <span>{{ isStoppingAll ? '正在终止服务...' : '终止全部活跃服务' }}</span>
      </button>
    </header>

    <!-- Main Tabs -->
    <div class="flex-1 overflow-hidden pt-3 flex flex-col">
      <n-tabs type="line" animated v-model:value="activeTab" class="h-full flex flex-col">
        <!-- Tab 1: 活跃受管项目 -->
        <n-tab-pane name="active" class="h-full overflow-y-auto pt-2 pb-6 flex flex-col min-h-0">
          <template #tab>
            <div class="flex items-center gap-1.5">
              <span
                v-if="runningProjectGroups.length > 0"
                class="w-1.5 h-1.5 rounded-full bg-emerald-400 pulsing-dot-active flex-shrink-0 -translate-y-[0.5px]"
              />
              <span>活跃受管项目</span>
              <span
                v-if="runningProjectGroups.length > 0"
                class="text-[10px] font-mono opacity-80"
              >
                ({{ runningProjectGroups.length }})
              </span>
            </div>
          </template>

          <!-- Empty State -->
          <div
            v-if="runningProjectGroups.length === 0"
            class="flex-1 flex flex-col items-center justify-center text-center max-w-md mx-auto py-16 my-auto"
          >
            <div
              class="w-16 h-16 rounded-2xl border flex items-center justify-center mb-4 shadow-sm"
              :class="themeStore.isDark ? 'bg-[#18181b] border-[#27272a] text-zinc-300' : 'bg-white border-zinc-200 text-zinc-950'"
            >
              <IconZap :size="28" />
            </div>
            <h3 class="text-base font-bold" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
              {{ runnerStore.stateError ? '当前运行状态读取失败' : !runnerStore.stateLoaded ? '正在读取运行状态' : '当前无受本次应用管理的运行项目' }}
            </h3>
            <p class="text-xs mt-2 leading-relaxed" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
              当您在项目详情页中一键启动服务方案后，这里将按项目分层集中呈现所有正在运行的工程实例、所属服务进程、PID 指纹与快捷访问入口。
            </p>

            <n-button
              type="primary"
              secondary
              size="medium"
              class="mt-6 font-medium"
              @click="$router.push('/')"
            >
              前往项目总览
            </n-button>
          </div>

          <!-- Active Projects & Services Hierarchy List -->
          <div v-else class="space-y-5">
            <!-- Project Section Cards -->
            <div
              v-for="proj in runningProjectGroups"
              :key="proj.projectId"
              class="border rounded-2xl p-5 transition-all shadow-sm"
              :class="themeStore.isDark ? 'bg-[#121216] border-[#27272a]' : 'bg-white border-zinc-200'"
            >
              <!-- Project Header Row -->
              <div
                class="flex items-center justify-between pb-3 border-b transition-colors"
                :class="themeStore.isDark ? 'border-[#20202d]' : 'border-zinc-100'"
              >
                <!-- Left: Project Name & Path Info -->
                <div class="flex items-center gap-3">
                  <span
                    class="w-2.5 h-2.5 rounded-full bg-emerald-400 pulsing-dot-active flex-shrink-0"
                    title="项目受管中"
                  />
                  <div>
                    <div class="flex items-center gap-2.5">
                      <router-link
                        :to="`/projects/${proj.projectId}`"
                        class="text-sm font-bold hover:underline cursor-pointer flex items-center gap-1.5"
                        :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'"
                      >
                        {{ proj.projectName }}
                        <IconExternalLink :size="12" class="opacity-60" />
                      </router-link>
                      <span
                        class="text-[10px] font-medium px-2 py-0.5 rounded border"
                        :class="themeStore.isDark ? 'bg-[#18181b] text-emerald-300 border-emerald-500/30' : 'bg-emerald-50 text-emerald-700 border-emerald-200'"
                      >
                        {{ proj.services.length }} 个活跃服务
                      </span>
                    </div>
                    <div class="flex items-center gap-1.5 mt-1 text-[11px] text-zinc-500 font-mono">
                      <span class="truncate max-w-[480px]" :title="proj.projectPath">{{ proj.projectPath }}</span>
                      <button
                        type="button"
                        class="text-zinc-500 hover:text-zinc-200 cursor-pointer"
                        title="复制路径"
                        @click="copyText(proj.projectPath)"
                      >
                        <IconCopy :size="12" />
                      </button>
                    </div>
                  </div>
                </div>

                <!-- Right: Project-level Actions -->
                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    class="group h-7 px-3 rounded-md border text-xs font-semibold inline-flex items-center gap-1.5 transition-all duration-200 cursor-pointer select-none relative overflow-hidden bg-rose-500/10 hover:bg-rose-500/20 active:scale-[0.96] text-rose-600 dark:text-rose-400 border-rose-500/30 hover:border-rose-500/70 hover:shadow-[0_0_12px_rgba(244,63,94,0.2)]"
                    :disabled="stoppingProjectIds.has(proj.projectId)"
                    title="停止该项目下的所有服务"
                    @click="handleStopProject(proj)"
                  >
                    <IconRefresh
                      v-if="stoppingProjectIds.has(proj.projectId)"
                      :size="12"
                      stroke-width="2"
                      class="animate-refresh-spin text-rose-500"
                    />
                    <IconSquare
                      v-else
                      :size="12"
                      stroke-width="2"
                      class="text-rose-600 dark:text-rose-400 fill-transparent group-hover:fill-current transition-all duration-200 group-hover:scale-90 flex-shrink-0"
                    />
                    <span>{{ stoppingProjectIds.has(proj.projectId) ? '正在停止...' : '停止该项目' }}</span>
                  </button>
                </div>
              </div>

              <!-- Services Grid Under This Project -->
              <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 mt-4">
                <div
                  v-for="svc in proj.services"
                  :key="svc.configId"
                  class="border rounded-xl p-4 flex flex-col justify-between transition-all"
                  :class="themeStore.isDark
                    ? 'bg-[#18181c] hover:bg-[#1f1f25] border-[#27272a] hover:border-zinc-600 shadow-sm'
                    : 'bg-zinc-50 hover:bg-zinc-100 border-zinc-200 hover:border-zinc-300 shadow-sm'"
                >
                  <div>
                    <!-- Service Title & Status Badge -->
                    <div class="flex items-center justify-between mb-2.5">
                      <span class="text-xs font-bold truncate max-w-[160px]" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
                        {{ svc.name }}
                      </span>
                      <span
                        class="text-[10px] font-mono px-1.5 py-0.5 rounded border font-medium flex items-center gap-1 leading-none"
                        :class="themeStore.isDark ? 'bg-white text-black border-white font-bold' : 'bg-black text-white border-black font-bold'"
                      >
                        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 pulsing-dot-active flex-shrink-0 -translate-y-[0.5px]" />
                        <span>RUNNING</span>
                      </span>
                    </div>

                    <!-- Process & Network Meta Info -->
                    <div class="space-y-1.5 text-xs">
                      <div v-if="svc.pid" class="flex items-center justify-between text-zinc-500">
                        <span>进程 PID</span>
                        <span class="font-mono" :class="themeStore.isDark ? 'text-zinc-300' : 'text-zinc-700'">{{ svc.pid }}</span>
                      </div>
                      <div v-if="svc.port" class="flex items-center justify-between text-zinc-500">
                        <span>监听端口</span>
                        <span class="font-mono text-emerald-600 dark:text-emerald-400 font-bold">:{{ svc.port }}</span>
                      </div>
                      <div v-if="svc.url" class="flex items-center justify-between text-zinc-500">
                        <span>访问地址</span>
                        <a
                          :href="svc.url"
                          target="_blank"
                          class="font-mono text-xs text-blue-500 hover:underline truncate max-w-[160px]"
                        >
                          {{ svc.url }}
                        </a>
                      </div>
                    </div>
                  </div>

                  <!-- Service Bottom Actions -->
                  <div
                    class="flex items-center justify-between pt-3 mt-3 border-t transition-colors"
                    :class="themeStore.isDark ? 'border-[#27272a]' : 'border-zinc-200'"
                  >
                    <!-- Left: Open Browser Shortcut -->
                    <div>
                      <n-button
                        v-if="svc.url"
                        size="tiny"
                        type="primary"
                        secondary
                        @click="openBrowser(svc.url)"
                      >
                        <template #icon>
                          <IconExternalLink :size="12" />
                        </template>
                        {{ svc.browserLabel }}
                      </n-button>
                    </div>

                    <!-- Right: Restart & Stop Service -->
                    <div class="flex items-center gap-1.5">
                      <button
                        type="button"
                        class="w-6 h-6 rounded-md flex items-center justify-center border transition-all duration-200 cursor-pointer select-none relative"
                        :class="[
                          restartingServiceIds.has(svc.sessionServiceId)
                            ? (themeStore.isDark ? 'bg-[#27272a] text-white border-zinc-500 ring-2 ring-white/20' : 'bg-zinc-100 text-zinc-950 border-zinc-400 ring-2 ring-black/10')
                            : (themeStore.isDark
                                ? 'bg-[#18181c] hover:bg-[#27272a] text-zinc-300 hover:text-white border-[#27272a] active:scale-95'
                                : 'bg-white hover:bg-zinc-100 text-zinc-700 hover:text-zinc-950 border-zinc-200 shadow-2xs active:scale-95')
                        ]"
                        :disabled="restartingServiceIds.has(svc.sessionServiceId)"
                        title="重启此服务进程"
                        @click="handleRestartService(svc.sessionServiceId)"
                      >
                        <IconRefresh
                          :size="12"
                          :stroke-width="2"
                          :class="restartingServiceIds.has(svc.sessionServiceId) ? 'animate-refresh-spin' : ''"
                        />
                      </button>

                      <button
                        type="button"
                        class="group h-6 px-2.5 rounded-md border text-[11px] font-semibold inline-flex items-center gap-1 transition-all duration-200 cursor-pointer select-none relative overflow-hidden bg-rose-500/10 hover:bg-rose-500/20 active:scale-[0.95] text-rose-600 dark:text-rose-400 border-rose-500/30 hover:border-rose-500/70 hover:shadow-[0_0_10px_rgba(244,63,94,0.2)]"
                        :disabled="stoppingServiceIds.has(svc.sessionServiceId)"
                        title="终止此服务进程"
                        @click="handleStopSingleService(svc.sessionServiceId)"
                      >
                        <IconRefresh
                          v-if="stoppingServiceIds.has(svc.sessionServiceId)"
                          :size="11"
                          stroke-width="2"
                          class="animate-refresh-spin text-rose-500"
                        />
                        <IconSquare
                          v-else
                          :size="11"
                          stroke-width="2"
                          class="text-rose-600 dark:text-rose-400 fill-transparent group-hover:fill-current transition-all duration-200 group-hover:scale-90 flex-shrink-0"
                        />
                        <span>{{ stoppingServiceIds.has(svc.sessionServiceId) ? '停止中' : '停止' }}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </n-tab-pane>

        <!-- Tab 2: 历史记录 -->
        <n-tab-pane name="history" class="h-full overflow-y-auto pt-2 pb-6 flex flex-col min-h-0">
          <template #tab>
            <div class="flex items-center gap-1.5">
              <span>历史记录</span>
              <span
                v-if="runnerStore.displayHistory.length > 0"
                class="text-[10px] font-mono opacity-80"
              >
                ({{ runnerStore.displayHistory.length }})
              </span>
            </div>
          </template>

          <RunHistory
            :project-id="typeof route.query.project === 'string' ? route.query.project : undefined"
            :focus-requested="route.hash === '#run-history'"
          />
        </n-tab-pane>
      </n-tabs>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import RunHistory from '../components/RunHistory.vue';
import { message, dialog } from '../utils/discrete.js';
import { useRunnerStore } from '../stores/runnerStore.js';
import { useProjectStore } from '../stores/projectStore.js';
import { useThemeStore } from '../stores/themeStore.js';
import { setPageTitle } from '../utils/title.js';
import { getServiceEndpoint } from '../utils/service-endpoints.js';
import {
  IconZap,
  IconSquare,
  IconExternalLink,
  IconCopy,
  IconRefresh,
} from '../components/icons/index.js';

const router = useRouter();
const runnerStore = useRunnerStore();
const route = useRoute();
const projectStore = useProjectStore();
const themeStore = useThemeStore();
const activeTab = ref<'active' | 'history'>((route.hash === '#run-history' || route.query.tab === 'history' || typeof route.query.project === 'string') ? 'history' : 'active');

watch(activeTab, (newTab) => {
  const currentTab = (route.hash === '#run-history' || route.query.tab === 'history' || typeof route.query.project === 'string') ? 'history' : 'active';
  if (newTab !== currentTab) {
    const query = { ...route.query };
    if (newTab === 'active') {
      delete query.tab;
    } else {
      query.tab = 'history';
    }
    void router.push({ path: route.path, query });
  }
});

watch(
  () => [route.hash, route.query.tab, route.query.project],
  () => {
    if (route.hash === '#run-history' || route.query.tab === 'history' || typeof route.query.project === 'string') {
      if (activeTab.value !== 'history') activeTab.value = 'history';
    } else {
      if (activeTab.value !== 'active') activeTab.value = 'active';
    }
  },
  { immediate: true }
);

onMounted(async () => {
  runnerStore.setupListeners();
  await runnerStore.fetchState();
  if (projectStore.projects.length === 0) {
    await projectStore.fetchProjects();
  }
});

const refreshTimer = setInterval(() => { void runnerStore.fetchState(); }, 4000);
onUnmounted(() => {
  clearInterval(refreshTimer);
});

interface RunningServiceItem {
  configId: string;
  sessionServiceId: string;
  name: string;
  status: string;
  pid?: number;
  port?: number;
  url?: string;
  browserLabel?: string;
}

interface RunningProjectGroup {
  projectId: string;
  projectName: string;
  projectPath: string;
  runSessionId?: string;
  tags?: string[];
  services: RunningServiceItem[];
}

const runningProjectGroups = computed<RunningProjectGroup[]>(() => {
  const groupsMap = new Map<string, RunningProjectGroup>();

  runnerStore.serviceStatuses.forEach((val, key) => {
    if (['RUNNING', 'STARTING', 'DEGRADED', 'STOPPING', 'ORPHANED'].includes(val.status)) {
      const sessionService = runnerStore.activeSessions
        .find(session => session.id === val.runSessionId)?.services
        .find(service => service.id === val.sessionServiceId);
      const endpoint = getServiceEndpoint({
        id: key, name: val.serviceName || key, type: sessionService?.serviceType,
      }, val);
      const serviceItem: RunningServiceItem = {
        configId: key,
        sessionServiceId: val.sessionServiceId || key,
        name: val.serviceName || key,
        status: val.status,
        pid: val.pid,
        port: val.port,
        url: endpoint?.canOpen ? endpoint.url : undefined,
        browserLabel: endpoint ? `${endpoint.actionLabel} (:${endpoint.port})` : undefined,
      };

      // Determine the project for this service strictly by its own projectId
      const projId = val.projectId || 'unassigned';
      const projObj = projectStore.projects.find((p) => p.id === projId);

      const projectName = projObj?.name || (val.serviceName ? `${val.serviceName}` : '运行中项目');
      const projectPath = projObj?.rootPath || '';
      const runSessionId = val.runSessionId;

      if (!groupsMap.has(projId)) {
        groupsMap.set(projId, {
          projectId: projId,
          projectName,
          projectPath,
          runSessionId,
          tags: projObj?.tags || [],
          services: [],
        });
      }

      groupsMap.get(projId)!.services.push(serviceItem);
    }
  });

  return Array.from(groupsMap.values());
});

const totalActiveServicesCount = computed(() => {
  return runningProjectGroups.value.reduce((acc, g) => acc + g.services.length, 0);
});

function openBrowser(urlOrPort: string | number) {
  const url = typeof urlOrPort === 'number' ? `http://localhost:${urlOrPort}` : urlOrPort;
  window.open(url, '_blank');
}

function copyText(text: string) {
  navigator.clipboard.writeText(text);
  message.success('已复制到剪贴板');
}

const restartingServiceIds = ref<Set<string>>(new Set());

async function handleRestartService(sessionServiceId: string) {
  try {
    restartingServiceIds.value.add(sessionServiceId);
    message.loading('正在重启服务...');
    await runnerStore.restartService(sessionServiceId);
    message.success('服务已重启');
  } catch (err: any) {
    message.error(err.message || '重启服务失败');
  } finally {
    setTimeout(() => {
      restartingServiceIds.value.delete(sessionServiceId);
    }, 650);
  }
}

const isStoppingAll = ref(false);
const stoppingProjectIds = ref<Set<string>>(new Set());
const stoppingServiceIds = ref<Set<string>>(new Set());

async function handleStopSingleService(sessionServiceId: string) {
  try {
    stoppingServiceIds.value.add(sessionServiceId);
    await runnerStore.stopService(sessionServiceId);
    message.success('已终止该服务进程');
  } catch (err: any) {
    message.error(err.message || '终止服务失败');
  } finally {
    setTimeout(() => {
      stoppingServiceIds.value.delete(sessionServiceId);
    }, 400);
  }
}

async function handleStopProject(proj: RunningProjectGroup) {
  try {
    stoppingProjectIds.value.add(proj.projectId);
    const sessions = runnerStore.activeSessions.filter(s => s.projectId === proj.projectId);
    const results = await Promise.allSettled(sessions.map(s => runnerStore.stopSession(s.id)));
    if (results.some(result => result.status === 'rejected')) throw new Error('部分会话未确认停止，请刷新查看。');
    message.success(`已停止项目 ${proj.projectName} 的所有服务`);
  } catch (err: any) {
    message.error(err.message || '停止项目失败');
  } finally {
    setTimeout(() => {
      stoppingProjectIds.value.delete(proj.projectId);
    }, 400);
  }
}

function handleStopAll() {
  dialog.warning({
    title: '确认终止所有服务',
    content: '确定要停止当前所有正在运行的项目和服务子进程吗？',
    positiveText: '确认停止',
    negativeText: '取消',
    positiveButtonProps: {
      type: 'error',
    },
    onPositiveClick: async () => {
      try {
        isStoppingAll.value = true;
        const results = await Promise.allSettled(runnerStore.activeSessions.map(s => runnerStore.stopSession(s.id)));
        if (results.some(result => result.status === 'rejected')) message.error('部分会话未确认停止，请查看记录。');
        else message.success('所有受本次应用管理的服务已停止');
      } finally {
        setTimeout(() => {
          isStoppingAll.value = false;
        }, 400);
      }
    },
  });
}

watch(
  () => totalActiveServicesCount.value,
  (count) => {
    if (count > 0) {
      setPageTitle(`全局运行中心 (${count} 运行中)`);
    } else {
      setPageTitle('全局运行中心');
    }
  },
  { immediate: true }
);
</script>

<style scoped>
.tab-fade-enter-active,
.tab-fade-leave-active {
  transition: opacity 0.18s ease, transform 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

.tab-fade-enter-from {
  opacity: 0;
  transform: translateY(4px);
}

.tab-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@keyframes refresh-spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

.animate-refresh-spin {
  animation: refresh-spin 650ms cubic-bezier(0.4, 0, 0.2, 1) infinite;
}
</style>
