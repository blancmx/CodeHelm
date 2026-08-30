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
    <!-- Terminal Outer Frame -->
    <rect
      x="2"
      y="4"
      width="20"
      height="16"
      rx="3"
    />

    <!-- Command Prompt '>' -->
    <polyline
      points="6 9 10 12 6 15"
      class="prompt-chevron"
      :class="{ 'is-active': active || hovered }"
    />

    <!-- Cursor '_' -->
    <line
      x1="13"
      y1="15"
      x2="17"
      y2="15"
      class="cursor-line"
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
    strokeWidth: 1.8,
    hovered: false,
    active: false,
    class: '',
  }
);
</script>

<style scoped>
.prompt-chevron {
  transform-origin: 8px 12px;
  transition: transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

.prompt-chevron.is-active {
  transform: translateX(1px);
}

.cursor-line {
  transition: opacity 200ms ease;
}

.cursor-line.is-active {
  animation: cursor-blink 1s ease-in-out infinite;
}

@keyframes cursor-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.15; }
}
</style>
