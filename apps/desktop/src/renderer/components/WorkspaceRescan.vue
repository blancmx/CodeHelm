<template>
  <section class="border border-zinc-500/30 rounded-xl p-4 space-y-3 text-sm" aria-label="工作区复扫">
    <h3 class="font-semibold">保存的工作区与复扫</h3>
    <p>手动检查清单、锁文件及工作区配置的变化，不运行或删除项目。排除规则按目录名匹配；超过深度的文件不在本次检查范围。</p>
    <label class="block">保存的工作区
      <select aria-label="保存的工作区" class="block w-full bg-transparent border border-zinc-500 rounded p-2" :disabled="busy" v-model="selected" @change="choose">
        <option value="">选择一个工作区</option><option v-for="item in saved" :key="item.rootPath" :value="item.rootPath">{{ item.rootPath }}</option>
      </select>
    </label>
    <n-button :disabled="busy" @click="pick">选择工作区目录</n-button>
    <p class="break-all">{{ root }}</p>
    <label class="block">扫描深度（0～4）<n-input-number v-model:value="depth" :min="0" :max="4" :disabled="busy" aria-label="复扫深度" /></label>
    <label class="block">排除目录名（逗号分隔）<n-input v-model:value="exclusions" :disabled="busy" placeholder="例如 archive, scratch" /></label>
    <div class="flex gap-2">
      <n-button :disabled="busy || !root" @click="scan">保存设置并复扫</n-button>
      <n-button v-if="busy" :disabled="starting || task?.status === 'cancelling'" @click="job.cancel">取消复扫或导入</n-button>
    </div>
    <p v-if="task" role="status">{{ task.stage }} · {{ task.scannedDirectories }} 个目录</p>
    <p v-if="error || task?.errorMessage" role="alert" class="text-rose-500">{{ error || task?.errorMessage }}</p>
    <div v-if="record" class="space-y-2">
      <p>最近成功扫描：{{ record.lastSuccessAt ? new Date(record.lastSuccessAt).toLocaleString() : '暂无完整成功扫描' }}</p>
      <p v-if="record.issues.length" role="alert">{{ record.issues.length }} 项无法完整读取，上次成功基线保留；无法判断不代表项目被删除。</p>
      <div class="max-h-80 overflow-y-auto space-y-2">
        <div v-for="entry in record.entries" :key="entry.relativePath" class="border-t border-zinc-500/30 pt-2">
          <p class="font-semibold break-all">{{ entry.relativePath }} · {{ labels[entry.status] }} {{ ignored.includes(entry.relativePath) ? '（已忽略候选）' : '' }}</p>
          <p v-if="entry.changedFiles.length" class="break-all">分析可能过期：{{ entry.changedFiles.join('、') }}</p>
          <router-link v-if="entry.projectId" :to="`/projects/${entry.projectId}?tab=config`" class="underline">查看项目并重新分析</router-link>
          <label class="block" v-if="!entry.projectId"><input type="checkbox" :disabled="busy" :checked="ignored.includes(entry.relativePath)" @change="toggleIgnore(entry.relativePath)" /> 忽略此候选（下次复扫保存）</label>
        </div>
      </div>
    </div>
    <n-button :disabled="busy || !importable.length" @click="importNew">导入未忽略的新项目（{{ importable.length }}）</n-button>
    <div v-if="task?.kind === 'import'">
      <p>成功 {{ task.results.filter(item => item.status === 'completed').length }} · 已纳管跳过 {{ task.results.filter(item => item.status === 'existing').length }} · 失败 {{ failed.length }}</p>
      <p v-for="item in task.results" :key="item.rootPath" class="break-all">{{ item.name }}：{{ importLabels[item.status] }} {{ item.errorMessage }}</p>
      <n-button :disabled="busy || !failed.length" @click="retry">仅重试失败项目</n-button>
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { SavedWorkspace, DiscoveredProjectDto } from '@codehelm/contracts';
import { useProjectTask } from '../composables/useProjectTask.js';
import { useProjectStore } from '../stores/projectStore.js';
const saved = ref<SavedWorkspace[]>([]), root = ref(''), selected = ref(''), depth = ref<number | null>(2), exclusions = ref(''), ignored = ref<string[]>([]), error = ref('');
const candidates = ref<DiscoveredProjectDto[]>([]);
const store = useProjectStore();
const record = computed(() => saved.value.find(item => item.rootPath === root.value));
const labels = { new: '新增', managed: '已纳管', changed: '变化', unavailable: '路径不可用', unknown: '无法判断' };
const importLabels = { imported: '已建立记录，等待分析', completed: '完成', existing: '已纳管，跳过', failed: '失败', cancelled: '已取消，已有记录保留' };
const job = useProjectTask(window.codehelm.projects, state => {
  if (state.kind === 'scan' && state.status === 'completed') { candidates.value = state.discovered; void refresh(); }
  if (state.kind === 'import') { void store.fetchProjects(); void refresh(); }
}, () => { error.value = '工作区操作失败，请检查目录或稍后重试。'; });
const { state: task, busy, starting } = job;
const importable = computed(() => candidates.value.filter(item => !ignored.value.includes(item.relativePath.replace(/\\/g, '/')) && !record.value?.entries.find(entry => entry.relativePath === item.relativePath.replace(/\\/g, '/'))?.projectId).slice(0, 100));
const failed = computed(() => task.value?.results.filter(item => item.status === 'failed') ?? []);
async function refresh() { try { saved.value = await window.codehelm.projects.workspaces(); } catch { error.value = '无法读取保存的工作区'; } }
function choose() { const item = saved.value.find(item => item.rootPath === selected.value); if (!item) return; root.value = item.rootPath; depth.value = item.maxDepth; exclusions.value = item.excludeDirs.join(', '); ignored.value = [...item.ignoredPaths]; candidates.value = []; }
async function pick() { const directory = await window.codehelm.projects.selectDirectory(); if (directory) { root.value = directory.path; selected.value = directory.path; ignored.value = []; candidates.value = []; choose(); } }
function toggleIgnore(relative: string) { ignored.value = ignored.value.includes(relative) ? ignored.value.filter(item => item !== relative) : [...ignored.value, relative]; }
async function scan() { error.value = ''; candidates.value = []; await job.start('scan', () => window.codehelm.projects.startScan({ rootPath: root.value, maxDepth: depth.value ?? 2, excludeDirs: exclusions.value.split(',').map(item => item.trim()).filter(Boolean), ignoredPaths: [...ignored.value], remember: true })); }
async function importNew() { const projects = importable.value.map(item => ({ rootPath: item.rootPath, name: item.name, tags: [...item.tags] })); await job.start('import', () => window.codehelm.projects.startImport({ projects })); }
async function retry() { const projects = failed.value.map(item => ({ rootPath: item.rootPath, name: item.name, tags: [] })); await job.start('import', () => window.codehelm.projects.startImport({ projects })); }
onMounted(() => { job.subscribe(); void refresh(); });
onUnmounted(() => job.dispose());
</script>
