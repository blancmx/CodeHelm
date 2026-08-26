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
    <!-- Lightning Bolt Body: Outline initially, charges with Solid Fill + Energy Tilt on Hover -->
    <polygon
      points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"
      class="zap-body"
      :class="{ 'is-active': hovered }"
    />

    <!-- Top Right Spark Particle -->
    <line
      x1="18"
      y1="3"
      x2="21"
      y2="1"
      class="spark-line"
      :class="{ 'is-active': hovered }"
    />

    <!-- Bottom Left Spark Particle -->
    <line
      x1="5"
      y1="21"
      x2="2"
      y2="23"
      class="spark-line"
      :class="{ 'is-active': hovered }"
    />
  </svg>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    size?: number | string;
    strokeWidth?: number | string;
    hovered?: boolean;
    isRunning?: boolean;
    class?: string;
  }>(),
  {
    size: 16,
    strokeWidth: 1.8,
    hovered: false,
    isRunning: false,
    class: '',
  }
);
</script>

<style scoped>
.zap-body {
  transform-origin: 12px 12px;
  fill: currentColor;
  fill-opacity: 0;
  transform: scale(1) rotate(0deg);
  transition:
    transform 280ms cubic-bezier(0.34, 1.56, 0.64, 1),
    fill-opacity 200ms ease;
  will-change: transform, fill-opacity;
}

/* Hover effect: Instant solid energy fill + energetic spring tilt */
.zap-body.is-active,
:global(.group:hover) .zap-body {
  fill-opacity: 1;
  transform: scale(1.15) rotate(-10deg);
}

.spark-line {
  opacity: 0;
  transform-origin: 12px 12px;
  transform: scale(0.2);
  transition:
    opacity 220ms ease,
    transform 280ms cubic-bezier(0.34, 1.56, 0.64, 1);
  stroke-width: 2;
}

.spark-line.is-active,
:global(.group:hover) .spark-line {
  opacity: 1;
  transform: scale(1);
}
</style>
