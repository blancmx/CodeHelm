<template>
  <div
    class="border rounded-xl flex flex-col overflow-hidden transition-all duration-200"
    :class="themeStore.isDark ? 'bg-[#121216] border-[#27272a]' : 'bg-white border-zinc-200 shadow-sm'"
  >
    <!-- Top Filter & Action Bar -->
    <div
      class="p-3.5 border-b flex items-center justify-between gap-3 flex-wrap transition-colors"
      :class="themeStore.isDark ? 'border-[#27272a] bg-[#18181b]/50' : 'border-zinc-200 bg-zinc-50/70'"
    >
      <div class="flex items-center gap-2 flex-1 min-w-220px">
        <n-input
          v-model:value="searchQuery"
          size="small"
          placeholder="搜索文件或目录 (如 snake.py, src, package.json)..."
          clearable
          class="text-xs"
        >
          <template #prefix>
            <IconSearch :size="13" class="text-zinc-400 mr-1" />
          </template>
        </n-input>
      </div>

      <div class="flex items-center gap-2 text-xs">
        <span
          class="font-mono text-[11px] px-2 py-0.5 rounded border"
          :class="themeStore.isDark ? 'bg-[#18181b] text-zinc-400 border-[#27272a]' : 'bg-white text-zinc-600 border-zinc-200'"
        >
          {{ totalStats.dirs }} 目录 · {{ totalStats.files }} 文件
        </span>

        <n-button size="tiny" secondary @click="toggleExpandAll">
          {{ isAllExpanded ? '全部折叠' : '全部展开' }}
        </n-button>

        <n-button size="tiny" secondary :loading="isLoading" @click="loadTree">
          <template #icon>
            <IconRefresh :size="12" />
          </template>
          刷新
        </n-button>
      </div>
    </div>

    <!-- Tree Content Area -->
    <div class="p-3 overflow-y-auto max-h-520px font-mono text-xs">
      <div v-if="isLoading" class="py-12 text-center text-zinc-400 flex flex-col items-center justify-center gap-2">
        <span class="w-2.5 h-2.5 rounded-full pulsing-dot-active" :class="themeStore.isDark ? 'bg-white' : 'bg-black'" />
        <span class="text-xs font-sans">正在加载工程文件目录结构...</span>
      </div>

      <div
        v-else-if="filteredNodes.length === 0"
        class="py-12 text-center text-xs font-sans"
        :class="themeStore.isDark ? 'text-zinc-500' : 'text-zinc-400'"
      >
        {{ searchQuery ? '未找到匹配的文件或目录' : '该工程目录下暂无文件或已被过滤' }}
      </div>

      <!-- Recursive Tree Node List -->
      <div v-else class="space-y-0.5">
        <TreeNodeItem
          v-for="node in filteredNodes"
          :key="node.path"
          :node="node"
          :depth="0"
          :expanded-paths="expandedPaths"
          :search-query="searchQuery"
          @toggle="toggleNode"
          @copy-path="handleCopyPath"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, h } from 'vue';
import { useThemeStore } from '../stores/themeStore.js';
import { message } from '../utils/discrete.js';
import type { FileTreeNodeDto } from '@codehelm/contracts';
import {
  IconSearch,
  IconRefresh,
  IconFolder,
  IconFolderOpen,
  IconFile,
  IconFileText,
  IconChevronRight,
  IconChevronDown,
  IconCopy,
} from './icons/index.js';

const props = defineProps<{
  rootPath: string;
}>();

const themeStore = useThemeStore();

const treeData = ref<FileTreeNodeDto[]>([]);
const isLoading = ref(false);
const searchQuery = ref('');
const expandedPaths = ref<Set<string>>(new Set());

// Calculate statistics
const totalStats = computed(() => {
  let files = 0;
  let dirs = 0;
  let totalBytes = 0;

  function traverse(list: FileTreeNodeDto[]) {
    for (const node of list) {
      if (node.type === 'directory') {
        dirs++;
        if (node.children) traverse(node.children);
      } else {
        files++;
        totalBytes += node.size || 0;
      }
    }
  }

  traverse(treeData.value);
  return { files, dirs, totalBytes };
});

const isAllExpanded = computed(() => {
  return expandedPaths.value.size > 0;
});

// Filter nodes by search query
const filteredNodes = computed(() => {
  if (!searchQuery.value.trim()) return treeData.value;
  const q = searchQuery.value.trim().toLowerCase();

  function filterTree(list: FileTreeNodeDto[]): FileTreeNodeDto[] {
    const result: FileTreeNodeDto[] = [];
    for (const node of list) {
      if (node.type === 'directory') {
        const matchingChildren = node.children ? filterTree(node.children) : [];
        if (node.name.toLowerCase().includes(q) || matchingChildren.length > 0) {
          result.push({
            ...node,
            children: matchingChildren.length > 0 ? matchingChildren : node.children,
          });
        }
      } else if (node.name.toLowerCase().includes(q)) {
        result.push(node);
      }
    }
    return result;
  }

  return filterTree(treeData.value);
});

// Auto expand matching search paths
watch(searchQuery, (q) => {
  if (q.trim()) {
    function expandAllDirs(list: FileTreeNodeDto[]) {
      for (const node of list) {
        if (node.type === 'directory') {
          expandedPaths.value.add(node.path);
          if (node.children) expandAllDirs(node.children);
        }
      }
    }
    expandAllDirs(treeData.value);
  }
});

async function loadTree() {
  if (!props.rootPath || !window.codehelm) return;
  try {
    isLoading.value = true;
    const res = await window.codehelm.projects.getFileTree(props.rootPath, { maxDepth: 5 });
    treeData.value = res || [];

    // Default expand root-level directories
    expandedPaths.value.clear();
    for (const node of treeData.value) {
      if (node.type === 'directory') {
        expandedPaths.value.add(node.path);
      }
    }
  } catch (err: any) {
    message.error(err.message || '加载文件结构失败');
  } finally {
    isLoading.value = false;
  }
}

function toggleNode(path: string) {
  if (expandedPaths.value.has(path)) {
    expandedPaths.value.delete(path);
  } else {
    expandedPaths.value.add(path);
  }
}

function toggleExpandAll() {
  if (expandedPaths.value.size > 0) {
    expandedPaths.value.clear();
  } else {
    function addAll(list: FileTreeNodeDto[]) {
      for (const node of list) {
        if (node.type === 'directory') {
          expandedPaths.value.add(node.path);
          if (node.children) addAll(node.children);
        }
      }
    }
    addAll(treeData.value);
  }
}

function handleCopyPath(path: string) {
  navigator.clipboard.writeText(path);
  message.success('已复制文件路径');
}

onMounted(() => {
  loadTree();
});

watch(() => props.rootPath, () => {
  loadTree();
});

// ==========================================
// Recursive TreeNode Item Sub-Component
// ==========================================
const TreeNodeItem = {
  name: 'TreeNodeItem',
  props: {
    node: {
      type: Object as () => FileTreeNodeDto,
      required: true,
    },
    depth: {
      type: Number,
      default: 0,
    },
    expandedPaths: {
      type: Object as () => Set<string>,
      required: true,
    },
    searchQuery: {
      type: String,
      default: '',
    },
  },
  emits: ['toggle', 'copy-path'],
  setup(itemProps: any, { emit }: any) {
    const isExpanded = computed(() => itemProps.expandedPaths.has(itemProps.node.path));

    function formatSize(bytes?: number): string {
      if (!bytes) return '';
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    function getExtColorClass(ext?: string): string {
      const e = (ext || '').toLowerCase();
      if (e === 'py') return 'text-amber-500 font-bold';
      if (e === 'ts' || e === 'tsx') return 'text-sky-500 font-bold';
      if (e === 'vue') return 'text-emerald-500 font-bold';
      if (e === 'js' || e === 'jsx') return 'text-yellow-500 font-bold';
      if (e === 'json') return 'text-orange-400 font-bold';
      if (e === 'md') return 'text-cyan-400 font-bold';
      if (e === 'png' || e === 'jpg' || e === 'svg') return 'text-purple-400';
      if (e === 'rs') return 'text-orange-600 font-bold';
      if (e === 'go') return 'text-teal-400 font-bold';
      return 'text-zinc-400';
    }

    return () => {
      const isDir = itemProps.node.type === 'directory';
      const extClass = getExtColorClass(itemProps.node.extension);

      return h('div', { class: 'select-none' }, [
        h(
          'div',
          {
            class: [
              'flex items-center justify-between py-1 px-2 rounded-lg transition-colors group cursor-pointer text-xs',
              themeStore.isDark ? 'hover:bg-[#18181b] text-zinc-300' : 'hover:bg-zinc-100 text-zinc-800',
            ],
            style: { paddingLeft: `${itemProps.depth * 18 + 8}px` },
            onClick: () => {
              if (isDir) {
                emit('toggle', itemProps.node.path);
              }
            },
          },
          [
            // Left: Icon + Name
            h('div', { class: 'flex items-center gap-2 min-w-0 flex-1' }, [
              isDir
                ? h(
                    'span',
                    { class: 'w-4 h-4 flex items-center justify-center text-zinc-400' },
                    isExpanded.value ? h(IconChevronDown, { size: 13 }) : h(IconChevronRight, { size: 13 })
                  )
                : h('span', { class: 'w-4' }),

              isDir
                ? isExpanded.value
                  ? h(IconFolderOpen, { size: 15, class: 'text-amber-400 flex-shrink-0' })
                  : h(IconFolder, { size: 15, class: 'text-amber-400 flex-shrink-0' })
                : itemProps.node.extension === 'md'
                ? h(IconFileText, { size: 14, class: 'text-cyan-400 flex-shrink-0' })
                : h(IconFile, { size: 14, class: `${extClass} flex-shrink-0` }),

              h(
                'span',
                {
                  class: [
                    'truncate',
                    isDir ? (themeStore.isDark ? 'font-bold text-white' : 'font-bold text-zinc-950') : '',
                  ],
                },
                itemProps.node.name
              ),

              // File extension tag
              !isDir && itemProps.node.extension
                ? h(
                    'span',
                    {
                      class: [
                        'text-[10px] px-1 rounded uppercase font-mono tracking-wider',
                        themeStore.isDark ? 'bg-[#27272a] text-zinc-400' : 'bg-zinc-200 text-zinc-600',
                      ],
                    },
                    itemProps.node.extension
                  )
                : null,
            ]),

            // Right: Size + Copy Action
            h('div', { class: 'flex items-center gap-2.5 text-[11px] text-zinc-400 flex-shrink-0' }, [
              !isDir && itemProps.node.size
                ? h('span', { class: 'font-mono text-[10px]' }, formatSize(itemProps.node.size))
                : null,

              h(
                'button',
                {
                  class: [
                    'opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all',
                    'text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100',
                  ],
                  title: '复制相对路径',
                  onClick: (e: MouseEvent) => {
                    e.stopPropagation();
                    emit('copy-path', itemProps.node.relativePath || itemProps.node.name);
                  },
                },
                [h(IconCopy, { size: 12 })]
              ),
            ]),
          ]
        ),

        // Recursive Children
        isDir && isExpanded.value && itemProps.node.children && itemProps.node.children.length > 0
          ? h(
              'div',
              {
                class: 'relative before:absolute before:left-3 before:top-0 before:bottom-0 before:w-px before:bg-zinc-200 dark:before:bg-zinc-800',
                style: { marginLeft: `${itemProps.depth * 18 + 14}px` },
              },
              itemProps.node.children.map((child: FileTreeNodeDto) =>
                h(TreeNodeItem, {
                  key: child.path,
                  node: child,
                  depth: itemProps.depth + 1,
                  expandedPaths: itemProps.expandedPaths,
                  searchQuery: itemProps.searchQuery,
                  onToggle: (p: string) => emit('toggle', p),
                  onCopyPath: (p: string) => emit('copy-path', p),
                })
              )
            )
          : null,
      ]);
    };
  },
};
</script>
