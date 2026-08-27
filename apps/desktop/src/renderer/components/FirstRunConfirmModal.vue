<template>
  <n-modal
    v-model:show="visible"
    preset="card"
    :title="installDependencies ? '安装并启动安全确认' : '首次运行安全确认'"
    class="w-680px border shadow-2xl transition-colors duration-200"
    :class="themeStore.isDark ? 'bg-[#121216] border-[#27272a] shadow-black/90' : 'bg-white border-zinc-300 shadow-zinc-400/30'"
    :segmented="{ content: 'soft', footer: 'soft' }"
  >
    <div class="space-y-4 max-h-520px overflow-y-auto pr-1">
      <div
        class="border rounded-xl p-3.5 text-xs leading-relaxed flex items-start gap-2.5 transition-colors"
        :class="themeStore.isDark ? 'bg-[#18181b] border-[#27272a] text-zinc-300' : 'bg-zinc-50 border-zinc-200 text-zinc-800'"
      >
        <IconShield :size="16" class="text-zinc-400 flex-shrink-0 mt-0.5" />
        <div>
          <strong>{{ installDependencies ? '安装并启动安全审核：' : '首次启动安全审核：' }}</strong>
          为了保障您的本机与环境安全，CodeHelm 绝不未经用户确认直接执行外部脚本。请审查下方由分析器推断或配置的命令与工作目录。
          <template v-if="installDependencies">本次确认还会先按主进程计算的依赖计划安装缺失依赖，再启动服务。</template>
          <template v-else>确认后当前应用会话内的相同配置将支持一键秒级拉起。</template>
        </div>
      </div>

      <div class="space-y-3">
        <h4 class="text-xs font-bold uppercase tracking-wider" :class="themeStore.isDark ? 'text-zinc-300' : 'text-zinc-700'">
          即将按拓扑依赖顺序并发拉起的服务列表：
        </h4>

        <div
          v-for="service in profile?.services.filter((s) => s.enabled)"
          :key="service.id"
          class="border rounded-xl p-4 space-y-2.5 transition-colors"
          :class="themeStore.isDark ? 'bg-[#18181b] border-[#27272a]' : 'bg-zinc-50 border-zinc-200'"
        >
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="text-sm font-bold" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
                {{ service.name }}
              </span>
              <span
                class="border px-1.5 py-0.2 rounded text-[10px] uppercase"
                :class="themeStore.isDark ? 'bg-[#27272a] text-zinc-300 border-transparent' : 'bg-white text-zinc-600 border-zinc-200'"
              >
                {{ service.type }}
              </span>
            </div>
            <div v-if="service.port" class="flex items-center gap-1.5">
              <span class="text-[11px]" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
                启动端口
              </span>
              <n-input-number
                :value="service.port"
                :min="1"
                :max="65535"
                size="small"
                class="!w-28 font-mono"
                @update:value="emit('update-port', service.id, $event)"
              />
            </div>
          </div>

          <div
            class="border rounded-lg p-2.5 font-mono text-xs break-all transition-colors"
            :class="themeStore.isDark ? 'bg-[#09090b] border-[#27272a] text-zinc-200' : 'bg-zinc-900 border-zinc-800 text-zinc-100'"
          >
            <span class="text-zinc-500">$ </span>
            <span class="text-white font-bold">{{ service.executable }}</span>
            <span class="text-zinc-300"> {{ service.args.join(' ') }}</span>
          </div>

          <div class="grid grid-cols-2 gap-2 text-[11px]" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
            <div>相对工作目录: <span class="font-mono" :class="themeStore.isDark ? 'text-zinc-300' : 'text-zinc-700'">./{{ service.cwdRelative || '(项目根目录)' }}</span></div>
            <div>配置来源: <span :class="themeStore.isDark ? 'text-zinc-300' : 'text-zinc-700'">{{ service.source === 'detected' ? '智能分析推断' : '用户手动配置' }}</span></div>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2.5">
        <n-button @click="visible = false">返回修改配置</n-button>
        <n-button
          type="primary"
          class="font-semibold shadow-sm"
          @click="handleConfirm"
        >
          <template #icon>
            <IconShield :size="14" />
          </template>
          {{ installDependencies ? '安全确认、安装并启动' : '安全确认并一键启动' }}
        </n-button>
      </div>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { RunProfileDto } from '@codehelm/contracts';
import { useThemeStore } from '../stores/themeStore.js';
import { IconShield } from '../components/icons/index.js';

const themeStore = useThemeStore();

const props = defineProps<{
  show: boolean;
  profile?: RunProfileDto | null;
  installDependencies?: boolean;
  }>();

const emit = defineEmits<{
  (e: 'update:show', val: boolean): void;
  (e: 'update-port', serviceId: string, port: number | null): void;
  (e: 'confirm'): void;
}>();

const visible = computed({
  get: () => props.show,
  set: (v) => emit('update:show', v),
});

function handleConfirm() {
  emit('confirm');
  visible.value = false;
}
</script>
