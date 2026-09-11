<template>
  <n-button size="small" @click="open = true">修复项目路径</n-button>
  <n-modal v-model:show="open" preset="card" title="修复项目路径" style="width: min(672px, calc(100vw - 32px)); max-height: calc(100vh - 64px); overflow: auto" :mask-closable="!busy" :closable="!busy">
    <p class="mb-3">请选择移动后的项目目录。绑定前会核对清单和运行配置目录；不会执行项目脚本。</p>
    <p class="text-xs break-all mb-3">原位置：{{ project.rootPath }}</p>
    <label class="block">新位置<n-input v-model:value="newPath" :disabled="busy" :input-props="{'aria-label':'新项目路径'}" /></label>
    <div class="flex gap-3 my-3">
      <n-button :disabled="busy" @click="choose">选择目录</n-button>
      <n-button :loading="busy" :disabled="!newPath.trim()" @click="inspect">核对新位置</n-button>
    </div>
    <p v-if="error" role="alert" class="text-red-500 my-3 break-all">{{ error }}</p>
    <div v-if="preview" class="space-y-3">
      <p class="break-all">将绑定到：{{ preview.newPath }}</p>
      <p class="text-xs">已核验配置目录：{{ preview.directories.join('、') }}</p>
      <ul class="max-h-48 overflow-auto text-xs space-y-2">
        <li v-for="file in preview.manifests" :key="file.path"><strong>{{ file.path }}</strong><code class="block break-all">SHA-256 {{ file.sha256 }}</code></li>
      </ul>
      <p>请确认这些清单属于原项目。绑定后会重新分析，原运行方案保留，启动前必须重新确认授权；历史记录保留原路径。</p>
      <n-checkbox v-model:checked="confirmed" :disabled="busy">我已核对，这是原项目的新位置</n-checkbox>
      <div class="flex justify-end gap-3">
        <n-button :disabled="busy" @click="open=false">取消</n-button>
        <n-button type="primary" :loading="busy" :disabled="!confirmed" @click="commit">确认绑定并重新分析</n-button>
      </div>
    </div>
  </n-modal>
</template>
<script setup lang="ts">
import { ref, watch } from 'vue';
import type { ProjectDto, RelocationPreview } from '@codehelm/contracts';
const props = defineProps<{project: ProjectDto}>();
const emit = defineEmits<{relocated: []}>();
const open = ref(false), busy = ref(false), confirmed = ref(false);
const newPath = ref(''), error = ref('');
const preview = ref<RelocationPreview | null>(null);
watch([newPath, open], () => { preview.value = null; confirmed.value = false; error.value = ''; });
async function choose() {
  try { const selected = await window.codehelm.projects.selectDirectory(); if (selected) newPath.value = selected.path; }
  catch (err) { error.value = String(err); }
}
async function inspect() {
  busy.value = true; error.value = ''; preview.value = null; confirmed.value = false;
  try { preview.value = await window.codehelm.projects.previewRelocation(props.project.id, newPath.value.trim()); }
  catch (err) { error.value = err instanceof Error ? err.message : String(err); }
  finally { busy.value = false; }
}
async function commit() {
  if (!preview.value || !confirmed.value) return;
  busy.value = true; error.value = '';
  try { await window.codehelm.projects.relocate(props.project.id, preview.value.token); open.value = false; emit('relocated'); }
  catch (err) { error.value = err instanceof Error ? err.message : String(err); preview.value = null; confirmed.value = false; }
  finally { busy.value = false; }
}
</script>
