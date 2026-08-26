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
    class="inline-block flex-shrink-0 align-middle pointer-events-none"
    :class="$props.class"
  >
    <!-- Top-Left Fixed Block -->
    <rect x="3" y="3" width="7" height="7" rx="1.5" />

    <!-- Top-Right Fixed Block -->
    <rect x="14" y="3" width="7" height="7" rx="1.5" />

    <!-- Bottom-Left Fixed Block -->
    <rect x="3" y="14" width="7" height="7" rx="1.5" />

    <!-- Bottom-Right Block: Detached in initial state, smoothly docks to (0,0) when hovered -->
    <rect
      x="14"
      y="14"
      width="7"
      height="7"
      rx="1.5"
      class="dock-piece"
      :style="{
        transform: hovered ? 'translate(0px, 0px)' : undefined,
      }"
    />
  </svg>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    size?: number | string;
    strokeWidth?: number | string;
    hovered?: boolean;
    class?: string;
  }>(),
  {
    size: 16,
    strokeWidth: 1.8,
    hovered: false,
    class: '',
  }
);
</script>

<style scoped>
.dock-piece {
  /* Default initial state: Detached outwards */
  transform: translate(2.5px, 2.5px);
  transition: transform 260ms cubic-bezier(0.16, 1, 0.3, 1);
  will-change: transform;
}

/* Snaps together when the parent link is hovered via CSS */
:global(.group:hover) .dock-piece {
  transform: translate(0px, 0px) !important;
}
</style>
