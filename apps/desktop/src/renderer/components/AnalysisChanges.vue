<template>
  <section class="rounded-xl border border-zinc-500/30 p-4 space-y-3 text-sm" aria-label="分析差异">
    <h3 class="font-semibold">分析差异与方案建议</h3>
    <p>重新分析会保留现有运行方案。查看技术栈、模块和建议命令的变化后，可明确应用到默认检测方案；人工命令和已有环境变量保留。</p>
    <n-button :loading="busy" :disabled="dirty" @click="load">查看分析差异</n-button>
    <p v-if="dirty">请先保存或撤销当前编辑，再查看差异。</p>
    <p v-if="error" role="alert" class="text-rose-500">{{ error }}</p>
    <div v-if="review" class="space-y-3">
      <p>当前分析：{{ new Date(review.currentAt).toLocaleString() }} · {{ review.previousAt ? '与上一次分析比较' : '首次分析，无历史基线' }}</p>
      <p v-if="!review.changes.length">两次分析未发现模块、技术栈或建议命令差异。</p>
      <div v-for="item in review.changes" :key="item.modulePath" class="border-t border-zinc-500/30 pt-2">
        <h4 class="font-semibold break-all">{{ item.modulePath }}</h4>
        <p class="break-all whitespace-pre-wrap">之前：{{ item.before }}</p>
        <p class="break-all whitespace-pre-wrap">现在：{{ item.after }}</p>
      </div>
      <p>应用会更新未手动编辑的检测服务；运行中的进程继续使用原快照，不会自动启动。预览一分钟后过期。</p>
      <n-button v-if="review.canApply" type="primary" :disabled="busy || dirty" @click="apply">确认应用分析建议</n-button>
      <p v-else>当前没有默认检测方案，不修改用户创建的方案。</p>
    </div>
    <p v-if="done" role="status">分析建议已应用，未启动任何进程。</p>
  </section>
</template>
<script setup lang="ts">
import { ref, watch } from 'vue';
import type { AnalysisReviewDto } from '@codehelm/contracts';
const props = defineProps<{ projectId: string; snapshotId?: string; dirty: boolean }>();
const emit = defineEmits<{ applied: [] }>();
const review = ref<AnalysisReviewDto | null>(null), error = ref(''), busy = ref(false), done = ref(false);
let epoch = 0;
watch(() => [props.projectId, props.snapshotId, props.dirty], () => { epoch++; review.value = null; done.value = false; });
async function load() {
  const version = ++epoch;
  busy.value = true; error.value = ''; done.value = false;
  try { const value = await window.codehelm.analysis.review(props.projectId); if (version === epoch) review.value = value; }
  catch { error.value = '无法读取分析差异，请确认分析已成功完成后重试。'; }
  finally { busy.value = false; }
}
async function apply() {
  if (!review.value || props.dirty) return;
  busy.value = true; error.value = '';
  try { await window.codehelm.analysis.apply(props.projectId, review.value.token); review.value = null; done.value = true; emit('applied'); }
  catch { error.value = '应用失败：分析或配置可能已变化，或预览已过期。请重新查看差异。'; review.value = null; }
  finally { busy.value = false; }
}
</script>
