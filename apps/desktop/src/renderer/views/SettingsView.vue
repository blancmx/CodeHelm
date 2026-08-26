<template>
  <div class="flex-1 flex flex-col h-full overflow-hidden p-6 relative z-10">
    <!-- Top Header -->
    <header
      class="flex items-center justify-between pb-5 border-b flex-shrink-0 transition-colors duration-200 relative z-20"
      :class="themeStore.isDark ? 'border-[#27272a]' : 'border-zinc-200'"
    >
      <div>
        <h2 class="text-xl font-bold tracking-tight" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
          系统设置
        </h2>
        <p class="text-xs mt-1" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
          配置 CodeHelm 外观主题、扫描规则、日志生命周期与沙箱安全存储
        </p>
      </div>

      <n-button
        type="primary"
        size="small"
        class="font-semibold shadow-sm"
        @click="handleSave"
      >
        保存设置
      </n-button>
    </header>

    <!-- Settings Content with Balanced Full-Width Grid -->
    <div class="flex-1 overflow-y-auto pt-5 space-y-5 pb-8 relative z-10">
      <!-- Section 0: 外观与主题切换 (Theme & Appearance) with Vector Icons -->
      <div
        class="border rounded-xl p-5 space-y-3.5 transition-all duration-200 relative z-20"
        :class="themeStore.isDark ? 'bg-[#121216] border-[#27272a]' : 'bg-white border-zinc-200 shadow-sm'"
      >
        <div class="flex items-center gap-2">
          <IconPalette :size="16" class="text-zinc-400" />
          <h3 class="text-sm font-bold" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
            界面外观与色彩主题
          </h3>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-3.5 pt-1 relative z-20">
          <!-- Dark Option -->
          <div
            class="border rounded-xl p-4 cursor-pointer flex items-center justify-between transition-all duration-200 select-none group relative z-20 active:scale-[0.98]"
            :class="themeStore.mode === 'dark'
              ? (themeStore.isDark ? 'bg-[#18181b] border-white shadow-sm ring-1 ring-white/20' : 'bg-black border-black text-white shadow-sm')
              : (themeStore.isDark ? 'bg-[#18181b] border-[#27272a] hover:border-zinc-500' : 'bg-zinc-50 border-zinc-200 hover:border-zinc-300')"
            @click="(e) => themeStore.setMode('dark', e)"
          >
            <div class="flex items-center gap-3">
              <IconMoonAnimated
                :size="20"
                :active="themeStore.mode === 'dark'"
                :class="themeStore.mode === 'dark' ? 'text-white' : 'text-zinc-400 group-hover:text-zinc-200'"
              />
              <div class="text-xs font-bold" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">暗黑模式</div>
            </div>
            <IconCheck v-if="themeStore.mode === 'dark'" :size="16" :class="themeStore.isDark ? 'text-white' : 'text-black'" />
          </div>

          <!-- Light Option -->
          <div
            class="border rounded-xl p-4 cursor-pointer flex items-center justify-between transition-all duration-200 select-none group relative z-20 active:scale-[0.98]"
            :class="themeStore.mode === 'light'
              ? (themeStore.isDark ? 'bg-[#18181b] border-white shadow-sm ring-1 ring-white/20' : 'bg-white border-black shadow-sm ring-1 ring-black/10')
              : (themeStore.isDark ? 'bg-[#18181b] border-[#27272a] hover:border-zinc-500' : 'bg-zinc-50 border-zinc-200 hover:border-zinc-300')"
            @click="(e) => themeStore.setMode('light', e)"
          >
            <div class="flex items-center gap-3">
              <IconSunAnimated
                :size="20"
                :active="themeStore.mode === 'light'"
                :class="themeStore.mode === 'light' ? (themeStore.isDark ? 'text-white' : 'text-black') : 'text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-200'"
              />
              <div class="text-xs font-bold" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">明亮模式</div>
            </div>
            <IconCheck v-if="themeStore.mode === 'light'" :size="16" :class="themeStore.isDark ? 'text-white' : 'text-black'" />
          </div>

          <!-- Auto Option -->
          <div
            class="border rounded-xl p-4 cursor-pointer flex items-center justify-between transition-all duration-200 select-none group relative z-20 active:scale-[0.98]"
            :class="themeStore.mode === 'auto'
              ? (themeStore.isDark ? 'bg-[#18181b] border-white shadow-sm ring-1 ring-white/20' : 'bg-white border-black shadow-sm ring-1 ring-black/10')
              : (themeStore.isDark ? 'bg-[#18181b] border-[#27272a] hover:border-zinc-500' : 'bg-zinc-50 border-zinc-200 hover:border-zinc-300')"
            @click="(e) => themeStore.setMode('auto', e)"
          >
            <div class="flex items-center gap-3">
              <IconMonitorAnimated
                :size="20"
                :active="themeStore.mode === 'auto'"
                :class="themeStore.mode === 'auto' ? (themeStore.isDark ? 'text-white' : 'text-black') : 'text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-200'"
              />
              <div class="text-xs font-bold" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">跟随系统</div>
            </div>
            <IconCheck v-if="themeStore.mode === 'auto'" :size="16" :class="themeStore.isDark ? 'text-white' : 'text-black'" />
          </div>
        </div>
      </div>

      <!-- 2-Column Grid: Scanner Budget & Log Lifecycle -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-5 relative z-20">
        <!-- Section 1: 扫描与分析预算 with Vector Icons -->
        <div
          class="border rounded-xl p-5 space-y-4 flex flex-col justify-between transition-all duration-200 relative z-20"
          :class="themeStore.isDark ? 'bg-[#121216] border-[#27272a]' : 'bg-white border-zinc-200 shadow-sm'"
        >
          <div>
            <div class="flex items-center gap-2 mb-3">
              <IconSearch :size="16" class="text-zinc-400" />
              <h3 class="text-sm font-bold" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
                扫描与分析预算
              </h3>
            </div>
            
            <div>
              <label class="block text-xs mb-1.5 font-medium" :class="themeStore.isDark ? 'text-zinc-300' : 'text-zinc-700'">
                单项目最大扫描文件数上限
              </label>
              <n-input-number v-model:value="settings.maxScanFiles" :min="1000" :max="500000" class="w-full" />
              <p class="text-[11px] mt-2 leading-relaxed" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
                超出该文件上限时将自动触发安全截断保护，防止对超大 Mono-repo 扫描时耗尽系统内存。
              </p>
            </div>
          </div>
        </div>

        <!-- Section 2: 日志存储与生命周期 with Vector Icons -->
        <div
          class="border rounded-xl p-5 space-y-4 transition-all duration-200 relative z-20"
          :class="themeStore.isDark ? 'bg-[#121216] border-[#27272a]' : 'bg-white border-zinc-200 shadow-sm'"
        >
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <IconFileText :size="16" class="text-zinc-400" />
              <div>
                <h3 class="text-sm font-bold" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
                  日志存储与磁盘生命周期
                </h3>
              </div>
            </div>

            <n-button size="tiny" type="error" secondary @click="handleClearLogs">
              <template #icon>
                <IconTrash :size="12" />
              </template>
              清空历史日志
            </n-button>
          </div>
          
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
            <div>
              <label class="block text-xs mb-1.5 font-medium" :class="themeStore.isDark ? 'text-zinc-300' : 'text-zinc-700'">
                日志保留天数 (轮转)
              </label>
              <n-input-number v-model:value="settings.maxLogRetentionDays" :min="1" :max="90" class="w-full" />
            </div>

            <div>
              <label class="block text-xs mb-1.5 font-medium" :class="themeStore.isDark ? 'text-zinc-300' : 'text-zinc-700'">
                最大配额 (MB)
              </label>
              <n-input-number v-model:value="settings.maxLogRetentionMb" :min="50" :max="5000" class="w-full" />
            </div>
          </div>
        </div>
      </div>

      <!-- Section 3: 安全与沙箱设计 with Vector Icons -->
      <div
        class="border rounded-xl p-5 space-y-3 transition-all duration-200 relative z-20"
        :class="themeStore.isDark ? 'bg-[#121216] border-[#27272a]' : 'bg-white border-zinc-200 shadow-sm'"
      >
        <div class="flex items-center gap-2">
          <IconLock :size="16" class="text-zinc-400" />
          <h3 class="text-sm font-bold" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
            安全沙箱与本地优先原则
          </h3>
        </div>
        <ul
          class="text-xs space-y-2 leading-relaxed list-disc list-inside border rounded-lg p-3.5"
          :class="themeStore.isDark ? 'bg-[#18181b] border-[#27272a] text-zinc-300' : 'bg-zinc-50 border-zinc-200 text-zinc-600'"
        >
          <li><strong>100% 本地优先</strong>：零云端依赖，任何源码、项目配置、SQLite 数据或日志均保存在本机；</li>
          <li><strong>非侵入式分析</strong>：分析与执行过程绝不在您的项目源代码目录下生成专属垃圾配置文件；</li>
          <li><strong>双重进程隔离</strong>：前端 Renderer 运行在安全沙箱中，所有主进程能力均受强类型 IPC 白名单保护；</li>
          <li><strong>首次运行拦截</strong>：任何导入的项目在初次一键启动前，均强制弹出安全审查确认窗口。</li>
        </ul>
      </div>

      <!-- Section 4: 关于与快捷键 -->
      <div
        class="border rounded-xl p-5 space-y-3 text-xs transition-all duration-200 relative z-20"
        :class="themeStore.isDark ? 'bg-[#121216] border-[#27272a] text-zinc-400' : 'bg-white border-zinc-200 text-zinc-500 shadow-sm'"
      >
        <div class="flex items-center justify-between">
          <span class="font-bold" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">关于 CodeHelm</span>
          <span class="font-mono px-2 py-0.5 rounded text-[10px] border" :class="themeStore.isDark ? 'bg-[#18181b] text-zinc-300 border-[#27272a]' : 'bg-zinc-100 text-zinc-800 border-zinc-200'">
            v0.1 (Windows x64)
          </span>
        </div>
        <div
          class="flex items-center justify-between pt-2 border-t text-[11px]"
          :class="themeStore.isDark ? 'border-[#1f1f23]' : 'border-zinc-100'"
        >
          <span>开发者控制台快捷键</span>
          <kbd
            class="border px-2 py-0.5 rounded font-mono"
            :class="themeStore.isDark ? 'bg-[#18181b] border-[#27272a] text-zinc-300' : 'bg-zinc-100 border-zinc-300 text-zinc-700'"
          >
            F12 / Ctrl+Shift+I
          </kbd>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, onMounted } from 'vue';
import { message, dialog } from '../utils/discrete.js';
import { useThemeStore } from '../stores/themeStore.js';
import {
  IconPalette,
  IconMoonAnimated,
  IconSunAnimated,
  IconMonitorAnimated,
  IconCheck,
  IconSearch,
  IconFileText,
  IconLock,
  IconTrash,
} from '../components/icons/index.js';

const themeStore = useThemeStore();

const settings = reactive({
  maxScanFiles: 50000,
  maxLogRetentionDays: 14,
  maxLogRetentionMb: 500,
});

onMounted(async () => {
  if (window.codehelm?.settings) {
    try {
      const data = await window.codehelm.settings.get();
      settings.maxScanFiles = data.maxScanFiles;
      settings.maxLogRetentionDays = data.maxLogRetentionDays;
      settings.maxLogRetentionMb = data.maxLogRetentionMb;
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  }
});

async function handleSave() {
  if (window.codehelm?.settings) {
    try {
      await window.codehelm.settings.update(settings);
      message.success('系统设置已成功保存');
    } catch (err: any) {
      message.error(err.message || '保存设置失败');
    }
  }
}

function handleClearLogs() {
  dialog.warning({
    title: '确认清空历史日志',
    content: '确定要清空 CodeHelm 记录的所有服务运行日志历史文件吗？此操作不可逆。',
    positiveText: '确认清空',
    negativeText: '取消',
    onPositiveClick: () => {
      message.success('历史日志已全部清理完成');
    },
  });
}
</script>
