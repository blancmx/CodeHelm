<template>
  <section class="bundle-panel" :class="{ 'is-dark': themeStore.isDark }" aria-label="脱敏诊断包">
    <h3>脱敏诊断包</h3>
    <p>选择一个运行会话和最多 7 天的日志范围，检查脱敏后的条目，再保存为本地 JSON 诊断包。不会自动上传。</p>
    <div class="bundle-fields">
      <label>运行会话
        <select v-model="sessionId" :disabled="busy" aria-label="诊断包运行会话">
          <option value="">请选择会话</option>
          <option v-for="run in sessions" :key="run.id" :value="run.id">{{ run.startedAt }} · {{ run.profileName || '已删除方案' }} · {{ run.status }}</option>
        </select>
      </label>
      <label>日志开始时间<input v-model="from" type="datetime-local" :disabled="busy" aria-label="诊断包开始时间" /></label>
      <label>日志结束时间<input v-model="to" type="datetime-local" :disabled="busy" aria-label="诊断包结束时间" /></label>
    </div>
    <div class="bundle-actions">
      <n-button size="small" :disabled="busy" @click="loadSessions(false)">刷新最近会话</n-button>
      <n-button v-if="cursor" size="small" :disabled="busy" @click="loadSessions(true)">加载更早会话</n-button>
      <n-button type="primary" size="small" :loading="busy && !saving" :disabled="busy || !validRange || !sessionId" @click="prepare">生成诊断包预览</n-button>
      <n-button v-if="busy || preview" size="small" :disabled="saving" @click="cancel">取消诊断包</n-button>
    </div>
    <p v-if="!validRange" role="alert">请选择起始时间不晚于结束时间、且不超过 7 天的范围。</p>
    <p v-if="error" role="alert" class="bundle-error">{{ error }}</p>
    <p v-if="feedback" role="status">{{ feedback }}</p>
    <div v-if="preview" class="bundle-preview">
      <h4>诊断包预览</h4>
      <p>{{ preview.entries.length }} 项 · 最大 {{ Math.ceil(preview.bytes / 1024) }} KiB · 预览 5 分钟内有效</p>
      <p>默认排除源码、数据库原件、命令参数、环境变量字段、项目与服务名称。当前方案诊断不是故障发生时的历史诊断。</p>
      <ul><li v-for="warning in preview.warnings" :key="warning">{{ warning }}</li></ul>
      <div class="bundle-actions">
        <n-button size="small" :disabled="saving" @click="selected = []">取消全选</n-button>
        <n-button size="small" :disabled="saving" @click="selected = preview.entries.map(entry => entry.id)">全选条目</n-button>
      </div>
      <div class="bundle-entries">
        <div v-for="entry in preview.entries" :key="entry.id" class="bundle-entry">
          <label><input v-model="selected" type="checkbox" :value="entry.id" :disabled="saving" :aria-label="'包含' + entry.label" />{{ entry.label }}</label>
          <details><summary>查看{{ entry.label }}</summary><pre>{{ entry.content }}</pre></details>
        </div>
      </div>
      <label class="bundle-consent"><input v-model="reviewed" type="checkbox" :disabled="saving" />我已检查所选条目，了解自定义敏感文本可能未被识别</label>
      <n-button type="primary" size="small" :loading="saving" :disabled="busy || !reviewed || !selected.length" @click="save">保存诊断包（{{ selected.length }} 项）</n-button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { DiagnosticBundlePreview, HistoryPage, RunSessionDto } from '@codehelm/contracts';
import { useThemeStore } from '../stores/themeStore.js';
const themeStore = useThemeStore();

const localTime = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const sessionId = ref(''), from = ref(localTime(new Date(Date.now() - 86400_000))), to = ref(localTime(new Date(Date.now() + 60000)));
const sessions = ref<RunSessionDto[]>([]), cursor = ref<HistoryPage['nextCursor']>();
const busy = ref(false), saving = ref(false), reviewed = ref(false), error = ref(''), feedback = ref('');
const preview = ref<DiagnosticBundlePreview>(), selected = ref<string[]>([]);
let generation = 0, disposed = false;
const validRange = computed(() => {
  const duration = Date.parse(to.value) - Date.parse(from.value);
  return Number.isFinite(duration) && duration >= 0 && duration <= 7 * 86400_000;
});
async function cancel() {
  generation++; preview.value = undefined; selected.value = []; reviewed.value = false;
  feedback.value = '已取消，未导出诊断包。';
  try { await window.codehelm.diagnosticBundle.cancel(); }
  catch { error.value = '取消请求未送达；本页不会自动导出，请重新打开设置后重试。'; }
}
watch([sessionId, from, to], () => { if (preview.value) void cancel(); reviewed.value = false; });
watch(selected, () => { reviewed.value = false; }, { deep: true });
async function loadSessions(more: boolean) {
  busy.value = true; error.value = '';
  try {
    const result = await window.codehelm.runner.queryHistory({ limit: 50, ...(more && cursor.value ? { cursor: cursor.value } : {}) });
    if (disposed) return;
    sessions.value = more ? [...sessions.value, ...result.sessions] : result.sessions;
    cursor.value = result.nextCursor;
    if (!sessions.value.some(run => run.id === sessionId.value)) sessionId.value = '';
    feedback.value = sessions.value.length ? '' : '暂无运行会话。请在项目运行后生成诊断包。';
  } catch { error.value = '无法读取运行会话，请刷新重试。'; }
  finally { busy.value = false; }
}
async function prepare() {
  if (busy.value || !validRange.value || !sessionId.value) return;
  const current = ++generation; busy.value = true; error.value = ''; feedback.value = ''; preview.value = undefined;
  try {
    const result = await window.codehelm.diagnosticBundle.preview({ runSessionId: sessionId.value,
      from: new Date(from.value).toISOString(), to: new Date(to.value).toISOString() });
    if (disposed || current !== generation) return;
    preview.value = result; selected.value = result.entries.map(entry => entry.id); reviewed.value = false;
  } catch { if (current === generation) error.value = '预览未完成。请检查会话、缩小范围后重试；读取任务取消后可能需要稍候。'; }
  finally { busy.value = false; }
}
async function save() {
  if (!preview.value || !reviewed.value || !selected.value.length || busy.value) return;
  busy.value = true; saving.value = true; error.value = '';
  try {
    const saved = await window.codehelm.diagnosticBundle.export(preview.value.token, [...selected.value]);
    feedback.value = saved ? '诊断包已保存到本地，未上传。' : '已取消保存，未导出诊断包。';
    if (saved) preview.value = undefined;
  } catch { error.value = '保存失败或预览已过期，请重新生成预览后重试。'; }
  finally { busy.value = false; saving.value = false; }
}
onMounted(() => { void loadSessions(false); });
onUnmounted(() => { disposed = true; generation++; void window.codehelm.diagnosticBundle.cancel().catch(() => undefined); });
</script>

<style scoped>
.bundle-panel { border: 1px solid var(--border-color, #71717a); border-radius: 12px; padding: 20px; color: var(--text-primary); font-size: 13px; }
h3, h4 { font-weight: 700; margin-bottom: 8px; }
p, ul { margin: 8px 0; line-height: 1.6; }
ul { list-style: disc; padding-left: 20px; }
.bundle-fields, .bundle-actions { display: flex; flex-wrap: wrap; gap: 12px; margin: 12px 0; }
.bundle-fields label { display: flex; flex-direction: column; gap: 4px; min-width: 180px; max-width: 100%; }
select, input[type="datetime-local"] { background: var(--bg-secondary, transparent); color: inherit; border: 1px solid #71717a; padding: 6px; border-radius: 6px; max-width: 100%; }
.bundle-panel.is-dark select, .bundle-panel.is-dark input[type="datetime-local"] { color-scheme: dark; }
.bundle-entries { max-height: 360px; overflow-y: auto; margin: 12px 0; }
.bundle-entry { border-top: 1px solid #71717a; padding: 10px 0; }
.bundle-entry label, .bundle-consent { display: flex; align-items: center; gap: 8px; padding: 5px 0; }
summary { cursor: pointer; padding: 4px 0; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; padding: 8px; }
.bundle-error { color: #dc2626; }
input:focus-visible, select:focus-visible, summary:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
</style>
