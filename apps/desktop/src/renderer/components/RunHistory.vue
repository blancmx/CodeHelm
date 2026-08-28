<template>
  <section id="run-history" ref="section" tabindex="-1" class="border rounded-2xl p-5 flex-shrink-0" :class="theme.isDark ? 'border-zinc-700 bg-[#121216] text-zinc-200' : 'border-zinc-200 bg-white text-zinc-800'">
    <div class="flex items-center justify-between gap-3">
      <div>
        <h3 class="font-semibold text-base">{{ projectId ? '本项目运行记录' : '运行历史' }}</h3>
        <p class="text-xs text-zinc-500 mt-1">全部遗留待处理记录及最近 50 次历史。历史 PID 和端口不是实时状态，不提供直接启停。刷新只重新读取记录，不重新核验进程。</p>
        <router-link v-if="projectId" to="/runner#run-history" class="inline-block mt-2 text-xs underline">查看全部项目记录</router-link>
      </div>
      <button class="border rounded-lg px-3 py-1.5 text-sm disabled:opacity-50" :disabled="runner.stateLoading" @click="runner.fetchState()">刷新记录</button>
    </div>
    <p v-if="runner.persistenceError" role="alert" class="text-rose-500 mt-3 text-sm">{{ runner.persistenceError }}</p>
    <p v-if="runner.stateError" role="alert" class="text-rose-500 mt-3 text-sm">{{ runner.stateError }}；已有记录可能不是最新状态。</p>
    <p v-if="!runner.stateLoaded" class="text-sm text-zinc-500 py-5">{{ runner.stateLoading ? '正在读取运行记录…' : '运行记录尚未读取成功' }}</p>
    <p v-else-if="sessions.length === 0" class="text-sm text-zinc-500 py-5">暂无符合条件的运行记录。之前版本未保存的会话无法补录。</p>
    <div v-else class="divide-y mt-4" :class="theme.isDark ? 'divide-zinc-800' : 'divide-zinc-100'">
      <details v-for="session in sessions" :key="session.id" :open="!!projectId && session.services.some(s => s.status === 'ORPHANED')" class="py-3">
        <summary class="cursor-pointer text-sm">
          <span class="font-semibold">{{ projects.projects.find(p => p.id === session.projectId)?.name || '项目 ' + session.projectId }}</span>
          <span class="ml-3" :class="session.status === 'INTERRUPTED' ? 'text-amber-600' : 'text-zinc-500'">{{ statusLabels[session.status] || session.status }}</span>
          <span class="ml-3 text-xs text-zinc-500">{{ formatTime(session.startedAt) }} · {{ session.services.length }} 条服务记录</span>
        </summary>
        <p v-if="session.status === 'INTERRUPTED'" class="text-xs text-amber-600 mt-3">上次应用退出前未记录完整结束状态。下方仅为启动时核验结果，不会自动接管或结束遗留进程。</p>
        <ul class="mt-3 space-y-3">
          <li v-for="service in session.services" :key="service.id" class="text-sm border-l-2 pl-3 border-zinc-400">
            <div class="flex flex-wrap gap-x-3 gap-y-1"><strong>{{ service.serviceName }}</strong><span>{{ service.status }}</span><span v-if="service.pid" class="text-zinc-500">记录 PID {{ service.pid }}</span><span v-if="service.port" class="text-zinc-500">记录端口 {{ service.port }}</span></div>
            <p v-if="service.recovery" class="text-xs mt-1 text-amber-600">{{ recoveryLabels[service.recovery.outcome] }} · 核验于 {{ formatTime(service.recovery.checkedAt) }}</p>
            <p v-if="service.errorMessage" class="text-xs mt-1 text-rose-500 break-words">{{ service.errorMessage }}</p>
            <p class="text-xs mt-1 text-zinc-500">结束时间：{{ service.stoppedAt ? formatTime(service.stoppedAt) : '未记录（不等于仍在运行）' }}<span v-if="service.exitCode !== undefined"> · 退出码 {{ service.exitCode }}</span><span v-if="service.exitSignal"> · 信号 {{ service.exitSignal }}</span></p>
          </li>
        </ul>
      </details>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue';
import { useRunnerStore } from '../stores/runnerStore.js';
import { useProjectStore } from '../stores/projectStore.js';
import { useThemeStore } from '../stores/themeStore.js';
const runner = useRunnerStore();
const projects = useProjectStore();
const theme = useThemeStore();
const props = defineProps<{ projectId?: string; focusRequested?: boolean }>();
const section = ref<HTMLElement>();
const sessions = computed(() => runner.displayHistory.filter(session => !props.projectId || session.projectId === props.projectId));
watch(() => [props.projectId, props.focusRequested, runner.stateLoaded], async () => {
  if (!props.focusRequested || !runner.stateLoaded) return;
  await nextTick();
  section.value?.scrollIntoView({ block: 'start' });
  section.value?.focus({ preventScroll: true });
}, { immediate: true });
const statusLabels: Record<string, string> = { STOPPED: '已结束', FAILED: '失败', INTERRUPTED: '中断 · 已核验', PARTIAL_FAILED: '部分失败' };
const recoveryLabels = {
  'not-running': '原 PID 当前不存在；不据此判断其子进程状态',
  'identity-match': 'PID 与创建时间匹配，但未接管；请人工检查遗留进程',
  'pid-reused': 'PID 已被其他进程复用，未进行任何控制操作',
  unverified: '无法确认进程身份或缺少指纹，未进行任何控制操作',
};
const formatTime = (value: string) => new Date(value).toLocaleString();
</script>
