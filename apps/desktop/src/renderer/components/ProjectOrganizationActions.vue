<template>
  <div class="flex items-center gap-1.5" @click.stop>
    <n-button
      v-if="mode !== 'actions-only'"
      size="tiny"
      quaternary
      circle
      role="checkbox"
      :disabled="busy"
      :aria-label="`${selected ? '取消选择' : '选择'}项目 ${project.name}`"
      :aria-checked="!!selected"
      :title="selected ? '取消选择' : '选择项目'"
      class="project-organization-action transition-transform duration-150 hover:scale-110 active:scale-95 flex-shrink-0"
      @click="$emit('select', !selected)"
    >
      <template #icon>
        <div
          v-if="selected"
          class="w-[15px] h-[15px] rounded-full flex items-center justify-center bg-emerald-500 text-white shadow-sm shadow-emerald-500/25 transition-colors"
        >
          <IconCheck :size="10" stroke-width="3" style="color: #ffffff !important; stroke: #ffffff !important;" />
        </div>
        <IconCheck
          v-else
          :size="14"
          stroke-width="2.2"
          class="text-zinc-400 hover:text-emerald-500 dark:text-zinc-500 dark:hover:text-emerald-400 transition-colors"
        />
      </template>
    </n-button>
    <n-button
      v-if="mode !== 'select-only'"
      size="tiny"
      quaternary
      circle
      :disabled="busy"
      :aria-label="`${project.favorite ? '取消收藏' : '收藏'} ${project.name}`"
      :aria-pressed="!!project.favorite"
      :title="project.favorite ? '取消收藏' : '收藏'"
      class="project-organization-action transition-transform duration-150 hover:scale-110 active:scale-95 flex-shrink-0"
      :style="project.favorite ? 'color: #facc15 !important;' : ''"
      @click="onToggleFavorite"
    >
      <template #icon>
        <IconStar
          :size="14"
          :filled="!!project.favorite"
          :style="project.favorite ? 'color: #facc15 !important; stroke: #facc15 !important;' : ''"
          class="action-icon action-icon-star"
          :class="[
            isStarActivating && 'is-animating',
            project.favorite
              ? 'is-active text-yellow-400 dark:text-yellow-300 drop-shadow-[0_1px_2px_rgba(250,204,21,0.25)]'
              : 'text-zinc-400 hover:text-yellow-400 dark:text-zinc-500 dark:hover:text-yellow-300',
          ]"
        />
      </template>
    </n-button>
    <n-button
      v-if="mode !== 'select-only'"
      size="tiny"
      quaternary
      circle
      :disabled="busy"
      :aria-label="project.archived ? '取消归档' : '归档'"
      :aria-pressed="!!project.archived"
      :title="project.archived ? '取消归档' : '归档'"
      class="project-organization-action transition-transform duration-150 hover:scale-110 active:scale-95 flex-shrink-0"
      :style="project.archived ? 'color: #0ea5e9 !important;' : ''"
      @click="onToggleArchive"
    >
      <template #icon>
        <IconArchive
          :size="14"
          :filled="!!project.archived"
          :style="project.archived ? 'color: #0ea5e9 !important; stroke: #0ea5e9 !important;' : ''"
          class="action-icon action-icon-archive"
          :class="[
            isArchiveActivating && 'is-animating',
            project.archived
              ? 'is-active text-sky-500 dark:text-sky-400'
              : 'text-zinc-400 hover:text-sky-500 dark:text-zinc-500 dark:hover:text-sky-400',
          ]"
        />
      </template>
    </n-button>
  </div>
</template>
<script setup lang="ts">
import { ref, watch } from 'vue';
import type { ProjectSummaryDto, UpdateProjectInput } from '@codehelm/contracts';
import { useProjectStore } from '../stores/projectStore.js';
import { message } from '../utils/discrete.js';
import { IconStar, IconCheck, IconArchive } from './icons/index.js';

const props = withDefaults(
  defineProps<{
    project: ProjectSummaryDto;
    selected?: boolean;
    mode?: 'all' | 'select-only' | 'actions-only';
  }>(),
  {
    selected: false,
    mode: 'all',
  }
);
defineEmits<{ select: [selected: boolean] }>();
const store = useProjectStore();
const busy = ref(false);

const isStarActivating = ref(false);
const isArchiveActivating = ref(false);

function triggerStarAnimation() {
  isStarActivating.value = true;
  setTimeout(() => {
    isStarActivating.value = false;
  }, 480);
}

function triggerArchiveAnimation() {
  isArchiveActivating.value = true;
  setTimeout(() => {
    isArchiveActivating.value = false;
  }, 440);
}

async function onToggleFavorite() {
  if (busy.value) return;
  if (!props.project.favorite) {
    triggerStarAnimation();
  }
  await update({ favorite: !props.project.favorite });
}

async function onToggleArchive() {
  if (busy.value) return;
  if (!props.project.archived) {
    triggerArchiveAnimation();
  }
  await update({ archived: !props.project.archived });
}

watch(
  () => props.project.favorite,
  (newVal, oldVal) => {
    if (oldVal === false && newVal === true && !isStarActivating.value) {
      triggerStarAnimation();
    }
  }
);

watch(
  () => props.project.archived,
  (newVal, oldVal) => {
    if (oldVal === false && newVal === true && !isArchiveActivating.value) {
      triggerArchiveAnimation();
    }
  }
);

async function update(patch: UpdateProjectInput) {
  if (busy.value) return;
  busy.value = true;
  try {
    if (!await store.updateProject(props.project.id, patch)) throw new Error('项目已移除，请刷新。');
    message.success(patch.archived === undefined ? '收藏状态已保存' : '归档状态已保存；运行中的服务继续保留在运行中心');
  } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
  finally { busy.value = false; }
}
</script>

<style scoped>
/* Ensure button contents do not clip spring animations */
.project-organization-action {
  overflow: visible !important;
}

.project-organization-action :deep(.n-button__content) {
  overflow: visible !important;
}

/* Prevent momentary dimming flicker when button is busy */
.project-organization-action.n-button--disabled {
  opacity: 1 !important;
}

/* Base style and smooth transition for action icons */
.action-icon {
  transform-origin: 50% 50%;
  transition: transform 0.26s cubic-bezier(0.34, 1.56, 0.64, 1),
              color 0.28s cubic-bezier(0.4, 0, 0.2, 1),
              stroke 0.28s cubic-bezier(0.4, 0, 0.2, 1),
              filter 0.28s cubic-bezier(0.4, 0, 0.2, 1);
  will-change: transform;
}

/* Star spring bounce animation when activated */
.action-icon-star.is-animating {
  animation: star-spring-bounce 0.46s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

@keyframes star-spring-bounce {
  0% {
    transform: scale(0.76) rotate(-14deg);
  }
  42% {
    transform: scale(1.32) rotate(6deg);
  }
  72% {
    transform: scale(0.93) rotate(-2deg);
  }
  100% {
    transform: scale(1) rotate(0deg);
  }
}

/* Archive tactile bounce animation when activated */
.action-icon-archive.is-animating {
  animation: archive-spring-bounce 0.42s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

@keyframes archive-spring-bounce {
  0% {
    transform: scale(0.85) translateY(1.5px);
  }
  42% {
    transform: scale(1.24) translateY(-2px);
  }
  72% {
    transform: scale(0.95) translateY(0.5px);
  }
  100% {
    transform: scale(1) translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .action-icon-star.is-animating,
  .action-icon-archive.is-animating {
    animation: none !important;
  }
  .action-icon {
    transition: none !important;
  }
}
</style>
