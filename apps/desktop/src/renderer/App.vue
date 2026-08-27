<template>
  <n-config-provider
    :theme="themeStore.isDark ? darkTheme : null"
    :theme-overrides="currentThemeOverrides"
    class="h-full w-full"
  >
    <div
      class="h-full w-full font-sans flex flex-col antialiased overflow-hidden select-none transition-colors duration-300 relative z-1"
      :class="themeStore.isDark ? 'bg-[#09090b] text-[#ffffff]' : 'bg-[#fafafa] text-[#09090b]'"
    >
      <!-- Modern Frameless Window Header Bar with Drag Region & Windows 11 Controls -->
      <WindowHeaderBar class="relative z-30" />

      <!-- Main Application Router View -->
      <div class="flex-1 min-h-0 w-full overflow-hidden relative z-10">
        <router-view />
      </div>
    </div>
  </n-config-provider>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { darkTheme } from 'naive-ui';
import type { GlobalThemeOverrides } from 'naive-ui';
import { useThemeStore } from './stores/themeStore.js';
import WindowHeaderBar from './components/WindowHeaderBar.vue';

const themeStore = useThemeStore();

const darkThemeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#ffffff',
    primaryColorHover: '#f4f4f5',
    primaryColorPressed: '#e4e4e7',
    primaryColorSuppl: '#ffffff',
    infoColor: '#ffffff',
    infoColorHover: '#f4f4f5',
    warningColor: '#ffffff',
    warningColorHover: '#f4f4f5',
    errorColor: '#f43f5e',
    errorColorHover: '#fb7185',
    bodyColor: '#09090b',
    cardColor: '#121216',
    modalColor: '#121216',
    popoverColor: '#18181b',
    borderColor: '#27272a',
    textColorBase: '#ffffff',
    textColor1: '#ffffff',
    textColor2: '#d4d4d8',
    textColor3: '#a1a1aa',
    borderRadius: '8px',
    borderRadiusSmall: '6px',
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
    fontFamilyMono: 'ui-monospace, "Cascadia Code", "Fira Code", "JetBrains Mono", Consolas, Menlo, Monaco, monospace',
  },
  Button: {
    borderRadiusMedium: '8px',
    borderRadiusSmall: '8px',
    borderRadiusTiny: '6px',
    fontWeight: '500',
    // Solid Primary in Dark: Crisp Pure White fill with Jet Black text
    colorPrimary: '#ffffff',
    colorHoverPrimary: '#f4f4f5',
    colorPressedPrimary: '#e4e4e7',
    colorFocusPrimary: '#ffffff',
    colorDisabledPrimary: '#3f3f46',
    borderPrimary: '1px solid #ffffff',
    borderHoverPrimary: '1px solid #f4f4f5',
    borderPressedPrimary: '1px solid #e4e4e7',
    borderFocusPrimary: '1px solid #ffffff',
    textColorPrimary: '#09090b',
    textColorHoverPrimary: '#000000',
    textColorPressedPrimary: '#000000',
    textColorFocusPrimary: '#09090b',
    // Secondary in Dark
    colorSecondary: '#18181b',
    colorSecondaryHover: '#27272a',
    colorSecondaryPressed: '#3f3f46',
    colorSecondaryPrimary: '#18181b',
    colorSecondaryHoverPrimary: '#27272a',
    colorSecondaryPressedPrimary: '#3f3f46',
    textColorSecondary: '#ffffff',
    textColorSecondaryHover: '#ffffff',
    textColorSecondaryPressed: '#ffffff',
    textColorSecondaryPrimary: '#ffffff',
    textColorSecondaryHoverPrimary: '#ffffff',
    textColorSecondaryPressedPrimary: '#ffffff',
    textColorSecondaryInfo: '#ffffff',
    textColorSecondaryHoverInfo: '#ffffff',
    textColorSecondaryPressedInfo: '#ffffff',
    textColorSecondaryError: '#f43f5e',
    textColorSecondaryHoverError: '#fb7185',
    textColorSecondaryPressedError: '#e11d48',
    textColorSecondaryWarning: '#ffffff',
    textColorSecondaryHoverWarning: '#ffffff',
    textColorSecondaryPressedWarning: '#ffffff',
    // Ghost & Text Primary in Dark
    textColorGhostPrimary: '#ffffff',
    textColorGhostHoverPrimary: '#ffffff',
    textColorGhostPressedPrimary: '#d4d4d8',
    textColorGhostFocusPrimary: '#ffffff',
    textColorTextPrimary: '#ffffff',
    textColorTextHoverPrimary: '#ffffff',
    textColorTextPressedPrimary: '#d4d4d8',
    textColorTextFocusPrimary: '#ffffff',
    // Default Buttons in Dark
    textColor: '#e4e4e7',
    textColorHover: '#ffffff',
    textColorPressed: '#ffffff',
    textColorFocus: '#ffffff',
  },
  Dialog: {
    borderRadius: '14px',
    color: '#121216',
    titleTextColor: '#ffffff',
    textColor: '#d4d4d8',
    border: '1px solid #27272a',
    iconColor: '#ffffff',
    iconColorWarning: '#ffffff',
    iconColorError: '#f43f5e',
    iconColorInfo: '#ffffff',
    iconColorSuccess: '#ffffff',
    closeColorHover: '#ffffff',
    closeIconColor: '#a1a1aa',
    closeIconColorHover: '#ffffff',
  },
  Card: {
    color: '#121216',
    borderColor: '#27272a',
    borderRadius: '12px',
  },
  Modal: {
    color: '#121216',
    borderColor: '#27272a',
    borderRadius: '14px',
  },
  Tabs: {
    tabFontWeightActive: '600',
    tabTextColorActiveLine: '#ffffff',
    tabTextColorHoverLine: '#ffffff',
    barColor: '#ffffff',
  },
  Input: {
    color: '#121216',
    colorFocus: '#18181b',
    textColor: '#ffffff',
    placeholderColor: '#71717a',
    border: '1px solid #27272a',
    borderHover: '1px solid #3f3f46',
    borderFocus: '1px solid #71717a',
    boxShadowFocus: '0 0 0 2px rgba(255, 255, 255, 0.1)',
  },
  Select: {
    peers: {
      InternalSelectMenu: {
        color: '#18181b',
        optionTextColor: '#d4d4d8',
        optionTextColorActive: '#ffffff',
        optionColorActive: '#27272a',
        optionColorPending: '#27272a',
        borderRadius: '8px',
      },
      InternalSelection: {
        color: '#121216',
        colorActive: '#18181b',
        textColor: '#ffffff',
        placeholderColor: '#71717a',
        border: '1px solid #27272a',
        borderHover: '1px solid #3f3f46',
        borderFocus: '1px solid #71717a',
        borderActive: '1px solid #71717a',
        boxShadowFocus: '0 0 0 2px rgba(255, 255, 255, 0.1)',
        boxShadowActive: '0 0 0 2px rgba(255, 255, 255, 0.1)',
        borderRadius: '8px',
      },
    },
  },
  Popselect: {
    peers: {
      InternalSelectMenu: {
        color: '#18181b',
        optionTextColor: '#d4d4d8',
        optionTextColorActive: '#ffffff',
        optionColorActive: '#27272a',
        optionColorPending: '#27272a',
        borderRadius: '8px',
      },
    },
  },
};

const lightThemeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#09090b',
    primaryColorHover: '#18181b',
    primaryColorPressed: '#27272a',
    primaryColorSuppl: '#09090b',
    infoColor: '#09090b',
    infoColorHover: '#18181b',
    warningColor: '#09090b',
    warningColorHover: '#18181b',
    errorColor: '#e11d48',
    errorColorHover: '#f43f5e',
    bodyColor: '#fafafa',
    cardColor: '#ffffff',
    modalColor: '#ffffff',
    popoverColor: '#ffffff',
    borderColor: '#e4e4e7',
    textColorBase: '#09090b',
    textColor1: '#09090b',
    textColor2: '#3f3f46',
    textColor3: '#71717a',
    borderRadius: '8px',
    borderRadiusSmall: '6px',
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
    fontFamilyMono: 'ui-monospace, "Cascadia Code", "Fira Code", "JetBrains Mono", Consolas, Menlo, Monaco, monospace',
  },
  Button: {
    borderRadiusMedium: '8px',
    borderRadiusSmall: '8px',
    borderRadiusTiny: '6px',
    fontWeight: '500',
    // Solid Primary in Light: Pure Jet Black fill with Crisp White text
    colorPrimary: '#09090b',
    colorHoverPrimary: '#18181b',
    colorPressedPrimary: '#27272a',
    colorFocusPrimary: '#09090b',
    colorDisabledPrimary: '#e4e4e7',
    borderPrimary: '1px solid #09090b',
    borderHoverPrimary: '1px solid #18181b',
    borderPressedPrimary: '1px solid #27272a',
    borderFocusPrimary: '1px solid #09090b',
    textColorPrimary: '#ffffff',
    textColorHoverPrimary: '#ffffff',
    textColorPressedPrimary: '#ffffff',
    textColorFocusPrimary: '#ffffff',
    // Secondary colors in Light (subtle neutral gray fill with jet black text)
    colorSecondary: '#f4f4f5',
    colorSecondaryHover: '#e4e4e7',
    colorSecondaryPressed: '#d4d4d8',
    colorSecondaryPrimary: '#f4f4f5',
    colorSecondaryHoverPrimary: '#e4e4e7',
    colorSecondaryPressedPrimary: '#d4d4d8',
    textColorSecondary: '#09090b',
    textColorSecondaryHover: '#000000',
    textColorSecondaryPressed: '#000000',
    textColorSecondaryPrimary: '#09090b',
    textColorSecondaryHoverPrimary: '#000000',
    textColorSecondaryPressedPrimary: '#000000',
    textColorSecondaryInfo: '#09090b',
    textColorSecondaryHoverInfo: '#000000',
    textColorSecondaryPressedInfo: '#000000',
    textColorSecondaryError: '#e11d48',
    textColorSecondaryHoverError: '#be123c',
    textColorSecondaryPressedError: '#9f1239',
    textColorSecondaryWarning: '#09090b',
    textColorSecondaryHoverWarning: '#000000',
    textColorSecondaryPressedWarning: '#000000',
    // Ghost & Text Primary in Light
    textColorGhostPrimary: '#09090b',
    textColorGhostHoverPrimary: '#000000',
    textColorGhostPressedPrimary: '#000000',
    textColorGhostFocusPrimary: '#09090b',
    textColorTextPrimary: '#09090b',
    textColorTextHoverPrimary: '#000000',
    textColorTextPressedPrimary: '#000000',
    textColorTextFocusPrimary: '#09090b',
    // Default Buttons in Light
    textColor: '#09090b',
    textColorHover: '#000000',
    textColorPressed: '#000000',
    textColorFocus: '#09090b',
  },
  Dialog: {
    borderRadius: '14px',
    color: '#ffffff',
    titleTextColor: '#09090b',
    textColor: '#3f3f46',
    border: '1px solid #e4e4e7',
    iconColor: '#09090b',
    iconColorWarning: '#09090b',
    iconColorError: '#e11d48',
    iconColorInfo: '#09090b',
    iconColorSuccess: '#09090b',
    closeColorHover: '#09090b',
    closeIconColor: '#71717a',
    closeIconColorHover: '#09090b',
  },
  Card: {
    color: '#ffffff',
    borderColor: '#e4e4e7',
    borderRadius: '12px',
  },
  Modal: {
    color: '#ffffff',
    borderColor: '#e4e4e7',
    borderRadius: '14px',
  },
  Tabs: {
    tabFontWeightActive: '600',
    tabTextColorActiveLine: '#09090b',
    tabTextColorHoverLine: '#09090b',
    barColor: '#09090b',
  },
  Input: {
    color: '#ffffff',
    colorFocus: '#fafafa',
    textColor: '#09090b',
    placeholderColor: '#a1a1aa',
    border: '1px solid #e4e4e7',
    borderHover: '1px solid #a1a1aa',
    borderFocus: '1px solid #09090b',
    boxShadowFocus: '0 0 0 2px rgba(9, 9, 11, 0.1)',
  },
  Select: {
    peers: {
      InternalSelectMenu: {
        color: '#ffffff',
        optionTextColor: '#27272a',
        optionTextColorActive: '#09090b',
        optionColorActive: '#f4f4f5',
        optionColorPending: '#f4f4f5',
        borderRadius: '8px',
      },
      InternalSelection: {
        color: '#ffffff',
        colorActive: '#fafafa',
        textColor: '#09090b',
        placeholderColor: '#a1a1aa',
        border: '1px solid #e4e4e7',
        borderHover: '1px solid #a1a1aa',
        borderFocus: '1px solid #09090b',
        borderActive: '1px solid #09090b',
        boxShadowFocus: '0 0 0 2px rgba(9, 9, 11, 0.1)',
        boxShadowActive: '0 0 0 2px rgba(9, 9, 11, 0.1)',
        borderRadius: '8px',
      },
    },
  },
  Popselect: {
    peers: {
      InternalSelectMenu: {
        color: '#ffffff',
        optionTextColor: '#27272a',
        optionTextColorActive: '#09090b',
        optionColorActive: '#f4f4f5',
        optionColorPending: '#f4f4f5',
        borderRadius: '8px',
      },
    },
  },
};

const currentThemeOverrides = computed(() => {
  return themeStore.isDark ? darkThemeOverrides : lightThemeOverrides;
});
</script>

<style>
/* Commit the palette atomically; the small feedback ring animates separately. */
html.theme-changing,
html.theme-changing *,
html.theme-changing *::before,
html.theme-changing *::after {
  transition: none !important;
}

.theme-mode-feedback {
  position: fixed;
  width: 96px;
  height: 96px;
  border: 2px solid var(--text-primary);
  border-radius: 50%;
  z-index: 2147483647;
  pointer-events: none;
  contain: strict;
  will-change: transform, opacity;
}

:root {
  --bg-app: #fafafa;
  --bg-sidebar: #f4f4f5;
  --bg-card: #ffffff;
  --bg-card-hover: #fafafa;
  --bg-panel: #f4f4f5;
  --bg-input: #ffffff;
  --border-subtle: #e4e4e7;
  --border-card: #e4e4e7;
  --border-card-hover: #d4d4d8;
  --text-primary: #09090b;
  --text-secondary: #52525b;
  --text-muted: #71717a;
  --terminal-bg: #09090b;
}

html.dark {
  --bg-app: #09090b;
  --bg-sidebar: #0f0f12;
  --bg-card: #121216;
  --bg-card-hover: #18181c;
  --bg-panel: #18181c;
  --bg-input: #121216;
  --border-subtle: #1f1f23;
  --border-card: #27272a;
  --border-card-hover: #3f3f46;
  --text-primary: #ffffff;
  --text-secondary: #a1a1aa;
  --text-muted: #71717a;
  --terminal-bg: #09090b;
}

html, body, #app {
  height: 100%;
  width: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "WenQuanYi Micro Hei", sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

button, input, select, textarea {
  font-family: inherit !important;
  -webkit-font-smoothing: antialiased;
}

html.light,
html.light body,
html.light #app {
  color: #09090b !important;
  background-color: #fafafa;
}

html.dark,
html.dark body,
html.dark #app {
  color: #ffffff !important;
  background-color: #09090b;
}

.n-config-provider {
  height: 100%;
  width: 100%;
}

/* =========================================================
   Eliminate Button & Dialog Border-Radius Overlap Artifacts
   ========================================================= */

.n-button {
  border-radius: 8px !important;
}

.n-button .n-button__border,
.n-button .n-button__state-border {
  border-radius: inherit !important;
}

/* Specifically inside Dialog actions to eliminate duplicate corner ghosting */
.n-dialog .n-dialog__action .n-button {
  border-radius: 8px !important;
}

.n-dialog .n-dialog__action .n-button .n-button__border,
.n-dialog .n-dialog__action .n-button .n-button__state-border {
  display: none !important;
}

/* =========================================================
   Monochrome Button High-Priority Overrides
   ========================================================= */

/* 1. Solid Primary in LIGHT mode: Jet Black background with crisp white text */
html.light .n-button.n-button--primary-type:not(.n-button--secondary):not(.n-button--ghost):not(.n-button--quaternary):not(.n-button--tertiary) {
  background-color: #09090b !important;
  border-color: #09090b !important;
  color: #ffffff !important;
}
html.light .n-button.n-button--primary-type:not(.n-button--secondary):not(.n-button--ghost):not(.n-button--quaternary):not(.n-button--tertiary):hover {
  background-color: #27272a !important;
  border-color: #27272a !important;
}
html.light .n-button.n-button--primary-type:not(.n-button--secondary):not(.n-button--ghost):not(.n-button--quaternary):not(.n-button--tertiary) * {
  color: #ffffff !important;
  stroke: #ffffff !important;
}

/* 2. Solid Primary in DARK mode: Pure White background with Jet Black text */
html.dark .n-button.n-button--primary-type:not(.n-button--secondary):not(.n-button--ghost):not(.n-button--quaternary):not(.n-button--tertiary) {
  background-color: #ffffff !important;
  border-color: #ffffff !important;
  color: #09090b !important;
}
html.dark .n-button.n-button--primary-type:not(.n-button--secondary):not(.n-button--ghost):not(.n-button--quaternary):not(.n-button--tertiary):hover {
  background-color: #f4f4f5 !important;
  border-color: #f4f4f5 !important;
}
html.dark .n-button.n-button--primary-type:not(.n-button--secondary):not(.n-button--ghost):not(.n-button--quaternary):not(.n-button--tertiary) * {
  color: #09090b !important;
  stroke: #09090b !important;
}

/* 3. Secondary Buttons in LIGHT mode */
html.light .n-button.n-button--secondary {
  background-color: #f4f4f5 !important;
  border: 1px solid #e4e4e7 !important;
}
html.light .n-button.n-button--secondary:hover {
  background-color: #e4e4e7 !important;
  border-color: #d4d4d8 !important;
}
html.light .n-button.n-button--secondary * {
  color: #09090b !important;
  stroke: #09090b !important;
}

/* 4. Secondary Buttons in DARK mode */
html.dark .n-button.n-button--secondary {
  background-color: #18181b !important;
  border: 1px solid #27272a !important;
}
html.dark .n-button.n-button--secondary:hover {
  background-color: #27272a !important;
  border-color: #3f3f46 !important;
}
html.dark .n-button.n-button--secondary * {
  color: #ffffff !important;
  stroke: #ffffff !important;
}

/* 5. Default Buttons */
html.light .n-button.n-button--default-type {
  background-color: #ffffff !important;
  border: 1px solid #e4e4e7 !important;
}
html.light .n-button.n-button--default-type:hover {
  background-color: #f4f4f5 !important;
  border-color: #d4d4d8 !important;
}
html.light .n-button.n-button--default-type * {
  color: #09090b !important;
  stroke: #09090b !important;
}

html.dark .n-button.n-button--default-type {
  background-color: #121216 !important;
  border: 1px solid #27272a !important;
}
html.dark .n-button.n-button--default-type:hover {
  background-color: #18181b !important;
  border-color: #3f3f46 !important;
}
html.dark .n-button.n-button--default-type * {
  color: #ffffff !important;
  stroke: #ffffff !important;
}

/* =========================================================
   Monochrome Dialog High-Priority Overrides
   ========================================================= */

/* 1. Dark Mode Dialog */
html.dark .n-dialog {
  background-color: #121216 !important;
  border: 1px solid #27272a !important;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.9) !important;
  border-radius: 14px !important;
}
html.dark .n-dialog .n-dialog__title {
  color: #ffffff !important;
  font-weight: 700 !important;
}
html.dark .n-dialog .n-dialog__content {
  color: #a1a1aa !important;
  line-height: 1.6 !important;
}
html.dark .n-dialog .n-dialog__icon {
  color: #ffffff !important;
}
html.dark .n-dialog .n-dialog__icon .n-base-icon {
  color: #ffffff !important;
}
/* Negative Button (取消) in Dark Dialog */
html.dark .n-dialog .n-dialog__action .n-button:not(.n-button--primary-type) {
  background-color: #18181b !important;
  border: 1px solid #27272a !important;
  color: #ffffff !important;
  border-radius: 8px !important;
}
html.dark .n-dialog .n-dialog__action .n-button:not(.n-button--primary-type):hover {
  background-color: #27272a !important;
  border-color: #3f3f46 !important;
}
/* Positive Button (确认) in Dark Dialog */
html.dark .n-dialog .n-dialog__action .n-button.n-button--primary-type {
  background-color: #ffffff !important;
  border: 1px solid #ffffff !important;
  color: #09090b !important;
  font-weight: 600 !important;
  border-radius: 8px !important;
}
html.dark .n-dialog .n-dialog__action .n-button.n-button--primary-type:hover {
  background-color: #f4f4f5 !important;
  border-color: #f4f4f5 !important;
}
html.dark .n-dialog .n-dialog__action .n-button.n-button--primary-type * {
  color: #09090b !important;
}

/* 2. Light Mode Dialog */
html.light .n-dialog {
  background-color: #ffffff !important;
  border: 1px solid #e4e4e7 !important;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.15) !important;
  border-radius: 14px !important;
}
html.light .n-dialog .n-dialog__title {
  color: #09090b !important;
  font-weight: 700 !important;
}
html.light .n-dialog .n-dialog__content {
  color: #52525b !important;
  line-height: 1.6 !important;
}
html.light .n-dialog .n-dialog__icon {
  color: #09090b !important;
}
html.light .n-dialog .n-dialog__icon .n-base-icon {
  color: #09090b !important;
}
/* Negative Button (取消) in Light Dialog */
html.light .n-dialog .n-dialog__action .n-button:not(.n-button--primary-type) {
  background-color: #f4f4f5 !important;
  border: 1px solid #e4e4e7 !important;
  color: #09090b !important;
  border-radius: 8px !important;
}
html.light .n-dialog .n-dialog__action .n-button:not(.n-button--primary-type):hover {
  background-color: #e4e4e7 !important;
  border-color: #d4d4d8 !important;
}
/* Positive Button (确认) in Light Dialog */
html.light .n-dialog .n-dialog__action .n-button.n-button--primary-type {
  background-color: #09090b !important;
  border: 1px solid #09090b !important;
  color: #ffffff !important;
  font-weight: 600 !important;
  border-radius: 8px !important;
}
html.light .n-dialog .n-dialog__action .n-button.n-button--primary-type:hover {
  background-color: #27272a !important;
  border-color: #27272a !important;
}
html.light .n-dialog .n-dialog__action .n-button.n-button--primary-type * {
  color: #ffffff !important;
}

/* =========================================================
   Danger / Warning Confirmation Action Button (确认移除 - 红色字体)
   ========================================================= */

/* 1. Dark Mode Danger Button: Dark background with rose-red text */
html.dark .n-dialog .n-dialog__action .n-button.n-button--error-type,
html.dark .n-dialog .n-dialog__action .n-button--error-type,
html.dark .n-dialog--warning .n-dialog__action .n-button.n-button--primary-type,
html.dark .n-dialog--error .n-dialog__action .n-button.n-button--primary-type {
  background-color: rgba(225, 29, 72, 0.1) !important;
  border: 1px solid rgba(225, 29, 72, 0.35) !important;
  color: #fb7185 !important;
  font-weight: 600 !important;
  border-radius: 8px !important;
  box-shadow: none !important;
}

html.dark .n-dialog .n-dialog__action .n-button.n-button--error-type:hover,
html.dark .n-dialog .n-dialog__action .n-button--error-type:hover,
html.dark .n-dialog--warning .n-dialog__action .n-button.n-button--primary-type:hover,
html.dark .n-dialog--error .n-dialog__action .n-button.n-button--primary-type:hover {
  background-color: rgba(225, 29, 72, 0.22) !important;
  border-color: rgba(225, 29, 72, 0.6) !important;
  color: #fda4af !important;
}

html.dark .n-dialog .n-dialog__action .n-button.n-button--error-type *,
html.dark .n-dialog .n-dialog__action .n-button--error-type *,
html.dark .n-dialog--warning .n-dialog__action .n-button.n-button--primary-type *,
html.dark .n-dialog--error .n-dialog__action .n-button.n-button--primary-type * {
  color: #fb7185 !important;
  stroke: #fb7185 !important;
}

html.dark .n-dialog .n-dialog__action .n-button.n-button--error-type:hover *,
html.dark .n-dialog .n-dialog__action .n-button--error-type:hover *,
html.dark .n-dialog--warning .n-dialog__action .n-button.n-button--primary-type:hover *,
html.dark .n-dialog--error .n-dialog__action .n-button.n-button--primary-type:hover * {
  color: #fda4af !important;
  stroke: #fda4af !important;
}

/* 2. Light Mode Danger Button: Soft rose background with crisp crimson red text */
html.light .n-dialog .n-dialog__action .n-button.n-button--error-type,
html.light .n-dialog .n-dialog__action .n-button--error-type,
html.light .n-dialog--warning .n-dialog__action .n-button.n-button--primary-type,
html.light .n-dialog--error .n-dialog__action .n-button.n-button--primary-type {
  background-color: #fff1f2 !important;
  border: 1px solid #fecdd3 !important;
  color: #e11d48 !important;
  font-weight: 600 !important;
  border-radius: 8px !important;
  box-shadow: none !important;
}

html.light .n-dialog .n-dialog__action .n-button.n-button--error-type:hover,
html.light .n-dialog .n-dialog__action .n-button--error-type:hover,
html.light .n-dialog--warning .n-dialog__action .n-button.n-button--primary-type:hover,
html.light .n-dialog--error .n-dialog__action .n-button.n-button--primary-type:hover {
  background-color: #ffe4e6 !important;
  border-color: #fda4af !important;
  color: #be123c !important;
}

html.light .n-dialog .n-dialog__action .n-button.n-button--error-type *,
html.light .n-dialog .n-dialog__action .n-button--error-type *,
html.light .n-dialog--warning .n-dialog__action .n-button.n-button--primary-type *,
html.light .n-dialog--error .n-dialog__action .n-button.n-button--primary-type * {
  color: #e11d48 !important;
  stroke: #e11d48 !important;
}

html.light .n-dialog .n-dialog__action .n-button.n-button--error-type:hover *,
html.light .n-dialog .n-dialog__action .n-button--error-type:hover *,
html.light .n-dialog--warning .n-dialog__action .n-button.n-button--primary-type:hover *,
html.light .n-dialog--error .n-dialog__action .n-button.n-button--primary-type:hover * {
  color: #be123c !important;
  stroke: #be123c !important;
}

/* Global Smooth Scrollbar */
::-webkit-scrollbar {
  width: 5px;
  height: 5px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: #d4d4d8;
  border-radius: 4px;
}
html.dark ::-webkit-scrollbar-thumb {
  background: #27272a;
}
::-webkit-scrollbar-thumb:hover {
  background: #a1a1aa;
}
html.dark ::-webkit-scrollbar-thumb:hover {
  background: #3f3f46;
}

/* Clean status dot */
.pulsing-dot-active {
  animation: pulse-dot 2s infinite ease-in-out;
}

@keyframes pulse-dot {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}

/* =========================================================
   Top-to-Bottom Slide/Pull-Down Transitions for Dropdowns & Select Menus
   ========================================================= */
.v-binder-follower-content > .n-select-menu,
.v-binder-follower-content > .n-popselect-menu,
.v-binder-follower-content > .n-dropdown-menu,
.n-select-menu,
.n-popselect-menu,
.n-dropdown-menu {
  transform-origin: top center !important;
}

/* Override default scale/zoom with top-to-bottom slide-down transition */
.fade-in-scale-up-transition-enter-active,
.fade-in-scale-up-transition-leave-active,
.slide-in-from-top-transition-enter-active,
.slide-in-from-top-transition-leave-active {
  transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1),
              transform 0.22s cubic-bezier(0.16, 1, 0.3, 1) !important;
  will-change: opacity, transform !important;
}

.fade-in-scale-up-transition-enter-from,
.fade-in-scale-up-transition-leave-to,
.slide-in-from-top-transition-enter-from,
.slide-in-from-top-transition-leave-to {
  opacity: 0 !important;
  transform: translateY(-8px) scaleY(0.92) !important;
}

.fade-in-scale-up-transition-enter-to,
.fade-in-scale-up-transition-leave-from,
.slide-in-from-top-transition-enter-to,
.slide-in-from-top-transition-leave-from {
  opacity: 1 !important;
  transform: translateY(0) scaleY(1) !important;
}

/* Select & Dropdown menu dark/light container styling */
html.dark .n-select-menu {
  background-color: #18181b !important;
  border: 1px solid #27272a !important;
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.8), 0 8px 10px -6px rgba(0, 0, 0, 0.7) !important;
}

html.light .n-select-menu {
  background-color: #ffffff !important;
  border: 1px solid #e4e4e7 !important;
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05) !important;
}

/* Error / Destructive button text styling */
.n-button.n-button--error-type {
  color: #e11d48 !important;
}
.n-button.n-button--error-type .n-button__content {
  color: inherit !important;
}
.n-button.n-button--error-type .n-icon {
  color: inherit !important;
}
html.dark .n-button.n-button--error-type {
}
</style>
