<template>
  <n-button size="small" :disabled="disabled" @click="open">导入 / 导出模板</n-button>
  <n-modal v-model:show="show" preset="card" title="运行配置模板" class="transfer-modal" :mask-closable="!busy" :close-on-esc="!busy" :closable="!busy" :style="{ width: 'min(720px, calc(100vw - 32px))' }">
    <div class="transfer-body">
      <p>导出保留服务结构和变量名称。参数、变量值及就绪检查文本均以占位符代替；模板不包含运行历史或执行授权。</p>
      <div class="transfer-actions">
        <n-button :disabled="busy || !selectedId" @click="exportCurrent">导出当前方案</n-button>
        <n-button :disabled="busy" @click="useExample">使用 Node 通用模板</n-button>
        <label class="file-label">读取 JSON 文件 <input aria-label="读取 JSON 文件" type="file" accept=".json,application/json" :disabled="busy" @change="readFile" /></label>
      </div>
      <label for="template-json">模板 JSON（最多 256 KiB）</label>
      <n-input v-model:value="text" type="textarea" :disabled="busy" :input-props="{ id: 'template-json', 'aria-label': '模板 JSON' }" :autosize="{ minRows: 5, maxRows: 10 }" />
      <div class="transfer-actions">
        <n-button :disabled="busy || !text" @click="inspect">校验模板</n-button>
        <n-button :disabled="busy || !exported || text !== exported" @click="download">保存脱敏 JSON 文件</n-button>
      </div>
      <template v-if="inspection">
        <label for="import-profile-name">新方案名称</label>
        <n-input v-model:value="name" :disabled="busy" :maxlength="100" :input-props="{ id: 'import-profile-name', 'aria-label': '导入方案名称' }" />
        <p v-if="inspection.variables.length">请补齐以下变量。输入只用于本次导入，不写回导出文件；秘密值仍按方案设置加密保存。</p>
        <div v-for="variable in inspection.variables" :key="variable" class="variable-row">
          <label :for="`transfer-${variable}`">{{ variable }}</label>
          <n-input v-model:value="values[variable]" type="password" show-password-on="click" :disabled="busy" :input-props="{ id: `transfer-${variable}`, 'aria-label': variable, autocomplete: 'off' }" />
        </div>
        <n-button :disabled="busy || !complete" @click="previewImport">预览新方案</n-button>
      </template>
      <section v-if="preview" aria-label="导入差异预览">
        <h3>新增「{{ preview.name }}」到「{{ preview.projectName }}」</h3>
        <p>已有 {{ preview.existingNames.length }} 个方案保持原样，新增 {{ preview.services.length }} 个服务，重新生成服务标识及依赖关联。</p>
        <ul>
          <li v-for="(service, index) in preview.services" :key="index">
            {{ service.name }} · {{ service.executable }} · {{ service.argumentCount }} 个参数 · 目录 {{ service.cwdRelative }}
            <div>参数模板：{{ JSON.stringify(service.argumentsPreview) }}；就绪检查：{{ service.readiness }}</div>
            <div>依赖：{{ service.dependencyNames.join('、') || '无' }}；变量：{{ service.variableNames.join('、') || '无' }}</div>
          </li>
        </ul>
        <p>保存仅创建新方案，不启动服务或安装依赖；首次运行必须重新确认执行内容。</p>
        <n-checkbox v-model:checked="confirmed" :disabled="busy">已核对目标项目与新增服务</n-checkbox>
        <n-button type="primary" :disabled="busy || !confirmed" :loading="busy" @click="commit">确认导入为新方案</n-button>
      </section>
      <p v-if="error" ref="errorElement" role="alert" tabindex="-1" class="text-rose-500">{{ error }}</p>
      <p v-if="saved" role="status">脱敏模板已保存。</p>
    </div>
  </n-modal>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { PROFILE_TRANSFER_MAX_BYTES, type ProfileTemplateInspection, type ProfileImportPreview } from '@codehelm/contracts';
import { displayIpcError } from '../utils/ipc-error.js';
const props = defineProps<{ projectId: string; selectedId?: string; disabled: boolean }>();
const emit = defineEmits<{ changed: [id: string] }>();
const show = ref(false), busy = ref(false), text = ref(''), name = ref(''), exported = ref(''), error = ref('');
const values = ref<Record<string, string>>({}), inspection = ref<ProfileTemplateInspection>(), preview = ref<ProfileImportPreview>();
const confirmed = ref(false), errorElement = ref<HTMLElement>();
const saved = ref(false);
const complete = computed(() => name.value.trim() && inspection.value?.variables.every(key => values.value[key]?.trim()));
watch(text, () => { inspection.value = undefined; values.value = {}; preview.value = undefined; confirmed.value = false; }, { flush: 'sync' });
watch([name, values], () => { preview.value = undefined; confirmed.value = false; }, { deep: true, flush: 'sync' });
watch(show, visible => { if (!visible) { values.value = {}; preview.value = undefined; text.value = ''; exported.value = ''; } });
watch(() => props.projectId, () => { show.value = false; });
function open() { error.value = ''; saved.value = false; show.value = true; }
async function act(work: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true; error.value = '';
  try { await work(); } catch (err) { error.value = displayIpcError(err, '模板操作失败'); await nextTick(); errorElement.value?.focus(); }
  finally { busy.value = false; }
}
async function exportCurrent() { await act(async () => { text.value = await window.codehelm.profiles.exportTemplate(props.selectedId!); exported.value = text.value; }); }
async function download() { await act(async () => { saved.value = await window.codehelm.profiles.saveTemplateFile(props.selectedId!); }); }
async function readFile(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0];
  if (!file) return;
  await act(async () => { if (file.size > PROFILE_TRANSFER_MAX_BYTES) throw new Error('模板不得超过 256 KiB。'); text.value = await file.text(); });
  input.value = '';
}
async function inspect() { await act(async () => {
  preview.value = undefined;
  inspection.value = await window.codehelm.profiles.inspectTemplate(text.value);
  name.value = `${inspection.value.template.name} 导入`.slice(0, 100);
  values.value = Object.fromEntries(inspection.value.variables.map(key => [key, '']));
}); }
async function previewImport() { await act(async () => {
  preview.value = undefined; confirmed.value = false;
  preview.value = await window.codehelm.profiles.previewImport({ projectId: props.projectId, name: name.value, text: text.value, values: { ...values.value } });
}); }
async function commit() { await act(async () => {
  const profile = await window.codehelm.profiles.importTemplate(preview.value!.token);
  show.value = false; emit('changed', profile.id);
}); }
function useExample() {
  text.value = JSON.stringify({ format: 'codehelm.run-profile', version: 1, name: 'Node 服务模板', failurePolicy: 'block_dependents', services: [{
    id: 'app', name: '应用', type: 'backend', moduleRelativePath: '.', executable: 'node', args: ['{{ENTRY_FILE}}'], cwdRelative: '.', env: [],
    dependsOn: [], enabled: true, healthCheck: { type: 'none' },
  }] }, null, 2);
}
</script>

<style scoped>
.transfer-body { max-height: calc(100vh - 180px); overflow-y: auto; display: flex; flex-direction: column; gap: 12px; line-height: 1.65; }
.transfer-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.file-label { display: flex; flex-wrap: wrap; gap: 8px; }
.file-label input { max-width: 100%; }
.variable-row { display: grid; gap: 4px; overflow-wrap: anywhere; }
li { margin: 8px 0; overflow-wrap: anywhere; }
section { display: flex; flex-direction: column; gap: 10px; }
</style>
