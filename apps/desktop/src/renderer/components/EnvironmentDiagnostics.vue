<template>
  <section aria-labelledby="environment-diagnostics-title" class="space-y-4 py-3">
    <n-card size="small">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="min-w-0 flex-1">
          <h3 id="environment-diagnostics-title" class="text-base font-semibold">运行环境检查</h3>
          <p class="text-sm mt-2 opacity-80">检查已保存方案的目录、命令和配置引用、必需变量、包管理器声明、端口和依赖线索。不会执行项目脚本或安装依赖。</p>
          <p class="text-sm mt-2 opacity-80">启动前和安装完成后重新检查。版本检查需先选择可信运行时；已有证据会核对文件摘要和当前声明。依赖完整性仍需实际启动验证。</p>
        </div>
        <n-button type="primary" secondary :loading="busy" :disabled="!profile || dirty || busy" @click="run">
          {{ report ? '重新检查运行环境' : '检查运行环境' }}
        </n-button>
      </div>
    </n-card>
    <n-card size="small" title="单次运行时版本检查">
      <p class="text-sm mb-3">选择并确认可信的本机程序后检查版本，匹配方案中显式配置的运行时路径。Node 核对服务目录 package.json 的 engines.node；Python 核对 pyproject.toml 的 project.requires-python。</p>
      <div class="flex flex-wrap items-center gap-3">
        <label for="runtime-family" class="text-sm font-medium" :class="themeStore.isDark ? 'text-zinc-300' : 'text-zinc-700'">运行时</label>
        <n-select
          id="runtime-family-select"
          v-model:value="runtimeFamily"
          :options="runtimeOptions"
          :disabled="runtimeBusy"
          size="small"
          class="!w-36"
        />
        <select
          id="runtime-family"
          v-model="runtimeFamily"
          :disabled="runtimeBusy"
          class="hidden-accessible-select"
          tabindex="-1"
          aria-label="运行时"
        >
          <option value="node">Node.js</option>
          <option value="python">Python</option>
          <option value="java">Java</option>
        </select>
        <n-button size="small" :loading="runtimeBusy" :disabled="!profile || dirty || runtimeBusy" @click="probeRuntime">选择并检查版本</n-button>
      </div>
      <p v-if="runtimeBusy" role="status" class="text-sm mt-3">请在系统对话框中选择程序并确认检查。</p>
      <n-alert v-if="runtimeError" type="error" role="alert" class="mt-3">{{ runtimeError }}</n-alert>
      <n-alert v-if="runtimeResult" :type="runtimeResult.version ? 'info' : 'warning'" class="mt-3" role="status">
        <p>{{ runtimeResult.family }} 版本：{{ runtimeResult.version ?? '未能识别' }}</p>
        <p class="break-all">所选程序：{{ runtimeResult.executablePath }}</p>
        <p>检查时间：{{ new Date(runtimeResult.checkedAt).toLocaleString() }}</p>
        <p>此结果不代表项目环境检查通过。</p>
        <p v-if="runtimeExpired">本次版本结果已过期，请重新选择并检查。</p>
      </n-alert>
      <ul v-if="runtimeResult" class="mt-3 space-y-3" aria-label="运行时版本匹配结果">
        <li v-for="match in runtimeResult.services" :key="match.serviceId">
          <n-alert :type="runtimeExpired ? 'warning' : match.requirementStatus === 'unsatisfied' ? 'error' : match.requirementStatus === 'satisfied' ? 'success' : 'warning'">
            <p class="font-semibold break-all">{{ match.serviceName }} · {{ match.commandMatch === 'matched' ? '直接路径一致' : match.commandMatch === 'different' ? '所选程序不同' : '路径未确定' }} · {{ requirementLabels[match.requirementStatus] }}</p>
            <p class="break-words">{{ match.detail }}</p>
            <p v-if="match.source" class="break-all">声明来源：{{ match.source }}</p>
            <p v-if="match.requirement" class="break-all">版本要求：{{ match.requirement }}</p>
          </n-alert>
        </li>
      </ul>
      <p v-if="runtimeFamily === 'node'" class="text-sm mt-3 opacity-80">Node 比较支持稳定版本的完整版本号、比较符、^ / ~ 完整版本及 ||。仅 &gt;= 和 &lt; 可省略次版本。</p>
      <p v-else-if="runtimeFamily === 'python'" class="text-sm mt-3 opacity-80">Python 比较支持逗号连接的稳定版本条件、== / != 前缀通配和 ~= 兼容范围。动态声明、Poetry 专有要求和其他配置文件暂不解析。</p>
      <p v-else class="text-sm mt-3 opacity-80">Java 只比较本地 pom.xml 中单个 Enforcer 执行的 requireJavaVersion 构建 JVM 声明，支持 Java 9+ 整数边界范围。不会把编译目标当作运行时要求；父 POM、profile、Gradle 和间接调用暂不解析。</p>
      <p class="text-sm mt-3 opacity-80">其他语法、预发布版本与间接命令暂显示未确定。结果有效期 1 分钟；启动前重查文件摘要及声明，过期需重新检查，不会再次自动执行版本命令。这不是项目启动授权。</p>
    </n-card>
    <n-alert v-if="!profile" type="info">请先创建并保存启动方案。</n-alert>
    <n-alert v-else-if="dirty" type="warning">方案有未保存的修改，请先在“启动配置”中保存，再检查运行环境。</n-alert>
    <div class="flex flex-wrap gap-3">
      <n-button :disabled="!profile || dirty" @click="$emit('install')">预览依赖安装并运行</n-button>
      <n-button @click="$emit('history')">查看运行记录与失败原因</n-button>
    </div>
    <p class="text-sm opacity-80">安装入口复用已有确认流程：先核对安装和启动内容，再决定是否执行。取消确认不会安装依赖。</p>
    <p v-if="busy" role="status" class="text-sm">正在检查，通常在 5 秒内完成…</p>
    <n-alert v-if="error" type="error" role="alert" title="检查未完成">{{ error }}</n-alert>
    <template v-if="report">
      <n-alert :type="expired ? 'warning' : blockedCount ? 'error' : 'info'" role="status">
        <template v-if="expired">检查结果已过期，请重新检查。环境和端口可能已变化。</template>
        <template v-else>检查完成：{{ blockedCount }} 项阻断，{{ warningCount }} 项警告，{{ unknownCount }} 项未确定。</template>
        <p class="text-sm mt-1">检查时间：{{ new Date(report.checkedAt).toLocaleString() }}；结果有效期 1 分钟，仅供参考。</p>
      </n-alert>
      <ol class="space-y-3" aria-label="环境检查结果">
        <li v-for="(check, index) in displayedChecks" :key="`${check.serviceId ?? 'profile'}-${check.code}-${index}`">
          <n-card size="small">
            <div class="flex flex-wrap items-center gap-2">
              <n-tag size="small" :type="tagType(check.status)">{{ statusText[check.status] }}</n-tag>
              <h4 class="font-semibold text-sm break-all">{{ check.serviceName ? `${check.serviceName} · ` : '' }}{{ check.title }}</h4>
            </div>
            <p class="text-sm mt-2 break-words">{{ check.detail }}</p>
            <p class="text-sm mt-1 opacity-80 break-words">{{ check.suggestion }}</p>
          </n-card>
        </li>
      </ol>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { NAlert, NButton, NCard, NSelect, NTag } from 'naive-ui';
import type { DiagnosticStatus, ProfileDiagnosticsDto, RunProfileDto, RuntimeFamily, RuntimeProbeDto } from '@codehelm/contracts';
import { displayIpcError } from '../utils/ipc-error.js';
import { useThemeStore } from '../stores/themeStore.js';

const props = defineProps<{ profile: RunProfileDto | null; savedProfile?: RunProfileDto }>();
defineEmits<{ install: []; history: [] }>();
const themeStore = useThemeStore();
const dirty = computed(() => !!props.profile && JSON.stringify(props.profile) !== JSON.stringify(props.savedProfile));
const report = ref<ProfileDiagnosticsDto | null>(null);
const busy = ref(false);
const error = ref('');
const runtimeFamily = ref<RuntimeFamily>('node');
const runtimeOptions: Array<{ label: string; value: RuntimeFamily }> = [
  { label: 'Node.js', value: 'node' },
  { label: 'Python', value: 'python' },
  { label: 'Java', value: 'java' },
];
const runtimeResult = ref<RuntimeProbeDto | null>(null);
const runtimeBusy = ref(false);
const runtimeError = ref('');
let runtimeRequest = 0;
async function probeRuntime() {
  if (!props.profile || dirty.value || runtimeBusy.value) return;
  const epoch = ++runtimeRequest;
  runtimeBusy.value = true;
  runtimeError.value = '';
  runtimeResult.value = null;
  try {
    const result = await window.codehelm.runner.probeRuntime(props.profile.id, runtimeFamily.value);
    if (epoch === runtimeRequest) runtimeResult.value = result;
  } catch (cause) {
    if (epoch === runtimeRequest) runtimeError.value = displayIpcError(cause, '版本检查失败。');
  } finally {
    if (epoch === runtimeRequest) runtimeBusy.value = false;
  }
}
const now = ref(Date.now());
const runtimeExpired = computed(() => !!runtimeResult.value && now.value >= Date.parse(runtimeResult.value.checkedAt) + 60_000);
const requirementLabels = { satisfied: '满足声明', unsatisfied: '不满足声明', unspecified: '未声明要求', unknown: '版本兼容性未确定' };
let request = 0;
const timer = setInterval(() => { now.value = Date.now(); }, 1_000);
const expired = computed(() => !!report.value && now.value >= Date.parse(report.value.expiresAt));
const blockedCount = computed(() => report.value?.checks.filter(check => check.status === 'blocked').length ?? 0);
const warningCount = computed(() => report.value?.checks.filter(check => check.status === 'warning').length ?? 0);
const unknownCount = computed(() => report.value?.checks.filter(check => check.status === 'unknown').length ?? 0);
const statusPriority: Record<DiagnosticStatus, number> = { blocked: 0, warning: 1, unknown: 2, passed: 3, not_applicable: 4 };
const displayedChecks = computed(() => [...(report.value?.checks ?? [])].sort((a, b) => statusPriority[a.status] - statusPriority[b.status]));
const statusText: Record<DiagnosticStatus, string> = {
  passed: '通过', warning: '警告', blocked: '阻断', unknown: '未确定', not_applicable: '不适用',
};
function tagType(status: DiagnosticStatus): 'success' | 'warning' | 'error' | 'default' {
  return status === 'passed' ? 'success' : status === 'blocked' ? 'error' : status === 'warning' ? 'warning' : 'default';
}

// Editing, re-analysis, switching projects and unmounting invalidate pending UI results.
watch(() => JSON.stringify([props.profile, props.savedProfile]), () => {
  request++;
  runtimeRequest++;
  runtimeResult.value = null;
  runtimeError.value = '';
  runtimeBusy.value = false;
  report.value = null;
  error.value = '';
  busy.value = false;
});
onUnmounted(() => { runtimeRequest++; request++; clearInterval(timer); });

async function run() {
  if (!props.profile || dirty.value || busy.value) return;
  const currentRequest = ++request;
  const profileId = props.profile.id;
  busy.value = true;
  error.value = '';
  report.value = null;
  try {
    const result = await window.codehelm.runner.diagnose(profileId);
    if (request !== currentRequest || result.profileId !== profileId) return;
    now.value = Date.now();
    report.value = result;
  } catch (cause) {
    if (request === currentRequest) error.value = displayIpcError(cause, '运行环境检查失败，请稍后重试。');
  } finally {
    if (request === currentRequest) busy.value = false;
  }
}
defineExpose({ run });
</script>

<style scoped>
.hidden-accessible-select {
  position: absolute;
  opacity: 0;
  pointer-events: none;
  width: 1px;
  height: 1px;
  margin: -1px;
  border: 0;
  padding: 0;
  clip: rect(0 0 0 0);
  overflow: hidden;
}
</style>
