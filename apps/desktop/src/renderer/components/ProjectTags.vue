<template>
  <div class="flex flex-wrap items-center gap-2 my-2 text-xs">
    <span>项目标签</span>
    <n-select
      ref="selectRef"
      aria-label="项目标签"
      v-model:value="tags"
      :show="isMenuOpen"
      multiple
      filterable
      :options="options"
      :max-tag-count="2"
      :ellipsis-tag-popover-props="{ placement: 'bottom' }"
      class="w-64 project-tag-select"
      :class="{ 'select-expanded': isMenuOpen }"
      placeholder="选择或移除已有标签"
      :disabled="busy"
      @mousedown="handleMouseDown"
      @click="handleClick"
      @update:show="handleShowChange"
    />
    <n-input v-model:value="newTag" style="width: 10rem" placeholder="新标签" :input-props="{'aria-label':'新标签'}" :disabled="busy" @keyup.enter="addTag" />
    <n-button size="small" :disabled="busy || !newTag.trim()" @click="addTag">添加标签</n-button>
    <n-button size="small" :loading="busy" @click="save">保存标签</n-button>
    <span v-if="feedback" role="status">{{ feedback }}</span>
  </div>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { SelectInst } from 'naive-ui';
import type { ProjectDto } from '@codehelm/contracts';
import { useProjectStore } from '../stores/projectStore.js';
const props = defineProps<{project:ProjectDto}>();
const store = useProjectStore();
const selectRef = ref<SelectInst | null>(null);
const tags = ref<string[]>([]), busy = ref(false), feedback = ref('');
const newTag = ref('');
const isMenuOpen = ref(false);
let wasOpenOnMouseDown = false;

function handleShowChange(show: boolean) {
  isMenuOpen.value = show;
  if (!show) {
    wasOpenOnMouseDown = false;
  }
}

function handleMouseDown(e: MouseEvent) {
  const target = e.target as HTMLElement | null;
  if (target?.closest('.n-tag__close, .n-base-close')) {
    wasOpenOnMouseDown = false;
    return;
  }
  wasOpenOnMouseDown = isMenuOpen.value;
}

function handleClick(e: MouseEvent) {
  const target = e.target as HTMLElement | null;
  if (target?.closest('.n-tag__close, .n-base-close')) {
    return;
  }
  if (wasOpenOnMouseDown) {
    isMenuOpen.value = false;
    wasOpenOnMouseDown = false;
    selectRef.value?.blurInput();
  }
}
const options = computed(() => [...new Set([...store.projects.flatMap(p => p.tags),...tags.value])].map(tag => ({label:tag,value:tag})));
function addTag() {
  const tag = newTag.value.trim();
  if (!tag) return;
  if (tag.length > 40 || tags.value.length >= 30) { feedback.value = '每个标签最多 40 字，最多保存 30 个标签'; return; }
  tags.value = [...new Set([...tags.value,tag])]; newTag.value = ''; feedback.value = '标签尚未保存';
}
watch(() => props.project, value => { tags.value = [...value.tags]; isMenuOpen.value = false; }, {immediate:true});
async function save() {
  busy.value = true;
  try {
    if (!await store.updateProject(props.project.id, {tags: tags.value})) throw new Error('项目已移除');
    feedback.value = '标签已保存';
  } catch (error) { feedback.value = error instanceof Error ? error.message : String(error); }
  finally { busy.value = false; }
}
</script>
<style scoped>
.project-tag-select :deep(.n-base-selection-tags) {
  flex-wrap: nowrap !important;
  overflow: hidden;
  align-items: center;
}

.project-tag-select :deep(.n-base-selection-tag-wrapper) {
  flex-shrink: 1;
  min-width: 0;
  max-width: 45%;
}

.project-tag-select :deep(.n-base-selection-input-tag) {
  flex-shrink: 0;
  min-width: 20px;
}

.project-tag-select.select-expanded :deep(.n-base-selection-tag-wrapper:not(:has(.n-tag__close))),
.project-tag-select.select-expanded :deep(.n-base-selection-tag-wrapper:nth-child(n+3)),
.project-tag-select:has(.n-base-selection--active) :deep(.n-base-selection-tag-wrapper:not(:has(.n-tag__close))),
.project-tag-select:has(.n-base-selection--active) :deep(.n-base-selection-tag-wrapper:nth-child(n+3)) {
  display: none !important;
}
</style>
