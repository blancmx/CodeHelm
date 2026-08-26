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
    class="inline-block flex-shrink-0 align-middle pointer-events-none transition-transform duration-200"
    :class="$props.class"
  >
    <!-- Outer Window Frame (Modern Rounded Rect with Corner Radius) -->
    <rect x="3" y="3" width="18" height="18" rx="3.5" class="window-frame" />

    <!-- Left Sidebar Area Subtle Fill (Lights up when expanded) -->
    <rect
      x="3"
      y="3"
      width="6"
      height="18"
      rx="2"
      class="sidebar-tint"
      :class="{ 'is-collapsed': collapsed }"
    />

    <!-- Vertical Panel Divider Line -->
    <line
      x1="9"
      y1="3"
      x2="9"
      y2="21"
      class="sidebar-divider"
      :class="{ 'is-collapsed': collapsed }"
    />

    <!-- Expanded State: Inner Panel Action Lines (Subtle Content Hint) -->
    <g class="expanded-detail" :class="{ 'is-collapsed': collapsed }">
      <line x1="12.5" y1="8" x2="17.5" y2="8" stroke-width="1.6" class="content-line" />
      <line x1="12.5" y1="12" x2="16" y2="12" stroke-width="1.6" class="content-line" />
    </g>

    <!-- Collapsed State: Dynamic Expand Arrow (Smooth Slide-In) -->
    <path
      d="M13 9l3 3-3 3"
      class="expand-arrow"
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
    hovered?: boolean;
    class?: string;
  }>(),
  {
    size: 15,
    strokeWidth: 1.8,
    collapsed: false,
    hovered: false,
    class: '',
  }
);
</script>

<style scoped>
.window-frame {
  transition: stroke 200ms ease;
}

/* Sidebar Tint: Filled in expanded mode, collapses to 0 in collapsed mode */
.sidebar-tint {
  fill: currentColor;
  fill-opacity: 0.18;
  stroke: none;
  transform-origin: 3px 12px;
  transition: transform 260ms cubic-bezier(0.34, 1.56, 0.64, 1), fill-opacity 200ms ease;
}
.sidebar-tint.is-collapsed {
  transform: scaleX(0);
  fill-opacity: 0;
}

/* Sidebar Divider Line: Shifts left slightly when collapsed */
.sidebar-divider {
  transform-origin: 9px 12px;
  transition: transform 260ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 200ms ease;
}
.sidebar-divider.is-collapsed {
  transform: translateX(-3px);
  opacity: 0.5;
}

/* Content Lines in Expanded Mode */
.expanded-detail {
  opacity: 0.85;
  transition: opacity 200ms ease, transform 240ms ease;
}
.expanded-detail.is-collapsed {
  opacity: 0;
  transform: translateX(2px);
  pointer-events-none;
}

/* Expand Arrow in Collapsed Mode */
.expand-arrow {
  opacity: 0;
  transform-origin: 14.5px 12px;
  transform: translateX(-3px);
  transition: opacity 220ms ease, transform 260ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
.expand-arrow.is-collapsed {
  opacity: 1;
  transform: translateX(0);
}

/* Hover micro-interaction on parent button hover */
:global(.group\/toggle:hover) .expand-arrow.is-collapsed {
  transform: translateX(1.5px);
}

:global(.group\/toggle:hover) .sidebar-divider:not(.is-collapsed) {
  transform: translateX(-0.8px);
}
</style>
