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
            <span class="w-1.5 h-1.5 rounded-full pulsing-dot-active" :class="themeStore.isDark ? 'bg-black' : 'bg-white'" />
            <span>{{ runningProjectGroups.length }} 个运行中项目 · {{ totalActiveServicesCount }} 个服务</span>
          </span>
        </div>
        <p class="text-xs mt-1" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
          按项目集中监控与受控管理本地所有运行中的工程实例、服务子进程与端口映射
        </p>
      </div>

      <n-button
        v-if="runningProjectGroups.length > 0"
        type="error"
        secondary
        size="small"
        class="font-semibold shadow-xs !text-rose-600 dark:!text-rose-400 !border-rose-500/40 hover:!bg-rose-500/10"
        @click="handleStopAll"
      >
        <template #icon>
          <IconSquare :size="14" class="text-rose-600 dark:text-rose-400" />
        </template>
        <span class="text-rose-600 dark:text-rose-400 font-semibold">终止全部活跃服务</span>
      </n-button>
    </header>

    <!-- Main Content Area -->
    <div class="flex-1 overflow-y-auto pt-4 flex flex-col space-y-6">
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
          当前无运行中的工程项目
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
      <div v-else class="space-y-5 pb-6">
        <!-- Project Section Cards -->
        <div
          v-for="proj in runningProjectGroups"
          :key="proj.projectId"
          class="border rounded-2xl p-5 transition-all shadow-sm"
          :class="themeStore.isDark ? 'bg-[#121216] border-[#27272a]' : 'bg-white border-zinc-200'"
        >
          <!-- Project Card Header -->
          <div
            class="flex items-center justify-between pb-3.5 border-b transition-colors flex-wrap gap-3"
            :class="themeStore.isDark ? 'border-[#202028]' : 'border-zinc-100'"
          >
            <!-- Left: Project Info -->
            <div class="flex items-center gap-3 min-w-0">
              <span class="w-2.5 h-2.5 rounded-full pulsing-dot-active flex-shrink-0" :class="themeStore.isDark ? 'bg-white' : 'bg-black'" />
              <div>
                <div class="flex items-center gap-2">
                  <h3
                    class="font-bold text-base hover:underline cursor-pointer tracking-tight"
                    :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'"
                    @click="$router.push(`/projects/${proj.projectId}`)"
                  >
                    {{ proj.projectName }}
                  </h3>
                  <span
                    class="text-[10px] font-medium px-2 py-0.2 rounded-full border"
                    :class="themeStore.isDark ? 'bg-[#18181b] text-zinc-400 border-[#27272a]' : 'bg-zinc-100 text-zinc-600 border-zinc-200'"
                  >
                    {{ proj.services.length }} 个服务运行中
                  </span>
                </div>
                <div class="flex items-center gap-2 mt-1 text-xs text-zinc-400 font-mono">
                  <span class="truncate max-w-400px">{{ proj.projectPath }}</span>
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
              <n-button
                size="small"
                type="error"
                secondary
                class="font-medium text-xs !text-rose-600 dark:!text-rose-400 !border-rose-500/30 hover:!bg-rose-500/10 shadow-2xs"
                @click="handleStopProject(proj)"
              >
                <template #icon>
                  <IconSquare :size="13" class="text-rose-600 dark:text-rose-400" />
                </template>
                停止该项目
              </n-button>
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
                  <div class="flex items-center gap-2 min-w-0">
                    <span class="w-2 h-2 rounded-full pulsing-dot-active flex-shrink-0" :class="themeStore.isDark ? 'bg-white' : 'bg-black'" />
                    <span class="font-bold text-sm truncate" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
                      {{ svc.name }}
                    </span>
                  </div>

                  <span
                    class="border px-2 py-0.2 rounded-md text-[10px] font-mono font-bold flex-shrink-0"
                    :class="themeStore.isDark ? 'bg-white text-black border-white' : 'bg-black text-white border-black'"
                  >
                    {{ svc.status }}
                  </span>
                </div>

                <!-- Process Specs (PID & Port) -->
                <div
                  class="text-xs font-mono space-y-1.5 border rounded-lg p-2.5"
                  :class="themeStore.isDark ? 'bg-[#101014] border-[#27272a] text-zinc-400' : 'bg-white border-zinc-200 text-zinc-600'"
                >
                  <div v-if="svc.pid" class="flex items-center justify-between text-xs">
                    <span class="text-zinc-500">系统 PID:</span>
                    <span class="font-bold" :class="themeStore.isDark ? 'text-zinc-200' : 'text-zinc-800'">{{ svc.pid }}</span>
                  </div>
                  <div v-if="svc.port" class="flex items-center justify-between text-xs">
                    <span class="text-zinc-500">监听端口:</span>
                    <span class="font-bold text-emerald-400">:{{ svc.port }}</span>
                  </div>
                </div>
              </div>

              <!-- Service Action Buttons -->
              <div
                class="flex items-center justify-between gap-2 pt-3 mt-3 border-t"
                :class="themeStore.isDark ? 'border-[#27272a]' : 'border-zinc-200'"
              >
                <!-- Left: Open URL -->
                <div>
                  <n-button
                    v-if="svc.url"
                    size="tiny"
                    type="primary"
                    secondary
                    class="font-medium text-xs shadow-xs"
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
                  <n-button
                    size="tiny"
                    secondary
                    title="重启此服务进程"
                    @click="handleRestartService(svc.sessionServiceId)"
                  >
                    <template #icon>
                      <IconRefresh :size="12" />
                    </template>
                  </n-button>

                  <n-button
                    size="tiny"
                    type="error"
                    secondary
                    class="!text-rose-600 dark:!text-rose-400 !border-rose-500/30 hover:!bg-rose-500/10"
                    title="终止此服务进程"
                    @click="handleStopSingleService(svc.sessionServiceId)"
                  >
                    <template #icon>
                      <IconSquare :size="12" class="text-rose-600 dark:text-rose-400" />
                    </template>
                    <span class="text-rose-600 dark:text-rose-400 font-medium">停止</span>
                  </n-button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { message, dialog } from '../utils/discrete.js';
import { useRunnerStore } from '../stores/runnerStore.js';
import { useProjectStore } from '../stores/projectStore.js';
import { useThemeStore } from '../stores/themeStore.js';
import { setPageTitle } from '../utils/title.js';
import {
  IconZap,
  IconSquare,
  IconExternalLink,
  IconCopy,
  IconRefresh,
} from '../components/icons/index.js';

const runnerStore = useRunnerStore();
const projectStore = useProjectStore();
const themeStore = useThemeStore();

onMounted(async () => {
  if (projectStore.projects.length === 0) {
    await projectStore.fetchProjects();
  }
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
  isBackend?: boolean;
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
    if (val.status === 'RUNNING' || val.status === 'STARTING') {
      const isBackend =
        (val.serviceName || key).toLowerCase().includes('backend') ||
        (val.serviceName || key).toLowerCase().includes('fastapi') ||
        (val.serviceName || key).toLowerCase().includes('api') ||
        (val.serviceName || key).toLowerCase().includes('server');

      const port = val.port;
      const serviceItem: RunningServiceItem = {
        configId: key,
        sessionServiceId: val.sessionServiceId || key,
        name: val.serviceName || key,
        status: val.status,
        pid: val.pid,
        port: val.port,
        url: port ? (isBackend ? `http://localhost:${port}/docs` : `http://localhost:${port}`) : undefined,
        browserLabel: isBackend ? `打开 API 文档 (:${port}/docs)` : `打开前端界面 (:${port})`,
        isBackend,
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

async function handleRestartService(sessionServiceId: string) {
  try {
    message.loading('正在重启服务...');
    await runnerStore.restartService(sessionServiceId);
    message.success('服务已重启');
  } catch (err: any) {
    message.error(err.message || '重启服务失败');
  }
}

async function handleStopSingleService(sessionServiceId: string) {
  try {
    await runnerStore.stopService(sessionServiceId);
    message.success('已终止该服务进程');
  } catch (err: any) {
    message.error(err.message || '终止服务失败');
  }
}

async function handleStopProject(proj: RunningProjectGroup) {
  if (proj.runSessionId) {
    try {
      await runnerStore.stopSession(proj.runSessionId);
      message.success(`已停止项目 ${proj.projectName} 的所有服务`);
    } catch (err: any) {
      message.error(err.message || '停止项目失败');
    }
  } else if (runnerStore.currentSession?.id) {
    await runnerStore.stopSession(runnerStore.currentSession.id);
    message.success(`已停止项目 ${proj.projectName} 的所有服务`);
  }
}

function handleStopAll() {
  dialog.warning({
    title: '确认终止所有服务',
    content: '确定要停止当前所有正在运行的项目和服务子进程吗？',
    positiveText: '确认停止',
    negativeText: '取消',
    onPositiveClick: async () => {
      if (runnerStore.currentSession?.id) {
        await runnerStore.stopSession(runnerStore.currentSession.id);
        message.success('所有服务已停止');
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

