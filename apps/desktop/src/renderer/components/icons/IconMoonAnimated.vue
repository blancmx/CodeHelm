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
    class="inline-block flex-shrink-0 align-middle pointer-events-none moon-svg-container"
    :class="{ 'is-active': active }"
  >
    <!-- Moon Body -->
    <path
      d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
      class="moon-path"
      :class="{ 'is-active': active }"
    />
    <!-- Micro Star Particle 1 -->
    <circle cx="19" cy="5" r="1" class="star-dot star-1" :class="{ 'is-active': active }" fill="currentColor" />
    <!-- Micro Star Particle 2 -->
    <circle cx="17" cy="11" r="0.75" class="star-dot star-2" :class="{ 'is-active': active }" fill="currentColor" />
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
.moon-svg-container {
  overflow: visible;
}

.moon-path {
  transform-origin: 12px 12px;
  transform: scale(1) rotate(0deg);
  transition: transform 380ms cubic-bezier(0.34, 1.56, 0.64, 1), fill-opacity 240ms ease;
}

:global(.group:hover) .moon-path,
.moon-path.is-active {
  transform: scale(1.12) rotate(-15deg);
}

.star-dot {
  opacity: 0;
  transform-origin: 19px 5px;
  transform: scale(0);
  transition: all 300ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

:global(.group:hover) .star-1,
.star-1.is-active {
  opacity: 1;
  transform: scale(1);
  transition-delay: 60ms;
}

:global(.group:hover) .star-2,
.star-2.is-active {
  opacity: 0.9;
  transform: scale(1);
  transition-delay: 120ms;
}
</style>
