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
    class="inline-block flex-shrink-0 align-middle pointer-events-none monitor-svg-container"
    :class="{ 'is-active': active }"
  >
    <!-- Screen Frame -->
    <rect
      x="2"
      y="3"
      width="20"
      height="14"
      rx="2"
      class="monitor-screen"
      :class="{ 'is-active': active }"
    />
    <!-- Screen Scan/Signal Line -->
    <line
      x1="6"
      y1="9"
      x2="14"
      y2="9"
      class="monitor-scanline"
      :class="{ 'is-active': active }"
    />
    <!-- Base & Stand -->
    <line x1="8" y1="21" x2="16" y2="21" class="monitor-base" :class="{ 'is-active': active }" />
    <line x1="12" y1="17" x2="12" y2="21" class="monitor-stand" :class="{ 'is-active': active }" />
  </svg>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    size?: number | string;
    strokeWidth?: number | string;
    active?: boolean;
  }>(),
  {
    size: 20,
    strokeWidth: 1.8,
    active: false,
  }
);
</script>

<style scoped>
.monitor-screen {
  transform-origin: 12px 10px;
  transform: scale(1);
  transition: transform 320ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

:global(.group:hover) .monitor-screen,
.monitor-screen.is-active {
  transform: scale(1.08) translateY(-1px);
}

.monitor-scanline {
  opacity: 0;
  stroke-dasharray: 8;
  stroke-dashoffset: 8;
  transition: all 300ms ease;
}

:global(.group:hover) .monitor-scanline,
.monitor-scanline.is-active {
  opacity: 0.9;
  stroke-dashoffset: 0;
  transition-delay: 80ms;
}

.monitor-stand,
.monitor-base {
  transition: transform 320ms cubic-bezier(0.34, 1.56, 0.64, 1);
  transform-origin: 12px 21px;
}

:global(.group:hover) .monitor-base,
.monitor-base.is-active {
  transform: scaleX(1.15);
}
</style>
