<template>
  <n-modal
    v-model:show="store.importModalVisible"
    preset="card"
    title="导入代码工程"
    class="w-680px max-w-[calc(100vw-40px)] border shadow-2xl"
    :class="themeStore.isDark ? 'bg-[#121216] border-[#27272a]' : 'bg-white border-zinc-200'"
    :segmented="{ content: 'soft', footer: 'soft' }"
    :closable="!busy"
    :mask-closable="!busy"
    :close-on-esc="!busy"
  >
    <div class="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
      <div class="flex gap-2" role="group" aria-label="导入方式">
        <n-button :type="mode === 'single' ? 'primary' : 'default'" :disabled="busy" @click="changeMode('single')">单个项目</n-button>
        <n-button :type="mode === 'batch' ? 'primary' : 'default'" :disabled="busy" @click="changeMode('batch')">工作区批量导入</n-button>
      </div>

      <div class="border rounded-xl p-4 space-y-3" :class="themeStore.isDark ? 'bg-[#18181b] border-[#27272a]' : 'bg-zinc-50 border-zinc-200'">
        <div class="flex items-center justify-between gap-3">
          <span class="text-sm font-semibold">{{ mode === 'single' ? '项目根目录' : '工作区父目录' }}</span>
          <n-button size="small" :disabled="busy || selecting" :loading="selecting" @click="selectDirectory">
            <template #icon><IconFolderOpen :size="15" /></template>
            {{ form.rootPath ? '更换目录' : '选择目录' }}
          </n-button>
        </div>
        <p v-if="form.rootPath" class="font-mono text-xs break-all">{{ form.rootPath }}</p>
        <p v-else class="text-xs text-zinc-500">
          {{ mode === 'single' ? '选择代码库根目录；Monorepo 可作为一个项目导入。' : '选择包含多个代码工程的父目录，再勾选需要导入的项目。' }}
        </p>
        <div v-if="mode === 'single' && form.rootPath" class="text-xs space-y-1">
          <p>目录预览：{{ preview?.framework || (busy ? '正在探测…' : '尚未识别，导入后进行完整分析') }}</p>
          <p v-if="preview?.recommendedRunCommand" class="font-sans text-xs break-all">建议命令：<span class="font-mono font-medium">{{ preview.recommendedRunCommand }}</span></p>
        </div>
        <div v-if="mode === 'batch'" class="flex items-center gap-3 text-xs">
          <span>扫描深度</span>
          <n-input-number v-model:value="depth" :min="0" :max="4" :precision="0" :disabled="busy" size="small" class="w-110px" aria-label="工作区扫描深度" />
          <n-button size="small" :disabled="busy || !form.rootPath" @click="scan">重新发现</n-button>
        </div>
      </div>

      <div v-if="mode === 'single'" class="space-y-3">
        <label class="block text-xs space-y-1">
          <span>工程显示名称（可选）</span>
          <n-input v-model:value="form.name" :disabled="busy" placeholder="默认为根文件夹名" />
        </label>
        <div class="text-xs space-y-1">
          <span>标签分类（可选）</span>
          <n-dynamic-tags v-model:value="form.tags" :disabled="busy" />
        </div>
      </div>

      <div v-if="mode === 'batch'" class="space-y-2">
        <div class="flex items-center justify-between text-xs">
          <span>发现 {{ candidates.length }} 个项目 · 已选择 {{ selectedPaths.length }}/100</span>
          <n-button size="tiny" :disabled="busy || !candidates.length" @click="selectedPaths = selectedPaths.length ? [] : candidates.slice(0, 100).map(item => item.rootPath)">
            {{ selectedPaths.length ? '取消选择' : candidates.length > 100 ? '选择前 100 项' : '全选' }}
          </n-button>
        </div>
        <n-checkbox-group v-model:value="selectedPaths" :max="100" :disabled="busy">
          <div class="space-y-2 max-h-220px overflow-y-auto">
            <div v-for="item in candidates" :key="item.rootPath" class="border rounded-lg p-2" :class="themeStore.isDark ? 'border-zinc-700' : 'border-zinc-200'">
              <n-checkbox :value="item.rootPath"><span class="font-semibold">{{ item.name }}</span> · {{ item.framework }}</n-checkbox>
              <p class="ml-6 text-xs text-zinc-500 break-all">{{ item.relativePath }}</p>
            </div>
          </div>
        </n-checkbox-group>
        <p class="text-xs text-zinc-500">最多返回 500 项，每次导入最多 100 项；忽略依赖、构建和隐藏目录，发现结果不代表全盘枚举。</p>
      </div>

      <section v-if="task" role="status" aria-live="polite" class="rounded-xl border p-3 space-y-2" :class="themeStore.isDark ? 'border-zinc-700' : 'border-zinc-300'">
        <div class="flex justify-between gap-3 text-sm">
          <span class="font-semibold">{{ task.stage }}</span>
          <span v-if="task.kind === 'import'" class="font-mono flex-shrink-0">{{ task.completedCount }}/{{ task.totalCount }}</span>
        </div>
        <p v-if="task.kind === 'scan'" class="text-xs text-zinc-500">已检查 {{ task.scannedDirectories }} 个目录 · 发现 {{ task.foundProjects }} 个项目</p>
        <p v-else-if="busy" class="text-xs text-zinc-500">当前项目已发现 {{ task.scannedFiles }} 个文件。取消会停止后续项目，已建立的记录和已保存结果保留。</p>
        <p v-if="task.errorMessage" role="alert" class="text-sm text-rose-500 break-all">{{ task.errorMessage }}</p>
        <div v-if="task.results.length" class="space-y-2 max-h-200px overflow-y-auto">
          <div v-for="(item, index) in task.results" :key="item.rootPath + index" class="text-xs">
            <p class="font-semibold">{{ item.name }} · {{ resultLabels[item.status] }}</p>
            <p v-if="item.errorMessage" class="text-rose-500 break-all">{{ item.errorMessage }}</p>
          </div>
        </div>
      </section>
      <p v-if="errorText" role="alert" class="text-sm text-rose-500 break-all">{{ errorText }}</p>

      <div class="flex gap-2 text-xs text-zinc-500">
        <IconLock :size="14" class="flex-shrink-0 mt-0.5" />
        <p>仅建立本地索引与静态画像，不移动、上传或修改源码。导入不会安装依赖或运行项目。正在保存的项目会完成保存后停止。</p>
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2.5">
        <n-button v-if="busy" :disabled="starting || task?.status === 'cancelling'" @click="job.cancel">
          {{ task?.status === 'cancelling' ? '正在停止…' : '取消任务' }}
        </n-button>
        <n-button v-else @click="store.importModalVisible = false">关闭</n-button>
        <n-button type="primary" :loading="busy && task?.kind === 'import'" :disabled="busy || selecting || !canImport" @click="submit">
          {{ mode === 'single' ? '确认导入工程' : '导入所选项目' }}
        </n-button>
      </div>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { computed, onUnmounted, reactive, ref, watch } from 'vue';
import { useProjectStore } from '../stores/projectStore.js';
import { useThemeStore } from '../stores/themeStore.js';
import { useProjectTask } from '../composables/useProjectTask.js';
import { message } from '../utils/discrete.js';
import { IconFolderOpen, IconLock } from '../components/icons/index.js';
import type { DiscoveredProjectDto, ProjectImportResultDto } from '@codehelm/contracts';

const store = useProjectStore();
const themeStore = useThemeStore();
const mode = ref<'single' | 'batch'>('single');
const form = reactive({ rootPath: '', name: '', tags: [] as string[] });
const depth = ref<number | null>(2);
const candidates = ref<DiscoveredProjectDto[]>([]);
const selectedPaths = ref<string[]>([]);
const preview = ref<DiscoveredProjectDto | null>(null);
const selecting = ref(false);
const errorText = ref('');
let selectionVersion = 0;
const resultLabels: Record<ProjectImportResultDto['status'], string> = {
  imported: '已建立记录，等待分析', completed: '导入并分析完成', existing: '已纳管，保留已有配置',
  failed: '未完成，请查看错误', cancelled: '分析已取消，已有记录保留',
};
const canImport = computed(() => mode.value === 'single' ? !!form.rootPath : selectedPaths.value.length > 0);
const job = useProjectTask(window.codehelm.projects, (state) => {
  if (state.kind === 'scan' && state.status === 'completed') {
    candidates.value = state.discovered;
    preview.value = state.discovered.find(item => item.rootPath.replace(/\\/g, '/') === form.rootPath.replace(/\\/g, '/')) ?? null;
    if (mode.value === 'single' && preview.value) form.tags = [...preview.value.tags];
  }
  if (state.kind === 'import') {
    void store.fetchProjects();
    if (state.status === 'completed') {
      const count = state.completedCount || 1;
      message.success(mode.value === 'single' ? '项目导入成功' : `成功导入 ${count} 个项目`);
      store.importModalVisible = false;
    } else if (state.status === 'partial') {
      message.warning('部分项目未完成，已保存的项目保留');
    }
  }
}, (error) => { errorText.value = error instanceof Error ? error.message : '项目任务操作失败'; });
const { state: task, busy, starting } = job;
job.subscribe();

function reset() {
  selectionVersion++;
  job.reset();
  form.rootPath = ''; form.name = ''; form.tags = [];
  preview.value = null; candidates.value = []; selectedPaths.value = []; errorText.value = '';
}

function changeMode(next: 'single' | 'batch') {
  if (busy.value || next === mode.value) return;
  reset();
  mode.value = next;
}

async function selectDirectory() {
  if (busy.value || selecting.value) return;
  const version = ++selectionVersion;
  selecting.value = true;
  errorText.value = '';
  try {
    const selected = await store.selectDirectory();
    if (!selected || version !== selectionVersion || !store.importModalVisible) return;
    job.reset();
    form.rootPath = selected.path; form.name = selected.name; form.tags = [];
    preview.value = null; candidates.value = []; selectedPaths.value = [];
    await scan();
  } catch (error) { errorText.value = error instanceof Error ? error.message : '选择目录失败'; }
  finally { selecting.value = false; }
}

async function scan() {
  if (!form.rootPath || busy.value) return;
  errorText.value = ''; candidates.value = []; selectedPaths.value = []; preview.value = null;
  await job.start('scan', () => window.codehelm.projects.startScan({ rootPath: form.rootPath, maxDepth: mode.value === 'single' ? 0 : depth.value ?? 2 }));
}

async function submit() {
  if (busy.value || !canImport.value) return;
  errorText.value = '';
  const projects = mode.value === 'single'
    ? [{ rootPath: form.rootPath, name: form.name.trim() || undefined, tags: [...form.tags] }]
    : candidates.value.filter(item => selectedPaths.value.includes(item.rootPath)).map(item => ({ rootPath: item.rootPath, name: item.name, tags: [...item.tags] }));
  await job.start('import', () => window.codehelm.projects.startImport({ projects }));
}

watch(() => store.importModalVisible, (visible) => { if (!visible) reset(); });
onUnmounted(() => { selectionVersion++; job.dispose(); });
</script>
