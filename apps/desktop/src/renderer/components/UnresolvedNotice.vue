<template>
  <div v-if="count > 0" :class="compact ? 'mt-2' : 'mt-3 rounded-xl border px-4 py-3 flex items-start justify-between gap-4 flex-shrink-0'"
    :style="compact ? undefined : { borderColor: theme.isDark ? '#78350f' : '#fcd34d', background: theme.isDark ? '#271e12' : '#fffbeb' }">
    <div v-if="!compact" class="min-w-0 text-sm" :style="{ color: theme.isDark ? '#fcd34d' : '#92400e' }" role="status">
      <p class="font-semibold">遗留待处理 · {{ count }} 条记录</p>
      <p class="text-xs mt-1 leading-relaxed">上次核验仍有待处理记录，本次未接管；受影响方案不能重复启动。请查看记录，人工核验并关闭遗留进程后重开 CodeHelm。</p>
      <p v-if="runner.stateError" class="text-xs mt-1">读取失败，以上为上次读取的记录；当前状态未知。</p>
    </div>
    <router-link :to="{ path: '/runner', query: { project: projectId }, hash: '#run-history' }"
      class="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium whitespace-nowrap focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 flex-shrink-0"
      :style="{ color: theme.isDark ? '#fcd34d' : '#92400e', borderColor: theme.isDark ? '#78350f' : '#fcd34d' }"
      :aria-label="`查看本项目 ${count} 条遗留待处理记录`" @click.stop>
      {{ compact ? `遗留待处理 · ${count}` : '查看记录' }} <span aria-hidden="true">→</span>
    </router-link>
  </div>
</template>

<script setup lang="ts">
import { useThemeStore } from '../stores/themeStore.js';
import { useRunnerStore } from '../stores/runnerStore.js';
defineProps<{ projectId: string; count: number; compact?: boolean }>();
const theme = useThemeStore();
const runner = useRunnerStore();
</script>
