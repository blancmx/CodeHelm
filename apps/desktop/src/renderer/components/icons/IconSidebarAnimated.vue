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
    <!-- Outer Window Frame with Large Modern Rounded Corners -->
    <rect
      x="2.5"
      y="2.5"
      width="19"
      height="19"
      rx="5"
      class="panel-outer-frame"
    />

    <!-- Left Sidebar Column: Solid Rounded Pill in Expanded, Slim Line in Collapsed (No Arrows) -->
    <rect
      x="4.5"
      y="4.5"
      :width="collapsed ? 2 : 5"
      height="15"
      :rx="collapsed ? 1 : 2.2"
      class="panel-sidebar-pill"
      :class="{ 'is-collapsed': collapsed }"
    />
  </svg>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    size?: number | string;
    strokeWidth?: number | string;
    collapsed?: boolean;
    class?: string;
  }>(),
  {
    size: 16,
    strokeWidth: 1.8,
    collapsed: false,
    class: '',
  }
);
</script>

<style scoped>
.panel-outer-frame {
  transition: stroke 200ms ease;
}

/* Sidebar Pill with smooth width & opacity transition without any bounce or jitter */
.panel-sidebar-pill {
  fill: currentColor;
  stroke: none;
  transition:
    width 200ms ease,
    rx 200ms ease,
    fill-opacity 200ms ease;
}
.panel-sidebar-pill:not(.is-collapsed) {
  fill-opacity: 0.95;
}
.panel-sidebar-pill.is-collapsed {
  fill-opacity: 0.45;
}
</style>
