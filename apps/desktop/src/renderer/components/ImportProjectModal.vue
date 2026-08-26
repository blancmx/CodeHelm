<template>
  <n-modal
    v-model:show="store.importModalVisible"
    preset="card"
    title="导入代码工程"
    class="w-780px border shadow-2xl transition-colors duration-200"
    :class="themeStore.isDark ? 'bg-[#121216] border-[#27272a] shadow-black/80' : 'bg-white border-zinc-200 shadow-zinc-400/30'"
    :segmented="{ content: 'soft', footer: 'soft' }"
  >
    <!-- Import Mode Tabs (Default to Single Project) -->
    <n-tabs type="segment" v-model:value="importMode" class="mb-4">
      <!-- Tab 1: Single Project / Monorepo (DEFAULT) -->
      <n-tab-pane name="single" tab="导入单个工程 (支持包含多个子模块/前后端)">
        <div class="space-y-4 pt-2">
          <div>
            <label class="block text-xs mb-1.5 font-medium" :class="themeStore.isDark ? 'text-zinc-300' : 'text-zinc-700'">
              选择项目根目录路径 *
            </label>

            <!-- Clickable Direct Explorer Dropzone -->
            <div
              v-if="!singleForm.rootPath"
              class="border border-dashed rounded-xl p-6 text-center transition-all cursor-pointer group mb-3"
              :class="themeStore.isDark ? 'bg-[#18181b]/60 border-zinc-700 hover:border-zinc-400 hover:bg-[#18181b]' : 'bg-zinc-50 border-zinc-300 hover:border-zinc-500 hover:bg-zinc-100'"
              @click="handleSelectSingleDir"
            >
              <div
                class="w-11 h-11 rounded-xl border mx-auto mb-2.5 flex items-center justify-center transition-transform group-hover:scale-110"
                :class="themeStore.isDark ? 'bg-[#27272a] border-[#3f3f46] text-white' : 'bg-white border-zinc-200 text-zinc-950'"
              >
                <IconFolderOpen :size="20" />
              </div>
              <div class="text-xs font-bold" :class="themeStore.isDark ? 'text-zinc-200' : 'text-zinc-800'">
                点击打开文件资源管理器选择项目根目录
              </div>
              <div class="text-[11px] mt-1" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
                无论项目下包含多少子文件夹（如 frontend、backend、src、docs 等），均纳管为 1 个整体工程
              </div>
            </div>

            <div class="flex gap-2">
              <n-input
                v-model:value="singleForm.rootPath"
                placeholder="点击右侧按钮或在此输入项目绝对路径..."
                class="flex-1 font-mono text-xs"
                @update:value="handlePathChange"
              />
              <n-button type="default" secondary @click="handleSelectSingleDir">
                <template #icon>
                  <IconFolderOpen :size="14" />
                </template>
                打开资源管理器...
              </n-button>
            </div>
          </div>

          <!-- Detected Project Preview Info Card -->
          <div
            v-if="singleForm.rootPath"
            class="border rounded-xl p-3.5 space-y-2 transition-colors"
            :class="themeStore.isDark ? 'bg-[#18181b] border-[#27272a]' : 'bg-zinc-50 border-zinc-200'"
          >
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="text-xs font-bold" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
                  {{ singleForm.name || '待导入工程' }}
                </span>
                <span
                  v-if="detectedPreview?.framework"
                  class="text-[10px] font-medium px-2 py-0.5 rounded border"
                  :class="themeStore.isDark ? 'bg-[#27272a] text-zinc-200 border-[#3f3f46]' : 'bg-zinc-200 text-zinc-900 border-zinc-300'"
                >
                  {{ detectedPreview.framework }}
                </span>
              </div>
              <span class="text-[11px] font-mono" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
                将作为 1 个统一工程纳管
              </span>
            </div>

            <div class="text-[11px] flex items-center gap-3" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
              <span>推荐启动指令:</span>
              <code class="font-mono text-xs px-1.5 py-0.5 rounded border" :class="themeStore.isDark ? 'bg-[#121216] border-[#27272a] text-zinc-200' : 'bg-white border-zinc-200 text-zinc-800'">
                $ {{ detectedPreview?.recommendedRunCommand || 'npm run dev' }}
              </code>
            </div>
          </div>

          <div>
            <label class="block text-xs mb-1.5 font-medium" :class="themeStore.isDark ? 'text-zinc-300' : 'text-zinc-700'">
              工程显示名称（可选）
            </label>
            <n-input v-model:value="singleForm.name" placeholder="默认为根文件夹名" />
          </div>

          <div>
            <label class="block text-xs mb-1.5 font-medium" :class="themeStore.isDark ? 'text-zinc-300' : 'text-zinc-700'">
              标签分类（可选）
            </label>
            <n-dynamic-tags v-model:value="singleForm.tags" />
          </div>
        </div>
      </n-tab-pane>

      <!-- Tab 2: Batch Workspace Scan (Secondary) -->
      <n-tab-pane name="workspace" tab="批量发现多个独立项目 (扫描总仓库区)">
        <div class="space-y-4 pt-2">
          <!-- Step 1: Select Parent Directory -->
          <div>
            <label class="block text-xs mb-1.5 font-medium" :class="themeStore.isDark ? 'text-zinc-300' : 'text-zinc-700'">
              选择存放了多个完全不同独立代码库的总目录路径 *
            </label>

            <!-- Clickable Direct Explorer Dropzone -->
            <div
              v-if="!workspaceRoot && !hasScanned"
              class="border border-dashed rounded-xl p-5 text-center transition-all cursor-pointer group mb-3"
              :class="themeStore.isDark ? 'bg-[#18181b]/60 border-zinc-700 hover:border-zinc-400 hover:bg-[#18181b]' : 'bg-zinc-50 border-zinc-300 hover:border-zinc-500 hover:bg-zinc-100'"
              @click="handleSelectWorkspaceDir"
            >
              <div
                class="w-10 h-10 rounded-xl border mx-auto mb-2 flex items-center justify-center transition-transform group-hover:scale-110"
                :class="themeStore.isDark ? 'bg-[#27272a] border-[#3f3f46] text-white' : 'bg-white border-zinc-200 text-zinc-950'"
              >
                <IconFolderOpen :size="18" />
              </div>
              <div class="text-xs font-bold" :class="themeStore.isDark ? 'text-zinc-200' : 'text-zinc-800'">
                点击打开文件资源管理器选择总目录
              </div>
              <div class="text-[11px] mt-0.5" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
                仅用于批量发现并将各个子文件夹分别导入为相互独立的工程
              </div>
            </div>

            <div class="flex gap-2">
              <n-input
                v-model:value="workspaceRoot"
                placeholder="例如: E:/all-my-github-repos"
                class="flex-1 font-mono text-xs"
                @keyup.enter="handleScanWorkspace"
              />
              <n-button type="default" secondary @click="handleSelectWorkspaceDir">
                <template #icon>
                  <IconFolderOpen :size="14" />
                </template>
                打开资源管理器...
              </n-button>
              <n-button
                type="primary"
                :loading="isScanning"
                :disabled="!workspaceRoot.trim()"
                @click="handleScanWorkspace"
              >
                <template #icon>
                  <IconSearch :size="14" />
                </template>
                开始扫描
              </n-button>
            </div>
          </div>

          <!-- Step 2: Discovered Projects List -->
          <div v-if="hasScanned">
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-2">
                <span class="text-xs font-bold" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
                  已发现的独立项目 ({{ discoveredList.length }})
                </span>
                <span
                  class="text-[10px] border px-2 py-0.2 rounded font-mono"
                  :class="themeStore.isDark ? 'bg-[#18181b] text-zinc-300 border-[#27272a]' : 'bg-zinc-100 text-zinc-800 border-zinc-200'"
                >
                  已选中 {{ selectedDiscoveredIds.length }} 个
                </span>
              </div>

              <div class="flex items-center gap-2">
                <n-button size="tiny" secondary @click="toggleSelectAll">
                  {{ selectedDiscoveredIds.length === discoveredList.length ? '取消全选' : '全选全部' }}
                </n-button>
              </div>
            </div>

            <!-- Empty Scan Result -->
            <div
              v-if="discoveredList.length === 0"
              class="border rounded-xl p-8 text-center text-xs"
              :class="themeStore.isDark ? 'bg-[#18181b] border-[#27272a] text-zinc-400' : 'bg-zinc-50 border-zinc-200 text-zinc-500'"
            >
              未在该目录下检测到有效项目标识（package.json / requirements.txt / *.py / index.html 等）。
            </div>

            <!-- Projects Grid / Table -->
            <div v-else class="max-h-340px overflow-y-auto space-y-2 pr-1">
              <div
                v-for="item in discoveredList"
                :key="item.id"
                class="border rounded-xl p-3 flex items-center justify-between transition-all cursor-pointer"
                :class="selectedDiscoveredIds.includes(item.id)
                  ? (themeStore.isDark ? 'bg-[#18181b] border-white shadow-sm' : 'bg-zinc-100 border-black shadow-sm')
                  : (themeStore.isDark ? 'bg-[#18181b] border-[#27272a] hover:border-zinc-500' : 'bg-zinc-50 border-zinc-200 hover:border-zinc-300')"
                @click="toggleSelectDiscovered(item.id)"
              >
                <div class="flex items-center gap-3 min-w-0">
                  <n-checkbox
                    :checked="selectedDiscoveredIds.includes(item.id)"
                    @click.stop="toggleSelectDiscovered(item.id)"
                  />

                  <div class="min-w-0">
                    <div class="flex items-center gap-2 flex-wrap">
                      <span class="text-xs font-bold truncate" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
                        {{ item.name }}
                      </span>
                      <span
                        class="text-[10px] font-medium px-1.5 py-0.2 rounded border"
                        :class="themeStore.isDark ? 'bg-[#27272a] text-zinc-200 border-[#3f3f46]' : 'bg-zinc-200 text-zinc-900 border-zinc-300'"
                      >
                        {{ item.framework }}
                      </span>
                    </div>

                    <div class="flex items-center gap-3 text-[11px] font-mono mt-1" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
                      <span class="truncate max-w-260px">./{{ item.relativePath }}</span>
                      <span :class="themeStore.isDark ? 'text-zinc-300' : 'text-zinc-700'">$ {{ item.recommendedRunCommand }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </n-tab-pane>
    </n-tabs>

    <!-- Bottom Safety Guarantee -->
    <div
      class="border rounded-lg p-3 text-xs flex items-start gap-2.5 transition-colors mt-2"
      :class="themeStore.isDark ? 'bg-[#18181b] border-[#27272a] text-zinc-400' : 'bg-zinc-50 border-zinc-200 text-zinc-600'"
    >
      <IconLock :size="14" class="text-zinc-400 flex-shrink-0 mt-0.5" />
      <div class="leading-relaxed">
        <strong>本地优先安全保证</strong>：CodeHelm 仅建立本地启动编排索引与静态画像，绝不移动、上传或修改您的源码文件。
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2.5">
        <n-button @click="store.importModalVisible = false">取消</n-button>

        <n-button
          v-if="importMode === 'single'"
          type="primary"
          class="font-semibold shadow-sm"
          :loading="store.loading"
          :disabled="!singleForm.rootPath.trim()"
          @click="handleSingleImportSubmit"
        >
          确认导入为 1 个整体工程并进入
        </n-button>

        <n-button
          v-else
          type="primary"
          class="font-semibold shadow-sm"
          :loading="store.loading"
          :disabled="selectedDiscoveredIds.length === 0"
          @click="handleBatchImportSubmit"
        >
          批量纳管选中的 {{ selectedDiscoveredIds.length }} 个独立项目
        </n-button>
      </div>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue';
import { message } from '../utils/discrete.js';
import { useRouter } from 'vue-router';
import { useProjectStore } from '../stores/projectStore.js';
import { useThemeStore } from '../stores/themeStore.js';
import type { DiscoveredProjectDto } from '@codehelm/contracts';
import {
  IconFolderOpen,
  IconSearch,
  IconLock,
} from '../components/icons/index.js';

const store = useProjectStore();
const themeStore = useThemeStore();
const router = useRouter();

// Default mode is 'single' (Import 1 unified project with all submodules)
const importMode = ref<'single' | 'workspace'>('single');

// Single project form state
const singleForm = reactive({
  rootPath: '',
  name: '',
  tags: [] as string[],
});
const detectedPreview = ref<DiscoveredProjectDto | null>(null);

// Workspace scan state
const workspaceRoot = ref('');
const isScanning = ref(false);
const hasScanned = ref(false);
const discoveredList = ref<DiscoveredProjectDto[]>([]);
const selectedDiscoveredIds = ref<string[]>([]);

async function handleSelectSingleDir() {
  const selected = await store.selectDirectory();
  if (selected) {
    singleForm.rootPath = selected.path;
    singleForm.name = selected.name || singleForm.name || 'Project';
    await runPreScan(selected.path);
  }
}

async function handlePathChange(val: string) {
  if (val.trim()) {
    const defaultName = val.split(/[/\\]/).filter(Boolean).pop() || 'Project';
    if (!singleForm.name) {
      singleForm.name = defaultName;
    }
    await runPreScan(val.trim());
  }
}

async function runPreScan(rootPath: string) {
  try {
    const res = await store.scanWorkspace(rootPath);
    if (res && res.length > 0) {
      detectedPreview.value = res[0];
      if (res[0].tags && res[0].tags.length > 0 && singleForm.tags.length === 0) {
        singleForm.tags = [...res[0].tags];
      }
    }
  } catch {}
}

async function handleSingleImportSubmit() {
  if (!singleForm.rootPath.trim()) {
    message.warning('请输入或选择项目根目录');
    return;
  }

  try {
    message.loading(`正在导入工程 "${singleForm.name || 'Project'}" 并分析技术栈...`);
    const project = await store.importProject({
      rootPath: singleForm.rootPath.trim(),
      name: singleForm.name.trim() || undefined,
      tags: [...singleForm.tags],
    });

    if (project) {
      store.importModalVisible = false;
      singleForm.rootPath = '';
      singleForm.name = '';
      singleForm.tags = [];
      detectedPreview.value = null;

      message.success(`工程 "${project.name}" 纳管成功！已自动建立技术画像`);
      router.push(`/projects/${project.id}`);
    }
  } catch (err: any) {
    message.error(err.message || '导入工程失败');
  }
}

async function handleSelectWorkspaceDir() {
  const selected = await store.selectDirectory();
  if (selected) {
    workspaceRoot.value = selected.path;
    await handleScanWorkspace();
  }
}

async function handleScanWorkspace() {
  if (!workspaceRoot.value.trim() || isScanning.value) return;
  try {
    isScanning.value = true;
    const res = await store.scanWorkspace(workspaceRoot.value.trim());
    discoveredList.value = res || [];
    // Auto select all by default
    selectedDiscoveredIds.value = discoveredList.value.map((d) => d.id);
    hasScanned.value = true;
    message.success(`扫描完成，共发现 ${discoveredList.value.length} 个独立子项目`);
  } catch (err: any) {
    message.error(err.message || '扫描工作区失败');
  } finally {
    isScanning.value = false;
  }
}

function toggleSelectDiscovered(id: string) {
  const idx = selectedDiscoveredIds.value.indexOf(id);
  if (idx >= 0) {
    selectedDiscoveredIds.value.splice(idx, 1);
  } else {
    selectedDiscoveredIds.value.push(id);
  }
}

function toggleSelectAll() {
  if (selectedDiscoveredIds.value.length === discoveredList.value.length) {
    selectedDiscoveredIds.value = [];
  } else {
    selectedDiscoveredIds.value = discoveredList.value.map((d) => d.id);
  }
}

async function handleBatchImportSubmit() {
  const selected = discoveredList.value.filter((d) => selectedDiscoveredIds.value.includes(d.id));
  if (selected.length === 0) {
    message.warning('请至少勾选一个项目');
    return;
  }

  try {
    message.loading(`正在批量纳管 ${selected.length} 个独立项目并自动生成技术画像...`);
    const projectInputs = selected.map((d) => ({
      rootPath: d.rootPath,
      name: d.name,
      tags: [...(d.tags || [])],
    }));
    const importedIds = await store.batchImport(projectInputs);
    store.importModalVisible = false;
    message.success(`成功纳管 ${importedIds.length} 个项目！`);
    if (importedIds.length > 0) {
      router.push(`/projects/${importedIds[0]}`);
    }
  } catch (err: any) {
    message.error(err.message || '批量纳管失败');
  }
}
</script>
