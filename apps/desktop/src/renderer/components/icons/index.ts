import { defineComponent, h } from 'vue';

// Helper to create outline SVG icons
function createIcon(name: string, svgPaths: () => ReturnType<typeof h>[]) {
  return defineComponent({
    name,
    props: {
      size: {
        type: [Number, String],
        default: 16,
      },
      strokeWidth: {
        type: [Number, String],
        default: 1.8,
      },
      class: {
        type: [String, Array, Object],
        default: '',
      },
    },
    setup(props) {
      return () =>
        h(
          'svg',
          {
            xmlns: 'http://www.w3.org/2000/svg',
            viewBox: '0 0 24 24',
            width: props.size,
            height: props.size,
            fill: 'none',
            stroke: 'currentColor',
            'stroke-width': props.strokeWidth,
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
            class: props.class,
          },
          svgPaths()
        );
    },
  });
}

// 1. Navigation & Views
export const IconGrid = createIcon('IconGrid', () => [
  h('rect', { x: 3, y: 3, width: 7, height: 7, rx: 1.5 }),
  h('rect', { x: 14, y: 3, width: 7, height: 7, rx: 1.5 }),
  h('rect', { x: 14, y: 14, width: 7, height: 7, rx: 1.5 }),
  h('rect', { x: 3, y: 14, width: 7, height: 7, rx: 1.5 }),
]);

export const IconList = createIcon('IconList', () => [
  h('line', { x1: 8, y1: 6, x2: 21, y2: 6 }),
  h('line', { x1: 8, y1: 12, x2: 21, y2: 12 }),
  h('line', { x1: 8, y1: 18, x2: 21, y2: 18 }),
  h('line', { x1: 3, y1: 6, x2: 3.01, y2: 6 }),
  h('line', { x1: 3, y1: 12, x2: 3.01, y2: 12 }),
  h('line', { x1: 3, y1: 18, x2: 3.01, y2: 18 }),
]);

export const IconSliders = createIcon('IconSliders', () => [
  h('line', { x1: 4, y1: 21, x2: 4, y2: 14 }),
  h('line', { x1: 4, y1: 10, x2: 4, y2: 3 }),
  h('line', { x1: 12, y1: 21, x2: 12, y2: 12 }),
  h('line', { x1: 12, y1: 8, x2: 12, y2: 3 }),
  h('line', { x1: 20, y1: 21, x2: 20, y2: 16 }),
  h('line', { x1: 20, y1: 12, x2: 20, y2: 3 }),
  h('line', { x1: 1, y1: 14, x2: 7, y2: 14 }),
  h('line', { x1: 9, y1: 8, x2: 15, y2: 8 }),
  h('line', { x1: 17, y1: 16, x2: 23, y2: 16 }),
]);

export const IconZap = createIcon('IconZap', () => [
  h('polygon', { points: '13 2 3 14 12 14 11 22 21 10 12 10 13 2' }),
]);

export const IconSettings = createIcon('IconSettings', () => [
  h('circle', { cx: 12, cy: 12, r: 3 }),
  h('path', {
    d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z',
  }),
]);

export const IconSun = createIcon('IconSun', () => [
  h('circle', { cx: 12, cy: 12, r: 5 }),
  h('line', { x1: 12, y1: 1, x2: 12, y2: 3 }),
  h('line', { x1: 12, y1: 21, x2: 12, y2: 23 }),
  h('line', { x1: 4.22, y1: 4.22, x2: 5.64, y2: 5.64 }),
  h('line', { x1: 18.36, y1: 18.36, x2: 19.78, y2: 19.78 }),
  h('line', { x1: 1, y1: 12, x2: 3, y2: 12 }),
  h('line', { x1: 21, y1: 12, x2: 23, y2: 12 }),
  h('line', { x1: 4.22, y1: 19.78, x2: 5.64, y2: 18.36 }),
  h('line', { x1: 18.36, y1: 5.64, x2: 19.78, y2: 4.22 }),
]);

export const IconMoon = createIcon('IconMoon', () => [
  h('path', { d: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z' }),
]);

export const IconMonitor = createIcon('IconMonitor', () => [
  h('rect', { x: 2, y: 3, width: 20, height: 14, rx: 2 }),
  h('line', { x1: 8, y1: 21, x2: 16, y2: 21 }),
  h('line', { x1: 12, y1: 17, x2: 12, y2: 21 }),
]);

// 2. Project & Files
export const IconFolder = createIcon('IconFolder', () => [
  h('path', {
    d: 'M4 4h4.5a2 2 0 0 1 1.4.6L11.5 6H20a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  }),
  h('line', { x1: 2, y1: 10, x2: 22, y2: 10 }),
]);

export const IconFolderOpen = createIcon('IconFolderOpen', () => [
  h('path', {
    d: 'M3 11V6a2 2 0 0 1 2-2h4.5a2 2 0 0 1 1.4.6L12 6H19a2 2 0 0 1 2 2v3',
  }),
  h('path', {
    d: 'M3 11.5a1.2 1.2 0 0 1 1-.5h16.8a1.2 1.2 0 0 1 1.1 1.6l-2.6 7.2A2 2 0 0 1 17.4 21H5.8a2 2 0 0 1-1.9-1.4L2.3 12.6a1.2 1.2 0 0 1 .7-1.1z',
  }),
]);

export const IconSearch = createIcon('IconSearch', () => [
  h('circle', { cx: 11, cy: 11, r: 8 }),
  h('line', { x1: 21, y1: 21, x2: 16.65, y2: 16.65 }),
]);

export const IconPlus = createIcon('IconPlus', () => [
  h('line', { x1: 12, y1: 5, x2: 12, y2: 19 }),
  h('line', { x1: 5, y1: 12, x2: 19, y2: 12 }),
]);

export const IconLayers = createIcon('IconLayers', () => [
  h('polygon', { points: '12 2 2 7 12 12 22 7 12 2' }),
  h('polyline', { points: '2 17 12 22 22 17' }),
  h('polyline', { points: '2 12 12 17 22 12' }),
]);

export const IconFileText = createIcon('IconFileText', () => [
  h('path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }),
  h('polyline', { points: '14 2 14 8 20 8' }),
  h('line', { x1: 16, y1: 13, x2: 8, y2: 13 }),
  h('line', { x1: 16, y1: 17, x2: 8, y2: 17 }),
  h('polyline', { points: '10 9 9 9 8 9' }),
]);

// 3. Process & Control
export const IconPlay = createIcon('IconPlay', () => [
  h('polygon', { points: '5 3 19 12 5 21 5 3' }),
]);

export const IconSquare = createIcon('IconSquare', () => [
  h('rect', { x: 4, y: 4, width: 16, height: 16, rx: 2 }),
]);

export const IconRefresh = createIcon('IconRefresh', () => [
  h('path', { d: 'M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' }),
  h('polyline', { points: '3 3 3 8 8 8' }),
  h('path', { d: 'M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16' }),
  h('polyline', { points: '16 16 21 16 21 21' }),
]);

export const IconActivity = createIcon('IconActivity', () => [
  h('polyline', { points: '22 12 18 12 15 21 9 3 6 12 2 12' }),
]);

export const IconHistory = createIcon('IconHistory', () => [
  h('path', { d: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' }),
  h('polyline', { points: '3 3 3 8 8 8' }),
  h('polyline', { points: '12 7 12 12 15 15' }),
]);

export const IconTerminal = createIcon('IconTerminal', () => [
  h('polyline', { points: '4 17 10 11 4 5' }),
  h('line', { x1: 12, y1: 19, x2: 20, y2: 19 }),
]);

// 4. Security & Actions
export const IconShield = createIcon('IconShield', () => [
  h('path', { d: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' }),
]);

export const IconShieldCheck = createIcon('IconShieldCheck', () => [
  h('path', { d: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' }),
  h('polyline', { points: '9 12 11 14 15 10' }),
]);

export const IconLock = createIcon('IconLock', () => [
  h('rect', { x: 3, y: 11, width: 18, height: 11, rx: 2, ry: 2 }),
  h('path', { d: 'M7 11V7a5 5 0 0 1 10 0v4' }),
]);

export const IconCopy = createIcon('IconCopy', () => [
  h('rect', { x: 9, y: 9, width: 13, height: 13, rx: 2, ry: 2 }),
  h('path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }),
]);

export const IconCheck = createIcon('IconCheck', () => [
  h('polyline', { points: '20 6 9 17 4 12' }),
]);

export const IconCheckCircle = createIcon('IconCheckCircle', () => [
  h('path', { d: 'M22 11.08V12a10 10 0 1 1-5.93-9.14' }),
  h('polyline', { points: '22 4 12 14.01 9 11.01' }),
]);

export const IconAlertCircle = createIcon('IconAlertCircle', () => [
  h('circle', { cx: 12, cy: 12, r: 10 }),
  h('line', { x1: 12, y1: 8, x2: 12, y2: 12 }),
  h('line', { x1: 12, y1: 16, x2: 12.01, y2: 16 }),
]);

export const IconExternalLink = createIcon('IconExternalLink', () => [
  h('path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }),
  h('polyline', { points: '15 3 21 3 21 9' }),
  h('line', { x1: 10, y1: 14, x2: 21, y2: 3 }),
]);

export const IconEye = createIcon('IconEye', () => [
  h('path', { d: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z' }),
  h('circle', { cx: 12, cy: 12, r: 3 }),
]);

export const IconEyeOff = createIcon('IconEyeOff', () => [
  h('path', {
    d: 'M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24',
  }),
  h('line', { x1: 1, y1: 1, x2: 23, y2: 23 }),
]);

export { default as IconTrash } from './IconTrashAnimated.vue';
export { default as IconTrashAnimated } from './IconTrashAnimated.vue';

export const IconEdit = createIcon('IconEdit', () => [
  h('path', { d: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7' }),
  h('path', { d: 'M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z' }),
]);

export const IconArrowLeft = createIcon('IconArrowLeft', () => [
  h('line', { x1: 19, y1: 12, x2: 5, y2: 12 }),
  h('polyline', { points: '12 19 5 12 12 5' }),
]);

export const IconArrowRight = createIcon('IconArrowRight', () => [
  h('line', { x1: 5, y1: 12, x2: 19, y2: 12 }),
  h('polyline', { points: '12 5 19 12 12 19' }),
]);

export const IconChevronDown = createIcon('IconChevronDown', () => [
  h('polyline', { points: '6 9 12 15 18 9' }),
]);

export const IconChevronRight = createIcon('IconChevronRight', () => [
  h('polyline', { points: '9 18 15 12 9 6' }),
]);

export const IconFile = createIcon('IconFile', () => [
  h('path', { d: 'M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z' }),
  h('polyline', { points: '13 2 13 9 20 9' }),
]);

export const IconX = createIcon('IconX', () => [
  h('line', { x1: 18, y1: 6, x2: 6, y2: 18 }),
  h('line', { x1: 6, y1: 6, x2: 18, y2: 18 }),
]);

export const IconDownload = createIcon('IconDownload', () => [
  h('path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }),
  h('polyline', { points: '7 10 12 15 17 10' }),
  h('line', { x1: 12, y1: 15, x2: 12, y2: 3 }),
]);

export const IconPalette = createIcon('IconPalette', () => [
  h('circle', { cx: 13.5, cy: 6.5, r: 0.5, fill: 'currentColor' }),
  h('circle', { cx: 17.5, cy: 10.5, r: 0.5, fill: 'currentColor' }),
  h('circle', { cx: 8.5, cy: 7.5, r: 0.5, fill: 'currentColor' }),
  h('circle', { cx: 6.5, cy: 12.5, r: 0.5, fill: 'currentColor' }),
  h('path', {
    d: 'M12 2C6.49 2 2 6.49 2 12c0 2.21.89 4.23 2.34 5.71.6.61 1.42.96 2.28.96h1.22c.9 0 1.63.73 1.63 1.63 0 .42-.16.82-.44 1.12-.46.49-.73 1.14-.73 1.83 0 1.52 1.23 2.75 2.75 2.75 5.51 0 10-4.49 10-10C21.05 6.56 17.44 2 12 2z',
  }),
]);

export const IconDatabase = createIcon('IconDatabase', () => [
  h('ellipse', { cx: 12, cy: 5, rx: 9, ry: 3 }),
  h('path', { d: 'M21 12c0 1.66-4 3-9 3s-9-1.34-9-3' }),
  h('path', { d: 'M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5' }),
]);

export const IconPanelLeftClose = createIcon('IconPanelLeftClose', () => [
  h('rect', { width: 18, height: 18, x: 3, y: 3, rx: 2 }),
  h('path', { d: 'M9 3v18' }),
]);

export const IconPanelLeftOpen = createIcon('IconPanelLeftOpen', () => [
  h('rect', { width: 18, height: 18, x: 3, y: 3, rx: 2 }),
  h('path', { d: 'M9 3v18' }),
]);

export const IconSidebar = createIcon('IconSidebar', () => [
  h('rect', { width: 18, height: 18, x: 3, y: 3, rx: 2 }),
  h('path', { d: 'M9 3v18' }),
]);

export { default as IconCodeHelmLogo } from './IconCodeHelmLogo.vue';
export { default as IconProjectGrid } from './IconProjectGrid.vue';
export { default as IconRunnerZap } from './IconRunnerZap.vue';
export { default as IconMoonAnimated } from './IconMoonAnimated.vue';
export { default as IconSunAnimated } from './IconSunAnimated.vue';
export { default as IconMonitorAnimated } from './IconMonitorAnimated.vue';
export { default as IconSearchAnimated } from './IconSearchAnimated.vue';
export { default as IconSidebarAnimated } from './IconSidebarAnimated.vue';
export { default as IconTerminalAnimated } from './IconTerminalAnimated.vue';
