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

    <!-- Left Sidebar Column: Solid Pill in Expanded, Slim Line in Collapsed -->
    <rect
      x="4.5"
      y="4.5"
      :width="collapsed ? 2 : 4.5"
      height="15"
      :rx="collapsed ? 1 : 2.2"
      class="panel-sidebar-pill"
      :class="{ 'is-collapsed': collapsed }"
    />

    <!-- Expanded State: Collapse-Left Arrow "<" -->
    <path
      d="M15.5 9L12.5 12L15.5 15"
      class="collapse-left-arrow"
      :class="{ 'is-collapsed': collapsed }"
    />

    <!-- Collapsed State: Expand-Right Arrow ">" -->
    <path
      d="M11.5 9L14.5 12L11.5 15"
      class="expand-right-arrow"
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

/* Sidebar Pill */
.panel-sidebar-pill {
  fill: currentColor;
  stroke: none;
  transition:
    all 280ms cubic-bezier(0.34, 1.56, 0.64, 1),
    fill-opacity 200ms ease;
}
.panel-sidebar-pill:not(.is-collapsed) {
  fill-opacity: 0.95;
}
.panel-sidebar-pill.is-collapsed {
  fill-opacity: 0.45;
}

/* Collapse Left Arrow (Visible in Expanded Mode) */
.collapse-left-arrow {
  stroke-width: 2;
  opacity: 1;
  transform: translateX(0);
  transition:
    opacity 200ms ease,
    transform 280ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
.collapse-left-arrow.is-collapsed {
  opacity: 0;
  transform: translateX(3px);
  pointer-events-none;
}

/* Expand Right Arrow (Visible in Collapsed Mode) */
.expand-right-arrow {
  stroke-width: 2;
  opacity: 0;
  transform: translateX(-3px);
  transition:
    opacity 200ms ease,
    transform 280ms cubic-bezier(0.34, 1.56, 0.64, 1);
  pointer-events-none;
}
.expand-right-arrow.is-collapsed {
  opacity: 1;
  transform: translateX(0);
  pointer-events-auto;
}

/* Dynamic Directional Hover micro-animations */
:global(.group\/toggle:hover) .collapse-left-arrow:not(.is-collapsed) {
  transform: translateX(-1.5px);
}

:global(.group\/toggle:hover) .expand-right-arrow.is-collapsed {
  transform: translateX(1.5px);
}
</style>
