<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="inline-block flex-shrink-0 align-middle trash-svg pointer-events-none"
    :class="$props.class"
  >
    <!-- Trash Can Lid (Opens from right to left upwards around left hinge) -->
    <g class="trash-lid" :class="{ 'is-open': open }">
      <!-- Horizontal Top Rim -->
      <line x1="3" y1="6" x2="21" y2="6" />
      <!-- Top Handle -->
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </g>

    <!-- Trash Can Body & Ribs (Fixed base) -->
    <g class="trash-body">
      <!-- Main Bin Outer -->
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <!-- Vertical Inner Ribs -->
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </g>
  </svg>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    size?: number | string;
    strokeWidth?: number | string;
    open?: boolean;
    class?: string;
  }>(),
  {
    size: 14,
    strokeWidth: 1.8,
    open: false,
    class: '',
  }
);
</script>

<style scoped>
.trash-svg {
  overflow: visible !important;
}

.trash-lid {
  transform-box: fill-box;
  transform-origin: 10% 100%;
  transform: rotate(0deg);
  transition: transform 240ms cubic-bezier(0.34, 1.56, 0.64, 1);
  will-change: transform;
}

.trash-lid.is-open {
  transform: rotate(-16deg) translate(-0.3px, -0.5px);
}
</style>
