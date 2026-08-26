<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    :class="`inline-block flex-shrink-0 align-middle ${customClass}`"
  >
    <!-- Outer Helm Steering Ring -->
    <circle cx="12" cy="12" r="6.8" />

    <!-- 4 Cardinal Handles -->
    <line x1="12" y1="1.8" x2="12" y2="5.2" />
    <line x1="12" y1="18.8" x2="12" y2="22.2" />
    <line x1="1.8" y1="12" x2="5.2" y2="12" />
    <line x1="18.8" y1="12" x2="22.2" y2="12" />

    <!-- 4 Diagonal Handles -->
    <line x1="4.79" y1="4.79" x2="7.19" y2="7.19" />
    <line x1="19.21" y1="4.79" x2="16.81" y2="7.19" />
    <line x1="4.79" y1="19.21" x2="7.19" y2="16.81" />
    <line x1="19.21" y1="19.21" x2="16.81" y2="16.81" />

    <!-- Center Minimalist Code Brackets "< >" -->
    <polyline points="10 9.8 7.8 12 10 14.2" />
    <polyline points="14 9.8 16.2 12 14 14.2" />

    <!-- Center Axis Core -->
    <circle cx="12" cy="12" r="0.75" fill="currentColor" stroke="none" />
  </svg>
</template>

<script setup lang="ts">
defineProps({
  size: {
    type: [Number, String],
    default: 20,
  },
  strokeWidth: {
    type: [Number, String],
    default: 1.8,
  },
  customClass: {
    type: String,
    default: '',
  },
});
</script>
