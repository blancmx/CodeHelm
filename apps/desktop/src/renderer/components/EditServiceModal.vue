<template>
  <n-modal
    v-model:show="visible"
    preset="card"
    :title="isEditing ? '编辑服务启动配置' : '添加受控服务配置'"
    class="w-680px border shadow-2xl transition-colors duration-200"
    :class="themeStore.isDark ? 'bg-[#121216] border-[#27272a] shadow-black/90' : 'bg-white border-zinc-200 shadow-zinc-400/30'"
    :segmented="{ content: 'soft', footer: 'soft' }"
  >
    <div class="space-y-4.5 max-h-560px overflow-y-auto pr-1">
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-xs mb-1.5 font-medium" :class="themeStore.isDark ? 'text-zinc-300' : 'text-zinc-700'">
            服务标识名称 *
          </label>
          <n-input v-model:value="form.name" placeholder="例如: Web 前端服务 / API 后端" />
        </div>

        <div>
          <label class="block text-xs mb-1.5 font-medium" :class="themeStore.isDark ? 'text-zinc-300' : 'text-zinc-700'">
            服务分类 *
          </label>
          <n-select
            v-model:value="form.type"
            :options="typeOptions"
          />
        </div>
      </div>

      <div class="grid grid-cols-3 gap-3">
        <div class="col-span-1">
          <label class="block text-xs mb-1.5 font-medium" :class="themeStore.isDark ? 'text-zinc-300' : 'text-zinc-700'">
            可执行程序 (Executable) *
          </label>
          <n-input v-model:value="form.executable" placeholder="pnpm / python / cargo / mvn" class="font-mono text-xs" />
        </div>

        <div class="col-span-2">
          <label class="block text-xs mb-1.5 font-medium" :class="themeStore.isDark ? 'text-zinc-300' : 'text-zinc-700'">
            参数列表 (Arguments) *
          </label>
          <n-dynamic-tags v-model:value="form.args" placeholder="+ 参数" />
        </div>
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-xs mb-1.5 font-medium" :class="themeStore.isDark ? 'text-zinc-300' : 'text-zinc-700'">
            工作目录 (相对项目根路径)
          </label>
          <n-input v-model:value="form.cwdRelative" placeholder="例如: packages/frontend 或留空" class="font-mono text-xs" />
        </div>

        <div>
          <label class="block text-xs mb-1.5 font-medium" :class="themeStore.isDark ? 'text-zinc-300' : 'text-zinc-700'">
            预期监听端口 (Port)
          </label>
          <n-input-number v-model:value="form.port" :min="1" :max="65535" placeholder="例如: 5173" class="w-full font-mono text-xs" />
        </div>
      </div>

      <!-- Health Check with Vector Icon -->
      <div
        class="border rounded-xl p-3.5 space-y-3 transition-colors"
        :class="themeStore.isDark ? 'bg-[#18181b] border-[#27272a]' : 'bg-zinc-50 border-zinc-200'"
      >
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold flex items-center gap-1.5" :class="themeStore.isDark ? 'text-zinc-200' : 'text-zinc-800'">
            <IconActivity :size="14" class="text-zinc-400" />
            <span>就绪健康检查探针 (Health Check)</span>
          </span>
          <n-select
            v-model:value="healthCheckType"
            :options="healthCheckOptions"
            size="small"
            class="w-36"
          />
        </div>

        <div v-if="healthCheckType === 'http'" class="flex gap-2">
          <n-input v-model:value="httpPath" placeholder="路径, 如 /api/health" size="small" class="flex-1 font-mono text-xs" />
          <n-input-number v-model:value="httpPort" placeholder="探针端口" size="small" class="w-28 font-mono text-xs" />
        </div>
      </div>

      <!-- Dependencies -->
      <div>
        <label class="block text-xs mb-1.5 font-medium" :class="themeStore.isDark ? 'text-zinc-300' : 'text-zinc-700'">
          前置拓扑依赖服务 (必须在本项目前就绪)
        </label>
        <n-select
          v-model:value="form.dependsOn"
          multiple
          :options="availableDependencyOptions"
          placeholder="请选择依赖的底层服务 (例如: MySQL / Redis / 后端 API)"
        />
      </div>

      <!-- Environment Variables -->
      <div>
        <div class="flex items-center justify-between mb-2">
          <label class="text-xs font-medium" :class="themeStore.isDark ? 'text-zinc-300' : 'text-zinc-700'">
            环境变量覆写 (Environment Overrides)
          </label>
          <n-button size="tiny" secondary @click="addEnvRow">
            <template #icon>
              <IconPlus :size="12" />
            </template>
            添加环境变量
          </n-button>
        </div>

        <div class="space-y-2 max-h-160px overflow-y-auto pr-1">
          <div v-if="form.env.length === 0" class="text-xs py-3 text-center border rounded-lg" :class="themeStore.isDark ? 'text-zinc-500 border-[#27272a]' : 'text-zinc-400 border-zinc-200'">
            暂无自定义环境变量
          </div>
          <div
            v-for="(item, idx) in form.env"
            :key="idx"
            class="flex items-center gap-2"
          >
            <n-input
              v-model:value="item.key"
              placeholder="KEY (如 PORT / DB_URL)"
              class="w-1/3 font-mono text-xs"
              size="small"
            />
            <div class="flex-1 relative flex items-center">
              <n-input
                v-model:value="item.value"
                :type="item.isSecret && !item.showPlain ? 'password' : 'text'"
                :placeholder="item.isRedacted ? '已保存的秘密（留空保留，输入新值替换）' : 'VALUE'"
                class="w-full font-mono text-xs"
                size="small"
                @update:value="item.isRedacted = false"
              />
              <button
                v-if="item.isSecret"
                class="absolute right-2 text-zinc-400 hover:text-zinc-200"
                type="button"
                @click="item.showPlain = !item.showPlain"
              >
                <IconEye v-if="!item.showPlain" :size="12" />
                <IconEyeOff v-else :size="12" />
              </button>
            </div>
            <n-button
              size="tiny"
              quaternary
              type="error"
              @click="removeEnvRow(idx)"
            >
              <template #icon>
                <IconX :size="14" />
              </template>
            </n-button>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2.5">
        <n-button @click="visible = false">取消</n-button>
        <n-button
          type="primary"
          class="font-semibold shadow-sm"
          :disabled="!form.name.trim() || !form.executable.trim()"
          @click="handleSave"
        >
          保存服务配置
        </n-button>
      </div>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue';
import type { ServiceConfigDto } from '@codehelm/contracts';
import { useThemeStore } from '../stores/themeStore.js';
import {
  IconActivity,
  IconPlus,
  IconEye,
  IconEyeOff,
  IconX,
} from '../components/icons/index.js';

const themeStore = useThemeStore();

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'id_' + Math.random().toString(36).slice(2, 11);
}

const props = defineProps<{
  show: boolean;
  serviceData?: ServiceConfigDto | null;
  otherServices: ServiceConfigDto[];
}>();

const emit = defineEmits<{
  (e: 'update:show', val: boolean): void;
  (e: 'save', service: ServiceConfigDto): void;
}>();

const visible = computed({
  get: () => props.show,
  set: (v) => emit('update:show', v),
});

const isEditing = computed(() => Boolean(props.serviceData?.id));

const typeOptions = [
  { label: '前端服务 (Frontend)', value: 'frontend' },
  { label: '后端服务 (Backend)', value: 'backend' },
  { label: '数据库/存储 (Database)', value: 'database' },
  { label: '自定义进程 (Custom)', value: 'custom' },
];

const healthCheckOptions = [
  { label: '无健康检查', value: 'none' },
  { label: 'TCP 端口探针', value: 'tcp' },
  { label: 'HTTP 路径探针', value: 'http' },
];

const healthCheckType = ref<'none' | 'tcp' | 'http' | 'log_regex'>('none');
const httpPath = ref('/health');
const httpPort = ref<number | undefined>(undefined);

interface FormEnvItem {
  key: string;
  value: string;
  isSecret: boolean;
  isRedacted?: boolean;
  showPlain?: boolean;
}

const form = reactive({
  id: '',
  runProfileId: '',
  name: '',
  type: 'custom' as any,
  executable: '',
  args: [] as string[],
  cwdRelative: '',
  moduleRelativePath: '',
  port: undefined as number | undefined,
  dependsOn: [] as string[],
  enabled: true,
  source: 'manual' as any,
  env: [] as FormEnvItem[],
});

watch(
  () => props.serviceData,
  (val) => {
    if (val) {
      form.id = val.id;
      form.runProfileId = val.runProfileId || '';
      form.name = val.name;
      form.type = val.type;
      form.executable = val.executable;
      form.args = [...(val.args || [])];
      form.cwdRelative = val.cwdRelative || '';
      form.moduleRelativePath = val.moduleRelativePath || '';
      form.port = val.port;
      form.dependsOn = [...(val.dependsOn || [])];
      form.enabled = val.enabled ?? true;
      form.source = val.source || 'manual';

      // Parse healthcheck
      if (val.healthCheck?.type === 'http') {
        healthCheckType.value = 'http';
        httpPath.value = val.healthCheck.httpPath || '/health';
        httpPort.value = val.healthCheck.port;
      } else if (val.healthCheck?.type === 'tcp') {
        healthCheckType.value = 'tcp';
      } else {
        healthCheckType.value = 'none';
      }

      // Parse env
      if (val.env && Array.isArray(val.env)) {
        form.env = val.env.map((e) => ({
          key: e.key,
          value: e.isRedacted ? '' : e.value,
          isSecret: !!e.isSecret,
          isRedacted: !!e.isRedacted,
          showPlain: false,
        }));
      } else {
        form.env = [];
      }
    } else {
      // Reset form for create
      form.id = generateId();
      form.runProfileId = '';
      form.name = '';
      form.type = 'custom';
      form.executable = '';
      form.args = [];
      form.cwdRelative = '';
      form.port = undefined;
      form.dependsOn = [];
      form.enabled = true;
      form.source = 'manual';
      form.env = [];
      healthCheckType.value = 'none';
    }
  },
  { immediate: true }
);

const availableDependencyOptions = computed(() => {
  return props.otherServices
    .filter((s) => s.id !== form.id)
    .map((s) => ({
      label: `${s.name} (${s.type})`,
      value: s.name,
    }));
});

function addEnvRow() {
  form.env.push({
    key: '',
    value: '',
    isSecret: false,
    showPlain: true,
  });
}

function removeEnvRow(idx: number) {
  form.env.splice(idx, 1);
}

function handleSave() {
  const envArray = form.env
    .filter((item) => item.key.trim())
    .map((item) => ({
      key: item.key.trim(),
      value: item.value,
      isSecret: item.isSecret,
      ...(item.isRedacted ? { isRedacted: true } : {}),
    }));

  let healthCheck: any = { type: healthCheckType.value };
  if (healthCheckType.value === 'http') {
    healthCheck = {
      type: 'http',
      httpPath: httpPath.value || '/health',
      port: httpPort.value || form.port,
    };
  } else if (healthCheckType.value === 'tcp') {
    healthCheck = {
      type: 'tcp',
      port: form.port,
    };
  }

  const result: ServiceConfigDto = {
    id: form.id || generateId(),
    runProfileId: form.runProfileId,
    name: form.name.trim(),
    type: form.type,
    executable: form.executable.trim(),
    args: form.args,
    cwdRelative: form.cwdRelative.trim(),
    moduleRelativePath: form.moduleRelativePath || '',
    port: form.port,
    portMode: 'fixed',
    dependsOn: form.dependsOn,
    enabled: form.enabled,
    // Saving from this dialog is an explicit user override. Manual services keep
    // their chosen port instead of being silently reassigned at runtime.
    source: 'manual',
    healthCheck,
    env: envArray,
  };

  emit('save', result);
}
</script>
