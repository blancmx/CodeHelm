<template>
  <teleport to="body">
    <transition name="search-modal">
      <div
        v-if="isVisible"
        class="search-modal-backdrop fixed inset-0 z-[9999] flex items-start justify-center pt-[12vh] bg-black/60 backdrop-blur-xs select-none"
        @mousedown.self="handleClose"
      >
        <div
          class="search-modal-card w-[640px] max-w-[92vw] rounded-2xl border shadow-2xl overflow-hidden flex flex-col transition-colors duration-200"
          :class="themeStore.isDark
            ? 'bg-[#121216] border-[#27272a] shadow-black/90 text-white'
            : 'bg-white border-zinc-200 shadow-zinc-400/30 text-zinc-950'"
          @keydown="handleKeyDown"
        >
            <!-- Top Search Input Bar -->
            <div
              class="h-14 px-4 flex items-center gap-3 border-b transition-colors"
              :class="themeStore.isDark ? 'border-[#27272a] bg-[#15151a]' : 'border-zinc-100 bg-zinc-50/70'"
            >
              <IconSearch :size="18" class="text-zinc-400 flex-shrink-0" />
              <input
                ref="inputRef"
                v-model="query"
                type="text"
                placeholder="搜索工程名称、本地路径、框架或语言画像..."
                class="flex-1 bg-transparent border-0 outline-none text-sm font-sans placeholder:text-zinc-400"
                :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'"
                @input="selectedIndex = 0"
              />
              <button
                type="button"
                class="w-6 h-6 rounded-md flex items-center justify-center cursor-pointer transition-colors"
                :class="themeStore.isDark
                  ? 'text-zinc-400 hover:text-white hover:bg-white/10'
                  : 'text-zinc-400 hover:text-zinc-950 hover:bg-zinc-200'"
                title="关闭"
                @click="handleClose"
              >
                <IconX :size="15" />
              </button>
            </div>

            <!-- Search Results List -->
            <NVirtualList
              v-if="filteredProjects.length"
              ref="listRef"
              :items="filteredProjects"
              :item-size="64"
              key-field="id"
              :style="{ height: Math.min(380, filteredProjects.length * 64 + 16) + 'px' }"
              :padding-top="8"
              :padding-bottom="8"
              :items-style="{ padding: '0 8px' }"
            >
              <template #default="{ item: project, index }">
              <div
                class="h-[58px] mb-1.5 p-2.5 rounded-xl flex items-center justify-between gap-3 cursor-pointer transition-colors duration-100 border"
                :class="[
                  selectedIndex === index
                    ? (themeStore.isDark ? 'bg-[#1c1c22] border-white/20 shadow-xs' : 'bg-zinc-100 border-zinc-300 shadow-2xs')
                    : 'border-transparent hover:bg-zinc-500/5'
                ]"
                @mouseenter="selectedIndex = index"
                @click="selectProject(project.id)"
              >
                <!-- Left: Project Info -->
                <div class="flex items-center gap-3 min-w-0 flex-1">
                  <!-- Project Avatar Square -->
                  <div
                    class="w-9 h-9 rounded-lg flex items-center justify-center font-bold text-xs flex-shrink-0 border font-mono shadow-2xs"
                    :class="themeStore.isDark ? 'bg-[#18181b] border-[#27272a] text-white' : 'bg-white border-zinc-200 text-zinc-950'"
                  >
                    {{ (project.name || 'P').slice(0, 2).toUpperCase() }}
                  </div>

                  <!-- Project Names & Metadata -->
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                      <span class="font-bold text-xs truncate" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
                        {{ project.name }}
                      </span>
                      <span
                        class="text-[10px] font-mono px-1.5 py-0.2 rounded border flex-shrink-0"
                        :class="themeStore.isDark ? 'bg-[#18181b] text-zinc-400 border-[#27272a]' : 'bg-zinc-100 text-zinc-600 border-zinc-200'"
                      >
                        {{ project.moduleCount || 0 }} 模块 / {{ project.serviceCount || 0 }} 服务
                      </span>
                    </div>
                    <p
                      class="font-mono text-[11px] truncate mt-0.5"
                      :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'"
                    >
                      {{ project.rootPath }}
                    </p>
                  </div>
                </div>

                <!-- Right: Tags -->
                <div class="flex items-center gap-2 flex-shrink-0">
                  <!-- Primary Stack Tags -->
                  <div class="hidden sm:flex items-center gap-1">
                    <span
                      v-for="lang in (project.primaryLanguages || []).slice(0, 2)"
                      :key="lang"
                      class="text-[9px] font-mono px-1.5 py-0.2 rounded border"
                      :class="themeStore.isDark ? 'bg-[#18181b] text-zinc-300 border-[#27272a]' : 'bg-zinc-100 text-zinc-700 border-zinc-200'"
                    >
                      {{ lang }}
                    </span>
                  </div>
                </div>
              </div>
              </template>
            </NVirtualList>

              <!-- Empty State -->
              <div
                v-else
                class="py-12 text-center select-none"
              >
                <IconSearch :size="32" class="mx-auto text-zinc-400/60 mb-2.5" />
                <p class="text-xs font-bold" :class="themeStore.isDark ? 'text-zinc-300' : 'text-zinc-700'">
                  未找到匹配的工程项目
                </p>
                <p class="text-[11px] mt-1 text-zinc-400">
                  可尝试搜索其他名称、本地路径或语言画像关键词
                </p>
              </div>

            <!-- Bottom Status Footer (Clean, No Shortcut Displays) -->
            <div
              class="h-8 px-4 flex items-center justify-between border-t text-[11px] transition-colors"
              :class="themeStore.isDark ? 'border-[#1f1f24] bg-[#0e0e11] text-zinc-400' : 'border-zinc-100 bg-zinc-50 text-zinc-500'"
            >
              <div class="flex items-center gap-2">
                <span>共找到 <strong :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">{{ filteredProjects.length }}</strong> 个匹配项目</span>
              </div>
            </div>
          </div>
        </div>
    </transition>
  </teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { NVirtualList, type VirtualListInst } from 'naive-ui';
import { useRouter } from 'vue-router';
import { useProjectStore } from '../stores/projectStore.js';
import { useThemeStore } from '../stores/themeStore.js';
import { IconSearch, IconX } from './icons/index.js';

const router = useRouter();
const projectStore = useProjectStore();
const themeStore = useThemeStore();

const props = withDefaults(
  defineProps<{
    show?: boolean;
  }>(),
  {
    show: undefined,
  }
);

const emit = defineEmits<{
  'update:show': [value: boolean];
}>();

const isVisible = computed(() => {
  if (props.show !== undefined) {
    return props.show;
  }
  return projectStore.searchModalVisible;
});

const query = ref('');
const selectedIndex = ref(0);
const inputRef = ref<HTMLInputElement | null>(null);
const listRef = ref<VirtualListInst | null>(null);

const filteredProjects = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) {
    return projectStore.projects;
  }
  return projectStore.projects.filter((p) => {
    const nameMatch = (p.name || '').toLowerCase().includes(q);
    const pathMatch = (p.rootPath || '').toLowerCase().includes(q);
    const langMatch = (p.primaryLanguages || []).some((l) => l.toLowerCase().includes(q));
    const fwMatch = (p.primaryFrameworks || []).some((f) => f.toLowerCase().includes(q));
    return nameMatch || pathMatch || langMatch || fwMatch;
  });
});

watch(filteredProjects, () => {
  selectedIndex.value = 0;
  nextTick(() => listRef.value?.scrollTo({ index: 0 }));
});

watch(
  isVisible,
  (visible) => {
    if (visible) {
      query.value = '';
      selectedIndex.value = 0;
      nextTick(() => {
        inputRef.value?.focus();
      });
    }
  }
);

function handleClose() {
  projectStore.closeSearchModal();
  emit('update:show', false);
}

function selectProject(id: string) {
  handleClose();
  router.push(`/projects/${id}`);
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (filteredProjects.value.length > 0) {
      selectedIndex.value = (selectedIndex.value + 1) % filteredProjects.value.length;
      scrollToSelected();
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (filteredProjects.value.length > 0) {
      selectedIndex.value = (selectedIndex.value - 1 + filteredProjects.value.length) % filteredProjects.value.length;
      scrollToSelected();
    }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const item = filteredProjects.value[selectedIndex.value];
    if (item) {
      selectProject(item.id);
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    handleClose();
  }
}

function scrollToSelected() {
  nextTick(() => {
    listRef.value?.scrollTo({ index: selectedIndex.value });
  });
}
</script>

<style scoped>
/* Overlay Backdrop Transitions */
.search-modal-enter-active {
  transition: opacity 220ms cubic-bezier(0.16, 1, 0.3, 1);
}

.search-modal-leave-active {
  transition: opacity 180ms cubic-bezier(0.16, 1, 0.3, 1);
  pointer-events: none;
}

.search-modal-enter-from,
.search-modal-leave-to {
  opacity: 0;
}

/* Modal Card Smooth Slide & Scale Transitions (Entrance & Exit) */
.search-modal-enter-active .search-modal-card {
  transition: transform 220ms cubic-bezier(0.16, 1, 0.3, 1), opacity 200ms cubic-bezier(0.16, 1, 0.3, 1);
  will-change: transform, opacity;
}

.search-modal-leave-active .search-modal-card {
  transition: transform 180ms cubic-bezier(0.16, 1, 0.3, 1), opacity 160ms cubic-bezier(0.16, 1, 0.3, 1);
  will-change: transform, opacity;
}

.search-modal-enter-from .search-modal-card {
  opacity: 0;
  transform: translateY(-16px) scale(0.96);
}

.search-modal-leave-to .search-modal-card {
  opacity: 0;
  transform: translateY(-14px) scale(0.96);
}

@media (prefers-reduced-motion: reduce) {
  .search-modal-enter-active,
  .search-modal-leave-active,
  .search-modal-enter-active .search-modal-card,
  .search-modal-leave-active .search-modal-card {
    transition: none;
  }
}
</style>
