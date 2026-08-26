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
    class="inline-block flex-shrink-0 align-middle pointer-events-none sun-svg-container"
    :class="{ 'is-active': active }"
  >
    <!-- Sun Core -->
    <circle
      cx="12"
      cy="12"
      r="5"
      class="sun-core"
      :class="{ 'is-active': active }"
    />
    <!-- Sun Rays (Group rotates with spring on hover/active) -->
    <g class="sun-rays" :class="{ 'is-active': active }">
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </g>
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
.sun-core {
  transform-origin: 12px 12px;
  transform: scale(1);
  transition: transform 320ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

:global(.group:hover) .sun-core,
.sun-core.is-active {
  transform: scale(1.18);
}

.sun-rays {
  transform-origin: 12px 12px;
  transform: rotate(0deg);
  transition: transform 500ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

:global(.group:hover) .sun-rays,
.sun-rays.is-active {
  transform: rotate(45deg);
}
</style>
