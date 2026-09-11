<template>
  <button
    type="button"
    role="checkbox"
    :aria-checked="!!selected"
    :aria-label="`${selected ? '取消选择' : '选择'}项目 ${project.name}`"
    :title="selected ? '取消选择' : '选择项目'"
    :disabled="disabled"
    class="project-avatar-checkbox group/avatar relative flex items-center justify-center font-bold flex-shrink-0 border font-mono select-none outline-none transition-all duration-200"
    :class="[
      size === 'md' ? 'w-10 h-10 rounded-xl text-sm' : 'w-7 h-7 rounded-lg text-xs',
      selected
        ? 'bg-emerald-500 border-emerald-500 text-white shadow-sm shadow-emerald-500/30'
        : [
            themeStore.isDark
              ? 'bg-[#18181b] border-[#27272a] text-white hover:border-emerald-500/60 hover:bg-[#1e1e24]'
              : 'bg-zinc-100 border-zinc-200 text-zinc-900 hover:border-emerald-500/60 hover:bg-zinc-50',
            'hover:scale-105 active:scale-95 cursor-pointer',
          ],
    ]"
    @click.stop="$emit('select', !selected)"
  >
    <!-- State 1 & 2: Normal Monogram Letters & Hover Ghost Checkmark -->
    <template v-if="!selected">
      <span
        class="transition-all duration-150 group-hover/avatar:opacity-0 group-hover/avatar:scale-75 select-none"
      >
        {{ monogram }}
      </span>

      <!-- Hover ghost checkmark: reveals smoothly on avatar hover -->
      <div
        class="absolute inset-0 flex items-center justify-center opacity-0 scale-75 group-hover/avatar:opacity-100 group-hover/avatar:scale-100 transition-all duration-150 text-emerald-600 dark:text-emerald-400 pointer-events-none"
      >
        <IconCheck
          :size="size === 'md' ? 18 : 13"
          stroke-width="2.6"
        />
      </div>
    </template>

    <!-- State 3: Selected State (Solid Emerald Green Badge with Crisp White Checkmark) -->
    <template v-else>
      <div
        class="selected-check-bounce flex items-center justify-center w-full h-full text-white pointer-events-none"
      >
        <IconCheck
          :size="size === 'md' ? 20 : 14"
          stroke-width="2.8"
          style="color: #ffffff !important; stroke: #ffffff !important;"
        />
      </div>
    </template>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ProjectSummaryDto } from '@codehelm/contracts';
import { useThemeStore } from '../stores/themeStore.js';
import { IconCheck } from './icons/index.js';

const props = withDefaults(
  defineProps<{
    project: ProjectSummaryDto;
    selected?: boolean;
    size?: 'sm' | 'md';
    disabled?: boolean;
  }>(),
  {
    selected: false,
    size: 'sm',
    disabled: false,
  }
);

defineEmits<{ select: [selected: boolean] }>();
const themeStore = useThemeStore();

const monogram = computed(() => (props.project.name || 'P').slice(0, 2).toUpperCase());
</script>

<style scoped>
.project-avatar-checkbox:focus-visible {
  outline: 2px solid #10b981;
  outline-offset: 2px;
}

.selected-check-bounce {
  animation: avatar-check-pop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

@keyframes avatar-check-pop {
  0% {
    transform: scale(0.6) rotate(-15deg);
    opacity: 0;
  }
  60% {
    transform: scale(1.2) rotate(4deg);
    opacity: 1;
  }
  100% {
    transform: scale(1) rotate(0deg);
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .selected-check-bounce {
    animation: none !important;
  }
  .project-avatar-checkbox {
    transition: none !important;
  }
}
</style>
