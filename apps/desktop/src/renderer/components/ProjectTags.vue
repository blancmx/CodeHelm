<template>
  <div class="project-tags-container flex items-center flex-nowrap gap-2 text-xs whitespace-nowrap">
    <!-- Header Label -->
    <div
      class="flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap select-none flex-shrink-0"
      :class="themeStore.isDark ? 'text-zinc-300' : 'text-zinc-700'"
    >
      <svg class="w-3.5 h-3.5 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
        <line x1="7" y1="7" x2="7.01" y2="7"></line>
      </svg>
      <span>项目标签</span>
    </div>

    <!-- Modern Pill Tags (Strictly on 1 row, max 2 or 3 visible) -->
    <div v-if="tags.length > 0" class="flex items-center flex-nowrap gap-1.5 flex-shrink-0">
      <span
        v-for="tag in visibleTags"
        :key="tag"
        class="project-pill-tag inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors shadow-xs select-none flex-shrink-0"
        :class="getTagColorClass(tag)"
      >
        <span class="max-w-[140px] truncate" :title="tag">{{ tag }}</span>
        <button
          type="button"
          class="hover:text-red-400 opacity-60 hover:opacity-100 text-xs leading-none font-bold ml-0.5 cursor-pointer transition-colors"
          :disabled="busy"
          title="移除标签"
          @click="removeTag(tag)"
        >×</button>
      </span>

      <!-- Overflow +N Badge with Popover (Inline on same row, click to toggle/collapse) -->
      <n-popover
        v-if="overflowTags.length > 0"
        v-model:show="isPopoverOpen"
        trigger="click"
        placement="bottom"
        :show-arrow="true"
      >
        <template #trigger>
          <button
            type="button"
            class="project-pill-tag inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border transition-all cursor-pointer shadow-xs select-none flex-shrink-0"
            :class="isPopoverOpen
              ? (themeStore.isDark ? 'bg-zinc-700 border-zinc-600 text-white' : 'bg-zinc-300/80 border-zinc-400 text-zinc-950')
              : (themeStore.isDark ? 'bg-zinc-800/90 border-zinc-700 text-zinc-300 hover:bg-zinc-700 hover:text-white' : 'bg-zinc-100 border-zinc-300 text-zinc-700 hover:bg-zinc-200 hover:text-zinc-900')"
          >
            <span>+{{ overflowTags.length }}</span>
            <svg
              class="w-3 h-3 opacity-70 transition-transform duration-200"
              :class="{ 'rotate-180': isPopoverOpen }"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
        </template>

        <div class="space-y-2 max-w-xs select-none font-sans py-0.5">
          <div
            class="text-xs font-semibold pb-1.5 border-b"
            :class="themeStore.isDark ? 'border-zinc-800 text-zinc-400' : 'border-zinc-200/80 text-zinc-500'"
          >
            <span>更多项目标签 ({{ overflowTags.length }})</span>
          </div>
          <div class="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto pr-1">
            <span
              v-for="tag in overflowTags"
              :key="tag"
              class="project-pill-tag inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors shadow-xs"
              :class="getTagColorClass(tag)"
            >
              <span class="max-w-[140px] truncate" :title="tag">{{ tag }}</span>
              <button
                type="button"
                class="hover:text-red-400 opacity-60 hover:opacity-100 text-xs leading-none font-bold ml-0.5 cursor-pointer transition-colors"
                :disabled="busy"
                title="移除标签"
                @click="removeTag(tag)"
              >×</button>
            </span>
          </div>
        </div>
      </n-popover>
    </div>
    <span v-else class="text-xs text-zinc-500 italic flex-shrink-0">暂无标签</span>

    <!-- Dropdown to pick existing tags across workspace -->
    <n-select
      ref="selectRef"
      aria-label="项目标签"
      v-model:value="selectedDropdownTag"
      size="small"
      :options="selectOptions"
      class="w-24 project-tag-select font-sans flex-shrink-0"
      placeholder="已有标签 ▾"
      :disabled="busy"
      :show-checkmark="false"
      @update:value="handleDropdownSelect"
    />

    <!-- Quick input for new tag -->
    <n-input
      v-model:value="newTag"
      size="small"
      class="!w-20 font-sans flex-shrink-0"
      placeholder="新标签"
      :input-props="{'aria-label':'新标签'}"
      :disabled="busy"
      @keyup.enter="handleEnterAdd"
    />

    <!-- Save Button -->
    <n-button
      size="small"
      type="primary"
      secondary
      :loading="busy"
      class="font-medium font-sans flex-shrink-0"
      @click="save"
    >保存标签</n-button>

    <!-- Feedback Message -->
    <span
      v-if="feedback"
      role="status"
      class="text-xs ml-1 font-medium whitespace-nowrap transition-opacity flex-shrink-0"
      :class="feedback.includes('已保存') ? 'text-emerald-500' : 'text-amber-500'"
    >
      {{ feedback }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { SelectInst } from 'naive-ui';
import type { ProjectDto } from '@codehelm/contracts';
import { useProjectStore } from '../stores/projectStore.js';
import { useThemeStore } from '../stores/themeStore.js';

const props = defineProps<{ project: ProjectDto }>();
const store = useProjectStore();
const themeStore = useThemeStore();
const selectRef = ref<SelectInst | null>(null);

const tags = ref<string[]>([]);
const busy = ref(false);
const feedback = ref('');
const newTag = ref('');
const selectedDropdownTag = ref<string | null>(null);
const isPopoverOpen = ref(false);

const visibleTags = computed(() => {
  if (tags.value.length <= 3) return tags.value;
  return tags.value.slice(0, 2);
});

const overflowTags = computed(() => {
  if (tags.value.length <= 3) return [];
  return tags.value.slice(2);
});

const allExistingTags = computed(() => [...new Set(store.projects.flatMap(p => p.tags))]);
const selectOptions = computed(() => {
  const unassigned = allExistingTags.value.filter(t => !tags.value.includes(t));
  if (unassigned.length === 0) {
    return [{ label: '无其他标签', value: '', disabled: true }];
  }
  return unassigned.map(tag => ({ label: tag, value: tag }));
});

function getTagColorClass(name: string) {
  const isDark = themeStore.isDark;
  const hash = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const palettes = [
    isDark ? 'bg-blue-500/15 border-blue-500/30 text-blue-300 hover:bg-blue-500/25' : 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100',
    isDark ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25' : 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100',
    isDark ? 'bg-purple-500/15 border-purple-500/30 text-purple-300 hover:bg-purple-500/25' : 'bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100',
    isDark ? 'bg-amber-500/15 border-amber-500/30 text-amber-300 hover:bg-amber-500/25' : 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100',
    isDark ? 'bg-cyan-500/15 border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/25' : 'bg-cyan-50 border-cyan-200 text-cyan-700 hover:bg-cyan-100',
  ];
  return palettes[hash % palettes.length];
}

function addTagInternal(): boolean {
  const tag = newTag.value.trim();
  if (!tag) return false;
  if (tag.length > 40 || tags.value.length >= 30) {
    feedback.value = '每个标签最多 40 字，最多保存 30 个标签';
    return false;
  }
  if (!tags.value.includes(tag)) {
    tags.value = [...tags.value, tag];
  }
  newTag.value = '';
  return true;
}

async function handleEnterAdd() {
  if (addTagInternal()) {
    await save();
  }
}

function handleDropdownSelect(value: string | null) {
  if (value && !tags.value.includes(value)) {
    tags.value = [...tags.value, value];
    save();
  }
  selectedDropdownTag.value = null;
}

async function removeTag(tagToRemove: string) {
  tags.value = tags.value.filter(t => t !== tagToRemove);
  await save();
}

watch(
  () => props.project,
  value => {
    tags.value = [...value.tags];
    isPopoverOpen.value = false;
  },
  { immediate: true }
);

async function save() {
  if (newTag.value.trim()) {
    addTagInternal();
  }
  busy.value = true;
  try {
    if (!await store.updateProject(props.project.id, { tags: tags.value })) {
      throw new Error('项目已移除');
    }
    feedback.value = '标签已保存';
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : String(error);
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.project-tags-container {
  white-space: nowrap !important;
}

.project-tags-container,
.project-tags-container :deep(*) {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "微软雅黑", sans-serif !important;
}

.project-pill-tag {
  line-height: 1.25rem;
}
</style>
