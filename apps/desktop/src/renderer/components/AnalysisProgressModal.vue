<template>
  <n-modal
    v-model:show="visible"
    preset="card"
    title="工程静态技术画像分析"
    class="w-580px max-w-[calc(100vw-40px)] border shadow-2xl transition-colors duration-200"
    :class="themeStore.isDark ? 'bg-[#121216] border-[#27272a] shadow-black/90' : 'bg-white border-zinc-200 shadow-zinc-400/30'"
    :segmented="{ content: 'soft', footer: 'soft' }"
    :mask-closable="false"
    :closable="!busy"
  >
    <div class="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
      <!-- Target Project Info Card -->
      <div
        class="border rounded-xl p-3.5 space-y-1.5 transition-colors"
        :class="themeStore.isDark ? 'bg-[#18181b] border-[#27272a]' : 'bg-zinc-50 border-zinc-200'"
      >
        <div class="flex items-center justify-between gap-3">
          <span class="text-xs font-bold truncate" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
            {{ projectName || '项目工程' }}
          </span>
          <span
            class="text-[10px] font-mono px-2 py-0.5 rounded border flex-shrink-0"
            :class="statusClass"
          >
            {{ presentation.label }}
          </span>
        </div>
        <p v-if="rootPath" class="font-mono text-xs text-zinc-500 break-all">
          {{ rootPath }}
        </p>
      </div>

      <!-- Scanning Progress Section -->
      <div
        class="border rounded-xl p-4 space-y-3 transition-colors"
        :class="themeStore.isDark ? 'bg-[#18181b] border-[#27272a]' : 'bg-zinc-50 border-zinc-200'"
      >
        <!-- Stage Title & Percentage -->
        <div class="flex items-center justify-between text-xs">
          <div class="flex items-center gap-2 min-w-0 flex-1 pr-2">
            <span
              class="w-2.5 h-2.5 rounded-full flex-shrink-0"
              :class="busy ? 'pulsing-dot-active bg-emerald-500' : 'bg-zinc-400'"
            />
            <span class="font-semibold tracking-wide truncate" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
              {{ stage || '正在启动扫描 Worker…' }}
            </span>
          </div>
          <span class="font-mono font-bold flex-shrink-0" :class="themeStore.isDark ? 'text-zinc-200' : 'text-zinc-800'">
            {{ busy ? ((percentage ?? 0) > 0 ? `${percentage}%` : '扫描中') : presentation.label }}
          </span>
        </div>

        <!-- Progress Line -->
        <n-progress
          type="line"
          :percentage="percentage ?? 0"
          :show-indicator="false"
          :processing="busy"
          :status="presentation.tone"
        />

        <!-- Stats details -->
        <div class="flex items-center justify-between text-[11px] text-zinc-500 pt-1">
          <span>已发现文件: <strong class="font-mono" :class="themeStore.isDark ? 'text-zinc-300' : 'text-zinc-700'">{{ scannedFiles ?? 0 }}</strong></span>
          <span v-if="currentFile" class="font-mono truncate max-w-[260px]" :title="currentFile">
            {{ currentFile }}
          </span>
        </div>
      </div>

      <!-- Non-destructive Privacy / Security Notice -->
      <div class="flex items-start gap-2 text-xs text-zinc-500">
        <IconLock :size="14" class="flex-shrink-0 mt-0.5" />
        <p>静态技术画像分析仅在本地建立代码结构索引与框架推断，不修改、不上传源码，不执行任意外部脚本。</p>
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2.5">
        <n-button
          v-if="busy"
          :disabled="!canCancel || isCancelling"
          :loading="isCancelling"
          @click="emit('cancel')"
        >
          {{ isCancelling ? '正在停止…' : '取消分析' }}
        </n-button>
        <n-button v-else @click="visible = false">
          关闭
        </n-button>
      </div>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useThemeStore } from '../stores/themeStore.js';
import { IconLock } from './icons/index.js';
import type { AnalysisTaskDto } from '@codehelm/contracts';
import { getAnalysisPresentation } from '../utils/analysis-presentation.js';

const themeStore = useThemeStore();

const props = defineProps<{
  show: boolean;
  projectName?: string;
  rootPath?: string;
  stage?: string;
  scannedFiles?: number;
  percentage?: number;
  currentFile?: string;
  busy?: boolean;
  status?: AnalysisTaskDto['status'];
  canCancel?: boolean;
  isCancelling?: boolean;
}>();

const presentation = computed(() => getAnalysisPresentation(props.status));
const statusClass = computed(() => {
  const dark = themeStore.isDark;
  if (presentation.value.tone === 'success') return dark ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/30' : 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (presentation.value.tone === 'error') return dark ? 'bg-rose-950/60 text-rose-300 border-rose-500/30' : 'bg-rose-50 text-rose-700 border-rose-200';
  if (presentation.value.tone === 'warning') return dark ? 'bg-amber-950/60 text-amber-300 border-amber-500/30' : 'bg-amber-50 text-amber-700 border-amber-200';
  return dark ? 'bg-[#27272a] text-zinc-300 border-[#3f3f46]' : 'bg-white text-zinc-700 border-zinc-200';
});

const emit = defineEmits<{
  (e: 'update:show', val: boolean): void;
  (e: 'cancel'): void;
}>();

const visible = computed({
  get: () => props.show,
  set: (v) => emit('update:show', v),
});
</script>
