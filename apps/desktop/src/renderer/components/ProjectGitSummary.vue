<template>
  <section class="border rounded-xl p-4" :class="theme.isDark ? 'bg-[#121216] border-[#27272a] text-zinc-200' : 'bg-white border-zinc-200 text-zinc-800'" aria-label="本地 Git 状态" :aria-busy="busy">
    <div class="flex items-center justify-between gap-3">
      <h3 class="font-semibold text-sm">本地 Git 状态</h3>
      <n-button size="small" :loading="busy" :disabled="busy" @click="refresh">刷新 Git 状态</n-button>
    </div>
    <p v-if="busy" role="status" class="mt-3 text-sm">正在读取本地仓库…</p>
    <template v-else-if="summary?.status === 'ready'">
      <dl class="git-fields mt-3 text-sm">
        <dt>分支</dt><dd>{{ summary.detached ? '分离 HEAD' : summary.branch }}{{ summary.unborn ? '（尚无提交）' : '' }}</dd>
        <dt>未提交</dt><dd>{{ summary.changedFiles }} 个路径 <span class="text-xs">· 已暂存 {{ summary.stagedFiles }} · 未暂存 {{ summary.unstagedFiles }} · 未跟踪 {{ summary.untrackedFiles }} · 冲突 {{ summary.conflictedFiles }}</span></dd>
        <dt>最近提交</dt><dd>{{ summary.latestCommit ? `${summary.latestCommit.hash.slice(0, 8)} · ${summary.latestCommit.subject}` : '尚无提交' }}</dd>
        <dt>仓库根目录</dt><dd>{{ summary.repositoryRoot }}</dd>
      </dl>
      <p class="mt-2 text-xs">统计整个仓库；同一路径可同时已暂存和未暂存。重命名按删除和新增分别计数，子模块内部变化不统计。</p>
      <p class="mt-1 text-xs">使用仓库内忽略规则，不加载机器级 Git 配置与全局忽略规则。</p>
    </template>
    <p v-else role="status" class="mt-3 text-sm">{{ summary?.message || 'Git 状态未知。' }}</p>
    <p class="mt-3 text-xs">{{ summary ? `查询时间：${new Date(summary.checkedAt).toLocaleString()}。` : '' }}仅本地快照，不访问远端；工作区后续修改需手动刷新。</p>
  </section>
</template>
<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import type { GitSummaryDto } from '@codehelm/contracts';
import { useThemeStore } from '../stores/themeStore.js';
const props = defineProps<{ projectId: string; rootPath: string }>();
const theme = useThemeStore();
const summary = ref<GitSummaryDto>(), busy = ref(false);
let generation = 0;
async function refresh() {
  const request = ++generation; busy.value = true; summary.value = undefined;
  try {
    const result = await window.codehelm.projects.gitSummary(props.projectId);
    if (request === generation) summary.value = result;
  } catch {
    if (request === generation) summary.value = { status: 'unknown', checkedAt: new Date().toISOString(), message: 'Git 状态暂不可用，请稍后刷新。' };
  } finally { if (request === generation) busy.value = false; }
}
watch(() => [props.projectId, props.rootPath], refresh, { immediate: true });
onBeforeUnmount(() => { generation++; });
</script>
<style scoped>
.git-fields { display: grid; grid-template-columns: 6em minmax(0, 1fr); gap: 8px 12px; line-height: 1.6; }
dd { overflow-wrap: anywhere; }
</style>
