<template>
  <section class="profile-selector" :class="{ light: !theme.isDark }" aria-label="运行方案管理">
    <div class="profile-toolbar">
      <label for="selected-profile">运行方案</label>
      <n-select
        class="profile-select"
        :value="selectedId ?? ''"
        :options="profileOptions"
        :disabled="dirty || busy"
        size="small"
        placeholder="选择运行方案"
        @update:value="handleSelect"
      />
      <select
        id="selected-profile"
        aria-label="当前运行方案"
        :value="selectedId ?? ''"
        :disabled="dirty || busy"
        class="hidden-accessible-select"
        tabindex="-1"
        @change="emit('select', ($event.target as HTMLSelectElement).value)"
      >
        <option v-if="!profiles.length" value="">尚无方案</option>
        <option v-for="profile in profiles" :key="profile.id" :value="profile.id">{{ profile.name }}{{ profile.isDefault ? ' · 默认' : '' }}</option>
      </select>
      <n-button size="small" :disabled="dirty || busy" @click="open('create')">新建方案</n-button>
      <n-button size="small" :disabled="dirty || busy || !selectedId" @click="open('copy')">复制方案</n-button>
      <n-button size="small" :disabled="dirty || busy || !selectedId || running" @click="open('remove')">删除方案</n-button>
    </div>
    <p v-if="dirty" class="profile-hint">有未保存修改，请先保存或 <button class="discard" @click="emit('select', selectedId!)">放弃修改</button> 后切换方案。</p>
    <p v-if="running" class="profile-hint">此方案正在运行，修改仅在下次启动生效。停止会话后可删除方案。</p>
    <n-modal v-model:show="show" preset="dialog" :title="action === 'remove' ? '删除运行方案' : action === 'copy' ? '复制运行方案' : '新建运行方案'"
      :positive-text="action === 'remove' ? '删除方案' : '保存方案'" negative-text="取消" :loading="busy" @positive-click="submit">
      <p v-if="action === 'remove'">删除后无法再启动此方案，已有运行历史会保留。</p>
      <template v-else>
        <label for="new-profile-name">方案名称</label>
        <n-input v-model:value="name" :input-props="{ id: 'new-profile-name', 'aria-label': '方案名称' }" :maxlength="100" @keyup.enter="submit" />
        <p v-if="action === 'copy'" class="profile-hint">复制已保存的服务与依赖配置，新方案独立编辑，首次启动需要重新确认。</p>
      </template>
      <p v-if="error" role="alert" class="text-rose-500 mt-2">{{ error }}</p>
    </n-modal>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { RunProfileDto } from '@codehelm/contracts';
import { useThemeStore } from '../stores/themeStore.js';
import { displayIpcError } from '../utils/ipc-error.js';
const props = defineProps<{ projectId: string; profiles: RunProfileDto[]; selectedId?: string; dirty: boolean; running: boolean }>();
const emit = defineEmits<{ select: [id: string]; changed: [id?: string] }>();
const theme = useThemeStore();
const show = ref(false), busy = ref(false), name = ref(''), error = ref('');
const action = ref<'create' | 'copy' | 'remove'>('create');

const profileOptions = computed(() => {
  if (!props.profiles.length) {
    return [{ label: '尚无方案', value: '' }];
  }
  return props.profiles.map(profile => ({
    label: `${profile.name}${profile.isDefault ? ' · 默认' : ''}`,
    value: profile.id
  }));
});

function handleSelect(id: string) {
  emit('select', id);
}

function open(value: typeof action.value) {
  action.value = value; error.value = '';
  name.value = value === 'copy' ? `${props.profiles.find(p => p.id === props.selectedId)?.name ?? '方案'} 副本`.slice(0, 100) : '新运行方案';
  show.value = true;
}
async function submit() {
  if (busy.value) return false;
  if (action.value !== 'remove' && !name.value.trim()) { error.value = '请输入方案名称。'; return false; }
  busy.value = true; error.value = '';
  try {
    let selected: string | undefined;
    if (action.value === 'remove') await window.codehelm.profiles.remove(props.selectedId!);
    else if (action.value === 'copy') selected = (await window.codehelm.profiles.copy(props.selectedId!, name.value.trim())).id;
    else selected = (await window.codehelm.profiles.save({ projectId: props.projectId, name: name.value.trim(), isDefault: !props.profiles.length, failurePolicy: 'block_dependents', services: [] })).id;
    show.value = false; emit('changed', selected);
  } catch (err) { error.value = displayIpcError(err, '方案操作失败'); }
  finally { busy.value = false; }
  return false;
}
</script>

<style scoped>
.profile-selector { margin-bottom: 12px; padding: 12px 16px; border: 1px solid #27272a; border-radius: 12px; background: #121216; color: #e4e4e7; }
.profile-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 13px; }
.profile-select { flex: 1; min-width: 160px; max-width: 440px; }
.hidden-accessible-select {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
  opacity: 0;
  pointer-events: none;
}
.discard:focus-visible { outline: 2px solid #a1a1aa; outline-offset: 2px; }
.profile-hint { margin-top: 8px; font-size: 12px; line-height: 1.6; }
.discard { text-decoration: underline; cursor: pointer; }
.light { background: white; color: #27272a; border-color: #d4d4d8; }
</style>
