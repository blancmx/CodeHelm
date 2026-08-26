<template>
  <div class="flex-1 flex flex-col h-full overflow-hidden p-6">
    <!-- Top Header -->
    <header
      class="flex items-center justify-between pb-5 border-b flex-shrink-0 transition-colors duration-200"
      :class="themeStore.isDark ? 'border-[#27272a]' : 'border-zinc-200'"
    >
      <div>
        <div class="flex items-center gap-2">
          <h2 class="text-xl font-bold tracking-tight" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
            全局运行中心
          </h2>
          <span
            v-if="runningServices.length > 0"
            class="text-xs border px-2 py-0.5 rounded-full font-mono font-medium flex items-center gap-1.5"
            :class="themeStore.isDark ? 'bg-white text-black border-white font-bold' : 'bg-black text-white border-black font-bold'"
          >
            <span class="w-1.5 h-1.5 rounded-full pulsing-dot-active" :class="themeStore.isDark ? 'bg-black' : 'bg-white'" />
            <span>{{ runningServices.length }} 个活跃进程</span>
          </span>
        </div>
        <p class="text-xs mt-1" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
          集中监控与受控管理本地所有运行中的服务进程与端口
        </p>
      </div>

      <n-button
        v-if="runningServices.length > 0"
        type="error"
        secondary
        size="small"
        class="font-semibold shadow-sm !text-rose-600 dark:!text-rose-400 !border-rose-500/40 hover:!bg-rose-500/10"
        @click="handleStopAll"
      >
        <template #icon>
          <IconSquare :size="14" class="text-rose-600 dark:text-rose-400" />
        </template>
        <span class="text-rose-600 dark:text-rose-400 font-semibold">终止全部活跃服务</span>
      </n-button>
    </header>

    <!-- Main Content Area -->
    <div class="flex-1 overflow-y-auto pt-4 flex flex-col">
      <!-- Empty State -->
      <div
        v-if="runningServices.length === 0"
        class="flex-1 flex flex-col items-center justify-center text-center max-w-md mx-auto py-12 my-auto"
      >
        <div
          class="w-16 h-16 rounded-2xl border flex items-center justify-center mb-4 shadow-sm"
          :class="themeStore.isDark ? 'bg-[#18181b] border-[#27272a] text-white' : 'bg-white border-zinc-200 text-zinc-950'"
        >
          <IconZap :size="28" />
        </div>
        <h3 class="text-base font-bold" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
          当前无运行中的服务
        </h3>
        <p class="text-xs mt-2 leading-relaxed" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
          当您在项目详情页中一键启动服务方案后，这里将集中展示所有实时运行进程、PID 指纹、监听端口与跨服务聚合日志流。
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

      <!-- Active Services Grid -->
      <div v-else class="space-y-6 pb-6">
        <!-- Service Cards Grid -->
        <div>
          <h3 class="text-xs font-bold uppercase tracking-wider mb-3" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
            活动服务列表 ({{ runningServices.length }})
          </h3>

          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            <div
              v-for="item in runningServices"
              :key="item.configId"
              class="border rounded-xl p-4.5 flex flex-col justify-between transition-all"
              :class="themeStore.isDark
                ? 'bg-[#121216] hover:bg-[#18181c] border-[#27272a] hover:border-zinc-500 shadow-sm'
                : 'bg-white hover:bg-zinc-50 border-zinc-200 hover:border-zinc-400 shadow-sm'"
            >
              <div>
                <div class="flex items-center justify-between mb-2.5">
                  <div class="flex items-center gap-2.5 min-w-0">
                    <span class="w-2.5 h-2.5 rounded-full pulsing-dot-active flex-shrink-0" :class="themeStore.isDark ? 'bg-white' : 'bg-black'" />
                    <span class="font-bold text-sm truncate" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
                      {{ item.name || item.configId }}
                    </span>
                  </div>

                  <span
                    class="border px-2 py-0.2 rounded-full text-[10px] font-mono font-medium flex-shrink-0"
                    :class="themeStore.isDark ? 'bg-white text-black border-white font-bold' : 'bg-black text-white border-black font-bold'"
                  >
                    {{ item.status }}
                  </span>
                </div>

                <div
                  class="text-xs font-mono space-y-1.5 border rounded-lg p-3"
                  :class="themeStore.isDark ? 'bg-[#18181b] border-[#27272a] text-zinc-400' : 'bg-zinc-50 border-zinc-200 text-zinc-600'"
                >
                  <div v-if="item.pid" class="flex items-center justify-between">
                    <span class="text-[11px]" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-400'">系统 PID:</span>
                    <span class="font-bold" :class="themeStore.isDark ? 'text-zinc-200' : 'text-zinc-800'">{{ item.pid }}</span>
                  </div>
                  <div v-if="item.port" class="flex items-center justify-between">
                    <span class="text-[11px]" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-400'">网络端口:</span>
                    <span class="font-bold" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">:{{ item.port }}</span>
                  </div>
                </div>
              </div>

              <!-- Card Actions -->
              <div
                class="flex items-center justify-end gap-2 pt-3.5 mt-3.5 border-t"
                :class="themeStore.isDark ? 'border-[#1f1f23]' : 'border-zinc-100'"
              >
                <n-button
                  v-if="item.url"
                  size="tiny"
                  type="default"
                  secondary
                  @click="openBrowser(item.url)"
                >
                  <template #icon>
                    <IconExternalLink :size="12" />
                  </template>
                  {{ item.browserLabel }}
                </n-button>
                <n-button
                  size="tiny"
                  type="error"
                  secondary
                  class="!text-rose-600 dark:!text-rose-400 !border-rose-500/30 hover:!bg-rose-500/10"
                  @click="handleStopService(item.sessionServiceId)"
                >
                  <template #icon>
                    <IconSquare :size="12" class="text-rose-600 dark:text-rose-400" />
                  </template>
                  <span class="text-rose-600 dark:text-rose-400 font-medium">停止进程</span>
                </n-button>
              </div>
            </div>
          </div>
        </div>

        <!-- Global Aggregated Log Stream -->
        <div class="bg-[#09090b] border border-[#27272a] rounded-xl overflow-hidden shadow-inner">
          <div class="h-10 px-4 bg-[#121216] border-b border-[#27272a] flex items-center justify-between">
            <span class="text-xs font-mono font-bold text-zinc-300 flex items-center gap-1.5">
              <IconTerminal :size="14" class="text-zinc-400" />
              <span>跨项目聚合日志流 (最近 200 条)</span>
            </span>

            <n-button size="tiny" quaternary type="error" @click="runnerStore.clearLogs">
              <template #icon>
                <IconTrash :size="12" />
              </template>
              清屏
            </n-button>
          </div>

          <div class="h-64 overflow-y-auto p-3 font-mono text-xs space-y-1 select-text">
            <div v-if="runnerStore.logs.length === 0" class="text-zinc-600 text-center py-16">
              暂无运行日志输出...
            </div>
            <div
              v-for="(entry, idx) in runnerStore.logs.slice(-200)"
              :key="idx"
              class="break-all flex items-start gap-2 hover:bg-[#18181b] px-1 py-0.2 rounded"
            >
              <span class="text-zinc-500 text-[10px] select-none flex-shrink-0">
                {{ entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '' }}
              </span>
              <span class="text-zinc-200 font-semibold text-[10px] bg-zinc-800 px-1 rounded flex-shrink-0 select-none border border-zinc-700">
                [{{ entry.serviceName }}]
              </span>
              <span
                class="flex-1"
                :class="entry.stream === 'stderr' ? 'text-rose-400' : 'text-zinc-300'"
              >
                {{ entry.message }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import { message, dialog } from '../utils/discrete.js';
import { useRunnerStore } from '../stores/runnerStore.js';
import { useThemeStore } from '../stores/themeStore.js';
import { setPageTitle } from '../utils/title.js';
import {
  IconZap,
  IconSquare,
  IconExternalLink,
  IconTerminal,
  IconTrash,
} from '../components/icons/index.js';

const runnerStore = useRunnerStore();
const themeStore = useThemeStore();

const runningServices = computed(() => {
  const list: Array<{
    configId: string;
    sessionServiceId: string;
    name: string;
    status: string;
    pid?: number;
    port?: number;
    url?: string;
    browserLabel?: string;
  }> = [];

  runnerStore.serviceStatuses.forEach((val, key) => {
    if (val.status === 'RUNNING' || val.status === 'STARTING') {
      const isBackend = (val.serviceName || key).toLowerCase().includes('backend') || (val.serviceName || key).toLowerCase().includes('fastapi') || (val.serviceName || key).toLowerCase().includes('api');
      const port = val.port;
      list.push({
        configId: key,
        sessionServiceId: val.sessionServiceId || key,
        name: val.serviceName || key,
        status: val.status,
        pid: val.pid,
        port: val.port,
        url: port ? (isBackend ? `http://localhost:${port}/docs` : `http://localhost:${port}`) : undefined,
        browserLabel: isBackend ? '打开 API 文档 (/docs)' : '打开前端网页',
      });
    }
  });

  return list;
});

function openBrowser(urlOrPort: string | number) {
  const url = typeof urlOrPort === 'number' ? `http://localhost:${urlOrPort}` : urlOrPort;
  window.open(url, '_blank');
}

async function handleStopService(sessionServiceId: string) {
  try {
    await runnerStore.stopService(sessionServiceId);
    message.success('已终止该服务进程');
  } catch (err: any) {
    message.error(err.message || '终止服务失败');
  }
}

function handleStopAll() {
  dialog.warning({
    title: '确认终止所有服务',
    content: '确定要停止当前所有正在运行的服务子进程吗？',
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
  () => runningServices.value.length,
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
