<template>
  <div class="flex flex-wrap items-center gap-2 py-1" @click.stop>
    <n-checkbox :checked="selected" :disabled="busy" :aria-label="`选择项目 ${project.name}`" @update:checked="$emit('select', $event)" />
    <n-button size="tiny" quaternary :disabled="busy" :aria-label="`${project.favorite ? '取消收藏' : '收藏'} ${project.name}`" :aria-pressed="!!project.favorite" @click="update({ favorite: !project.favorite })">{{ project.favorite ? '已收藏' : '收藏' }}</n-button>
    <n-button size="tiny" quaternary :disabled="busy" @click="update({ archived: !project.archived })">{{ project.archived ? '取消归档' : '归档' }}</n-button>
  </div>
</template>
<script setup lang="ts">
import { ref } from 'vue';
import type { ProjectSummaryDto, UpdateProjectInput } from '@codehelm/contracts';
import { useProjectStore } from '../stores/projectStore.js';
import { message } from '../utils/discrete.js';
const props = defineProps<{ project: ProjectSummaryDto; selected: boolean }>();
defineEmits<{ select: [selected: boolean] }>();
const store = useProjectStore();
const busy = ref(false);
async function update(patch: UpdateProjectInput) {
  busy.value = true;
  try {
    if (!await store.updateProject(props.project.id, patch)) throw new Error('项目已移除，请刷新。');
    message.success(patch.archived === undefined ? '收藏状态已保存' : '归档状态已保存；运行中的服务继续保留在运行中心');
  } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
  finally { busy.value = false; }
}
</script>
