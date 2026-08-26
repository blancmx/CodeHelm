<template>
  <n-modal
    v-model:show="store.importModalVisible"
    preset="card"
    title="导入代码工程"
    class="w-680px border shadow-2xl transition-colors duration-200"
    :class="themeStore.isDark ? 'bg-[#121216] border-[#27272a] shadow-black/80' : 'bg-white border-zinc-200 shadow-zinc-400/30'"
    :segmented="{ content: 'soft', footer: 'soft' }"
  >
    <div class="space-y-4 pt-1">
      <div>
        <label class="block text-xs mb-2 font-medium" :class="themeStore.isDark ? 'text-zinc-300' : 'text-zinc-700'">
          选择项目根目录 *
        </label>

        <!-- 1. Expanded Clickable Explorer Dropzone (When unselected) -->
        <div
          v-if="!singleForm.rootPath"
          class="border-2 border-dashed rounded-2xl py-10 px-6 text-center transition-all duration-200 cursor-pointer group select-none"
          :class="themeStore.isDark
            ? 'bg-[#18181b]/70 border-zinc-700 hover:border-zinc-400 hover:bg-[#18181b] shadow-sm'
            : 'bg-zinc-50/80 border-zinc-300 hover:border-zinc-500 hover:bg-zinc-100/90 shadow-xs'"
          @click="handleSelectSingleDir"
        >
          <div
            class="w-14 h-14 rounded-2xl border mx-auto mb-3.5 flex items-center justify-center transition-all duration-300 group-hover:scale-108 group-hover:shadow-md"
            :class="themeStore.isDark ? 'bg-[#27272a] border-[#3f3f46] text-white shadow-black/40' : 'bg-white border-zinc-200 text-zinc-950 shadow-zinc-200'"
          >
            <IconFolderOpen :size="26" />
          </div>
          <div class="text-sm font-bold tracking-tight" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
            点击打开文件资源管理器选择项目根目录
          </div>
          <div class="text-xs mt-1.5 leading-relaxed max-w-md mx-auto" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
            支持 Monorepo 及包含多个前后端/子模块的代码库，CodeHelm 将秒级自动探测技术栈与命令
          </div>
        </div>

        <!-- 2. Selected Directory Info & Action Card (When selected) -->
        <div
          v-else
          class="border rounded-2xl p-4.5 space-y-3 transition-colors"
          :class="themeStore.isDark ? 'bg-[#18181b] border-[#27272a]' : 'bg-zinc-50 border-zinc-200 shadow-xs'"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="flex items-center gap-3 min-w-0">
              <div
                class="w-10 h-10 rounded-xl border flex items-center justify-center flex-shrink-0"
                :class="themeStore.isDark ? 'bg-[#27272a] border-[#3f3f46] text-white' : 'bg-white border-zinc-200 text-zinc-950'"
              >
                <IconFolderOpen :size="18" />
              </div>
              <div class="min-w-0">
                <div class="text-xs font-bold truncate" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
                  {{ singleForm.name || '已选定工程目录' }}
                </div>
                <div
                  class="text-[11px] font-mono truncate max-w-380px mt-0.5"
                  :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'"
                  :title="singleForm.rootPath"
                >
                  {{ singleForm.rootPath }}
                </div>
              </div>
            </div>

            <n-button size="tiny" secondary @click="handleSelectSingleDir">
              <template #icon>
                <IconFolderOpen :size="12" />
              </template>
              更换目录...
            </n-button>
          </div>

          <!-- Detected Framework & Command Details -->
          <div
            class="pt-3 border-t flex items-center justify-between text-xs transition-colors"
            :class="themeStore.isDark ? 'border-[#27272a]' : 'border-zinc-200'"
          >
            <div class="flex items-center gap-2">
              <span class="text-[11px]" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">探测技术栈:</span>
              <span
                class="text-[10px] font-mono font-medium px-2 py-0.5 rounded border"
                :class="themeStore.isDark ? 'bg-[#27272a] text-zinc-200 border-[#3f3f46]' : 'bg-zinc-200 text-zinc-900 border-zinc-300'"
              >
                {{ detectedPreview?.framework || '通用项目' }}
              </span>
            </div>

            <div class="flex items-center gap-2">
              <span class="text-[11px]" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">推断启动:</span>
              <code class="font-mono text-[11px] px-2 py-0.5 rounded border" :class="themeStore.isDark ? 'bg-[#121216] border-[#27272a] text-zinc-200' : 'bg-white border-zinc-200 text-zinc-800'">
                $ {{ detectedPreview?.recommendedRunCommand || 'npm run dev' }}
              </code>
            </div>
          </div>
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

      <!-- Bottom Safety Guarantee -->
      <div
        class="border rounded-xl p-3 text-xs flex items-start gap-2.5 transition-colors mt-2"
        :class="themeStore.isDark ? 'bg-[#18181b] border-[#27272a] text-zinc-400' : 'bg-zinc-50 border-zinc-200 text-zinc-600'"
      >
        <IconLock :size="14" class="text-zinc-400 flex-shrink-0 mt-0.5" />
        <div class="leading-relaxed">
          <strong>本地优先安全保证</strong>：CodeHelm 仅建立本地启动编排索引与静态画像，绝不移动、上传或修改您的源码文件。
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2.5">
        <n-button @click="store.importModalVisible = false">取消</n-button>
        <n-button
          type="primary"
          class="font-semibold shadow-sm"
          :loading="store.loading"
          :disabled="!singleForm.rootPath.trim()"
          @click="handleSingleImportSubmit"
        >
          确认导入工程并进入
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
  IconLock,
} from '../components/icons/index.js';

const store = useProjectStore();
const themeStore = useThemeStore();
const router = useRouter();

// Single project form state
const singleForm = reactive({
  rootPath: '',
  name: '',
  tags: [] as string[],
});
const detectedPreview = ref<DiscoveredProjectDto | null>(null);

async function handleSelectSingleDir() {
  const selected = await store.selectDirectory();
  if (selected) {
    singleForm.rootPath = selected.path;
    const defaultName = selected.name || selected.path.split(/[/\\]/).filter(Boolean).pop() || 'Project';
    if (!singleForm.name) {
      singleForm.name = defaultName;
    }
    await runPreScan(selected.path);
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
    message.warning('请选择项目根目录');
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
</script>
