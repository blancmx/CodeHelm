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
    class="inline-block flex-shrink-0 align-middle pointer-events-none transition-colors duration-200"
    :class="$props.class"
  >
    <!-- Magnifying Glass Lens Body -->
    <circle
      cx="11"
      cy="11"
      r="8"
      class="search-lens"
      :class="{ 'is-active': active || hovered }"
    />

    <!-- Internal Specular Lens Shine (Twinkles on Hover) -->
    <path
      d="M8.5 7.5A4 4 0 0 1 14 8"
      class="search-shine"
      :class="{ 'is-active': active || hovered }"
    />

    <!-- Magnifying Glass Handle -->
    <line
      x1="21"
      y1="21"
      x2="16.65"
      y2="16.65"
      class="search-handle"
      :class="{ 'is-active': active || hovered }"
    />
  </svg>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    size?: number | string;
    strokeWidth?: number | string;
    hovered?: boolean;
    active?: boolean;
    class?: string;
  }>(),
  {
    size: 16,
    strokeWidth: 1.9,
    hovered: false,
    active: false,
    class: '',
  }
);
</script>

<style scoped>
.search-lens {
  transform-origin: 11px 11px;
  transition: transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1);
  will-change: transform;
}

.search-handle {
  transform-origin: 21px 21px;
  transition: transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1);
  will-change: transform;
}

.search-shine {
  opacity: 0;
  stroke-width: 1.5;
  stroke-linecap: round;
  transform: translate(-1px, -1px);
  transition: opacity 220ms ease, transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

/* Interactive Animation on Hover or Active State */
.search-lens.is-active,
:global(.group\/search:hover) .search-lens,
:global(.group:hover) .search-lens {
  transform: scale(1.12) rotate(-8deg);
}

.search-handle.is-active,
:global(.group\/search:hover) .search-handle,
:global(.group:hover) .search-handle {
  transform: translate(1px, 1px) rotate(8deg);
}

.search-shine.is-active,
:global(.group\/search:hover) .search-shine,
:global(.group:hover) .search-shine {
  opacity: 0.9;
  transform: translate(0px, 0px);
}
</style>
