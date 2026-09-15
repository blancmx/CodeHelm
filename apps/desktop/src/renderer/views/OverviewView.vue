<template>
  <div class="flex-1 flex flex-col h-full overflow-hidden p-6">
    <!-- Top Header -->
    <header
      class="flex items-center justify-between pb-4 border-b flex-shrink-0 transition-colors duration-200"
      :class="themeStore.isDark ? 'border-[#27272a]' : 'border-zinc-200'"
    >
      <div class="min-w-0 pr-4">
        <div class="flex items-center gap-2.5">
          <h2 class="text-xl font-bold tracking-tight" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
            项目总览
          </h2>
          <span
            class="text-xs border px-2.5 py-0.5 rounded-full font-sans font-medium inline-flex items-center gap-1 select-none leading-none"
            :class="themeStore.isDark ? 'bg-[#18181b] text-zinc-300 border-[#27272a]' : 'bg-zinc-100 text-zinc-800 border-zinc-200'"
          >
            <template v-if="projectStore.hasLoadedProjects">
              <span class="font-semibold tabular-nums">{{ projectStore.projects.length }}</span>
              <span>个工程</span>
            </template>
            <template v-else>
              项目数待读取
            </template>
          </span>
        </div>
        <p class="text-xs mt-1" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
          集中式工程工作区、技术栈自动推断画像与全生命周期进程编排
        </p>
      </div>

      <!-- Header Actions: Refresh & Import -->
      <div class="flex items-center gap-2.5 flex-shrink-0">
        <!-- Refresh Button (Only Spins on Click) -->
        <button
          type="button"
          class="w-8 h-8 rounded-lg flex items-center justify-center border transition-colors duration-200 cursor-pointer select-none relative"
          :class="[
            isRefreshing || projectStore.loading
              ? (themeStore.isDark ? 'bg-[#27272a] text-white border-zinc-500 ring-2 ring-white/20' : 'bg-zinc-100 text-zinc-950 border-zinc-400 ring-2 ring-black/10')
              : (themeStore.isDark
                  ? 'bg-[#18181b] hover:bg-[#27272a] text-zinc-300 hover:text-white border-[#27272a] active:scale-95'
                  : 'bg-white hover:bg-zinc-100 text-zinc-700 hover:text-zinc-950 border-zinc-200 shadow-xs active:scale-95')
          ]"
          :disabled="isRefreshing || projectStore.loading"
          title="刷新项目列表与实时状态"
          @click="handleManualRefresh"
        >
          <IconRefresh
            :size="15"
            stroke-width="2"
            :class="isRefreshing || projectStore.loading ? 'animate-refresh-spin' : ''"
          />
        </button>

        <!-- Primary Import Project Button: Opens the Import Modal -->
        <n-button
          type="primary"
          size="small"
          class="font-semibold shadow-sm group"
          :disabled="!!projectStore.listError"
          @click="projectStore.importModalVisible = true"
        >
          <template #icon>
            <IconPlus :size="14" class="transition-transform duration-300 ease-out group-hover:rotate-90 group-hover:scale-125" />
          </template>
          导入项目
        </n-button>
      </div>
    </header>

    <!-- Top Metric Stat Cards (Dashboard 2.0) - Permanently Preserved -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3.5 pt-4 pb-2 flex-shrink-0">
      <!-- Metric 1: Total Managed Projects -->
      <div
        class="border rounded-xl p-4 flex items-center justify-between transition-all duration-200 group"
        :class="themeStore.isDark ? 'bg-[#121216] hover:bg-[#18181c] border-[#27272a] hover:border-zinc-500 shadow-sm' : 'bg-white hover:bg-zinc-50 border-zinc-200 hover:border-zinc-300 shadow-sm'"
      >
        <div>
          <div class="text-xs font-medium" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
            已纳管工程总数
          </div>
          <div class="text-2xl font-bold mt-1 font-mono tracking-tight" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
            {{ projectStore.hasLoadedProjects ? projectStore.projects.length : '—' }}
          </div>
          <div class="text-xs mt-1 flex items-center gap-1.5" :class="themeStore.isDark ? 'text-zinc-500' : 'text-zinc-400'">
            <span>{{ projectStore.hasLoadedProjects ? `覆盖 ${totalModulesCount} 个子模块` : '等待项目数据' }}</span>
          </div>
        </div>
        <div
          class="w-10 h-10 rounded-xl flex items-center justify-center border transition-colors"
          :class="themeStore.isDark ? 'bg-[#18181b] border-[#27272a] text-zinc-200 group-hover:border-zinc-500' : 'bg-zinc-100 border-zinc-200 text-zinc-800 group-hover:border-zinc-300'"
        >
          <IconFolder :size="18" />
        </div>
      </div>

      <!-- Metric 2: Active Running Services (Clickable Jump to Runner) -->
      <div
        class="border rounded-xl p-4 flex items-center justify-between transition-all duration-200 cursor-pointer group"
        :class="themeStore.isDark ? 'bg-[#121216] hover:bg-[#18181c] border-[#27272a] hover:border-zinc-500 shadow-sm' : 'bg-white hover:bg-zinc-50 border-zinc-200 hover:border-zinc-300 shadow-sm'"
        title="点击跳转至运行中心监控大盘"
        @click="router.push('/runner')"
      >
        <div>
          <div class="text-xs font-medium flex items-center gap-1.5" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
            <span>本次受管 · 运行中 / 启动中</span>
            <span v-if="(runtimeReady && runnerStore.runningCount > 0)" class="w-1.5 h-1.5 rounded-full bg-emerald-400 pulsing-dot-active" />
          </div>
          <div class="text-2xl font-bold mt-1 font-mono tracking-tight" :class="(runtimeReady && runnerStore.runningCount > 0) ? (themeStore.isDark ? 'text-white' : 'text-zinc-950') : (themeStore.isDark ? 'text-zinc-500' : 'text-zinc-400')">
            {{ runtimeReady ? runnerStore.runningCount : '—' }}
          </div>
          <div class="text-xs mt-1 flex items-center gap-1" :class="themeStore.isDark ? 'text-zinc-400 group-hover:text-white' : 'text-zinc-500 group-hover:text-zinc-900'">
            <span>查看控制中心日志流</span>
            <IconArrowRight :size="10" class="transition-transform group-hover:translate-x-0.5" />
          </div>
        </div>
        <div
          class="w-10 h-10 rounded-xl flex items-center justify-center border transition-colors"
          :class="(runtimeReady && runnerStore.runningCount > 0)
            ? (themeStore.isDark ? 'bg-white text-black border-white font-bold' : 'bg-black text-white border-black font-bold')
            : (themeStore.isDark ? 'bg-[#18181b] border-[#27272a] text-zinc-300' : 'bg-zinc-100 border-zinc-200 text-zinc-700')"
        >
          <IconZap :size="18" />
        </div>
      </div>

      <!-- Metric 3: Detected Ecosystems & Frameworks -->
      <div
        class="border rounded-xl p-4 flex items-center justify-between transition-all duration-200 group"
        :class="themeStore.isDark ? 'bg-[#121216] hover:bg-[#18181c] border-[#27272a] hover:border-zinc-500 shadow-sm' : 'bg-white border-zinc-200 shadow-sm hover:border-zinc-300'"
      >
        <div>
          <div class="text-xs font-medium" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
            技术生态与语言画像
          </div>
          <div class="text-2xl font-bold mt-1 font-mono tracking-tight" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
            {{ projectStore.hasLoadedProjects ? uniqueTechnologies.length : '—' }} <span class="text-xs font-normal font-sans" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">类技术</span>
          </div>
          <div class="text-xs mt-1 truncate max-w-200px font-mono" :class="themeStore.isDark ? 'text-zinc-500' : 'text-zinc-400'">
            {{ projectStore.hasLoadedProjects ? topTechnologiesText : '等待项目数据' }}
          </div>
        </div>
        <div
          class="w-10 h-10 rounded-xl flex items-center justify-center border transition-colors"
          :class="themeStore.isDark ? 'bg-[#18181b] border-[#27272a] text-zinc-200 group-hover:border-zinc-500' : 'bg-zinc-100 border-zinc-200 text-zinc-800 group-hover:border-zinc-300'"
        >
          <IconSearch :size="18" />
        </div>
      </div>
    </div>

    <div v-if="projectStore.hasLoadedProjects" class="flex flex-wrap items-center gap-3 pt-3 flex-shrink-0" aria-label="项目整理筛选">
      <n-select v-model:value="organizationScope" class="w-32" aria-label="归档范围" :options="[{label:'全部项目',value:'all'},{label:'未归档',value:'active'},{label:'已归档',value:'archived'}]" />
      <button
        type="button"
        role="checkbox"
        :aria-checked="onlyFavorites"
        aria-label="仅收藏"
        :title="onlyFavorites ? '当前仅显示收藏项目（点击取消）' : '仅显示收藏项目'"
        class="btn-favorite-filter font-sans select-none"
        :class="{ 'is-active': onlyFavorites }"
        @click="onlyFavorites = !onlyFavorites"
      >
        <IconStar
          :size="14"
          :filled="onlyFavorites"
          class="btn-favorite-filter-icon"
        />
        <span class="btn-favorite-filter-label">收藏</span>
      </button>
      <n-select
        ref="tagSelectRef"
        v-model:value="selectedTags"
        :show="isTagFilterOpen"
        multiple
        clearable
        filterable
        class="w-64"
        aria-label="组合标签"
        placeholder="标签（同时满足）"
        :options="tagOptions"
        @mousedown="handleTagSelectMouseDown"
        @click="handleTagSelectClick"
        @update:show="handleTagSelectShowChange"
      />
      <div class="h-4 w-px bg-zinc-200 dark:bg-zinc-800 mx-0.5" />
      <n-button
        size="small"
        class="btn-select-toggle"
        :class="selectedIds.length > 0 ? 'btn-cancel-selection' : ''"
        :disabled="bulkBusy"
        @click="toggleSelectPage"
      >
        {{ selectedIds.length > 0 ? '取消选择' : '选择本页' }}
      </n-button>
      <transition
        enter-active-class="transition-all duration-120 cubic-bezier(0.16, 1, 0.3, 1)"
        enter-from-class="opacity-0 translate-y-1 scale-98"
        enter-to-class="opacity-100 translate-y-0 scale-100"
        leave-active-class="transition-all duration-90 ease-out"
        leave-from-class="opacity-100 translate-y-0 scale-100"
        leave-to-class="opacity-0 translate-y-1 scale-98"
      >
        <div v-if="selectedIds.length > 0" class="flex items-center gap-2 will-change-transform">
          <span
            class="text-xs font-sans font-medium px-2 py-0.5 rounded border inline-flex items-center gap-1 leading-none"
            :class="themeStore.isDark
              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
              : 'bg-emerald-50 text-emerald-600 border-emerald-200'"
          >
            <span>已选</span>
            <span class="font-semibold tabular-nums">{{ selectedIds.length }}</span>
          </span>
          <!-- 批量收藏 / 批量取消收藏 切换按钮 -->
          <button
            type="button"
            :disabled="bulkBusy"
            :aria-label="isAllSelectedFavorite ? '批量取消收藏' : '批量收藏'"
            class="btn-batch-action btn-batch-star"
            :class="{ 'is-active': isAllSelectedFavorite }"
            @click="organizeSelected({ favorite: !isAllSelectedFavorite })"
          >
            <IconStar
              :size="14"
              :filled="isAllSelectedFavorite"
              class="btn-batch-icon btn-batch-icon-star"
              :class="{
                'is-active': isAllSelectedFavorite,
                'is-animating': isBatchStarActivating,
              }"
            />
            <Transition name="batch-btn-text" mode="out-in">
              <span :key="isAllSelectedFavorite ? 'unfav' : 'fav'" class="batch-btn-label">
                {{ isAllSelectedFavorite ? '批量取消收藏' : '批量收藏' }}
              </span>
            </Transition>
          </button>

          <!-- 批量归档 / 批量取消归档 切换按钮 -->
          <button
            type="button"
            :disabled="bulkBusy"
            :aria-label="isAllSelectedArchived ? '批量取消归档' : '批量归档'"
            class="btn-batch-action btn-batch-archive"
            :class="{ 'is-active': isAllSelectedArchived }"
            @click="organizeSelected({ archived: !isAllSelectedArchived })"
          >
            <IconArchive
              :size="14"
              :filled="isAllSelectedArchived"
              class="btn-batch-icon btn-batch-icon-archive"
              :class="{
                'is-active': isAllSelectedArchived,
                'is-animating': isBatchArchiveActivating,
              }"
            />
            <Transition name="batch-btn-text" mode="out-in">
              <span :key="isAllSelectedArchived ? 'unarchive' : 'archive'" class="batch-btn-label">
                {{ isAllSelectedArchived ? '批量取消归档' : '批量归档' }}
              </span>
            </Transition>
          </button>
        </div>
      </transition>
    </div>
    <div v-if="bulkResults.length" role="status" class="sr-only">
      批量整理：成功 {{ bulkResults.filter(r => r.status === '已完成').length }} / {{ bulkTotal }}，{{ bulkBusy ? '处理中' : '已结束' }}
    </div>
    <!-- Quick Filter Tabs, Sorting & View Mode Switcher -->
    <div v-if="projectStore.hasLoadedProjects" class="flex items-center justify-between pt-3 pb-2 flex-shrink-0 gap-3">
      <!-- Left: Dynamic Ecosystem Tabs & Independent Running Toggle -->
      <div class="flex items-center gap-2.5 overflow-x-auto py-0.5 min-w-0">
        <!-- Dynamic Ecosystem Filter Tabs with Silky Magnetic Sliding Pill Indicator -->
        <div
          ref="tabContainerRef"
          class="relative flex items-center p-1 rounded-full border flex-shrink-0 select-none overflow-hidden"
          :class="themeStore.isDark ? 'bg-[#121216] border-[#27272a]' : 'bg-zinc-100/90 border-zinc-200'"
        >
          <!-- Sliding Active Pill Indicator -->
          <div
            class="ecosystem-tab-indicator absolute top-0 left-0 rounded-full shadow-xs pointer-events-none z-0"
            :class="[
              themeStore.isDark ? 'bg-white shadow-sm' : 'bg-black shadow-sm',
              isTransitionReady ? 'transition-all duration-280 ease-[cubic-bezier(0.16,1,0.3,1)]' : 'transition-none'
            ]"
            :style="indicatorStyle"
          />

          <button
            v-for="filter in filterOptions"
            :key="filter.value"
            :ref="(el) => setTabRef(filter.value, el)"
            :data-tab="filter.value"
            type="button"
            :aria-pressed="activeFilter === filter.value"
            class="ecosystem-filter-tab h-7.5 px-3.5 rounded-full text-xs font-medium transition-colors duration-200 cursor-pointer flex items-center justify-center flex-shrink-0 select-none relative z-10 border border-transparent"
            :class="activeFilter === filter.value
              ? (themeStore.isDark ? '!text-black font-bold' : '!text-white font-bold')
              : (themeStore.isDark ? 'text-zinc-400 hover:text-zinc-100' : 'text-zinc-600 hover:text-zinc-950')"
            @click="handleSelectFilter(filter.value)"
          >
            <span>{{ filter.label }}</span>
            <span
              v-if="filter.count !== undefined"
              class="ml-1 text-xs font-mono transition-colors duration-200"
              :class="activeFilter === filter.value
                ? (themeStore.isDark ? 'text-black/80 font-bold' : 'text-white/80 font-bold')
                : (themeStore.isDark ? 'text-zinc-500' : 'text-zinc-400')"
            >
              ({{ filter.count }})
            </span>
          </button>
        </div>

        <!-- Vertical Divider -->
        <div class="h-4 w-[1px] flex-shrink-0" :class="themeStore.isDark ? 'bg-[#27272a]' : 'bg-zinc-200'" />

        <!-- Independent Running Status Filter Toggle Pill with smooth transition -->
        <button
          type="button"
          class="h-8 px-3.5 rounded-full text-xs font-medium transition-all duration-200 cursor-pointer flex items-center gap-1.5 flex-shrink-0 select-none border"
          :class="[
            onlyRunning
              ? (themeStore.isDark
                  ? 'bg-emerald-950/70 text-emerald-300 border-emerald-500/80 shadow-xs ring-1 ring-emerald-500/30'
                  : 'bg-emerald-50 text-emerald-800 border-emerald-400 shadow-xs ring-1 ring-emerald-400/30')
              : (themeStore.isDark
                  ? 'bg-[#121216] text-zinc-400 hover:text-zinc-200 border-[#27272a] hover:border-zinc-500'
                  : 'bg-white text-zinc-600 hover:text-zinc-900 border-zinc-200 hover:border-zinc-300 shadow-2xs')
          ]"
          :title="onlyRunning ? '点击展示所有状态项目' : '筛选至少有一个运行中或启动中服务的项目'"
          @click="onlyRunning = !onlyRunning"
        >
          <span
            class="w-1.5 h-1.5 rounded-full flex-shrink-0 transition-colors"
            :class="runningProjectsCount > 0 ? (onlyRunning ? 'bg-emerald-400 pulsing-dot-active' : 'bg-emerald-400') : 'bg-zinc-400'"
          />
          <span>运行中 / 启动中</span>
          <span class="text-xs opacity-80 font-mono">({{ runtimeReady ? runningProjectsCount : '—' }})</span>
        </button>
      </div>

      <!-- Right Controls: Sort + View Mode Switcher -->
      <div class="flex items-center gap-2 flex-shrink-0">
        <!-- Sort Popselect Dropdown with Matching Width & Rotating Chevron Arrow -->
        <n-popselect
          v-model:value="sortBy"
          :options="sortOptions"
          trigger="click"
          :popover-props="{
            style: {
              width: '124px',
              minWidth: '124px',
              maxWidth: '124px',
              padding: '4px',
            },
          }"
          @update:show="isSortOpen = $event"
        >
          <button
            type="button"
            class="h-7.5 w-[124px] px-2.5 rounded-lg border flex items-center justify-between font-sans text-xs font-medium transition-all cursor-pointer select-none"
            :class="[
              isSortOpen
                ? (themeStore.isDark ? 'bg-[#18181b] border-white text-white shadow-xs' : 'bg-white border-black text-zinc-950 shadow-xs')
                : (themeStore.isDark ? 'bg-[#18181b] border-[#27272a] text-zinc-200 hover:border-zinc-500' : 'bg-white border-zinc-200 text-zinc-800 hover:border-zinc-400 shadow-2xs')
            ]"
            title="选择排序方式"
          >
            <span class="truncate font-sans font-medium text-xs">{{ currentSortLabel }}</span>
            <IconChevronDown
              :size="12"
              class="transition-transform duration-300 ease-in-out flex-shrink-0 ml-1"
              :class="isSortOpen ? (themeStore.isDark ? 'rotate-180 text-white' : 'rotate-180 text-zinc-950') : 'rotate-0 text-zinc-400'"
            />
          </button>
        </n-popselect>

        <!-- View Mode Switcher (Grid vs List) with Smooth Sliding Indicator Pill -->
        <div
          class="relative border rounded-xl p-0.5 flex items-center select-none overflow-hidden"
          :class="themeStore.isDark ? 'bg-[#18181b] border-[#27272a]' : 'bg-zinc-200/80 border-zinc-300/80'"
          style="height: 32px; width: 68px;"
        >
          <!-- Smooth Sliding Active Indicator Background -->
          <div
            class="absolute top-0.5 bottom-0.5 w-[31px] rounded-[9px] transition-transform duration-250 ease-[cubic-bezier(0.4,0,0.2,1)] shadow-xs pointer-events-none"
            :class="themeStore.isDark
              ? 'bg-white shadow-[0_1px_4px_rgba(0,0,0,0.3)]'
              : 'bg-white border border-zinc-200/90 shadow-[0_1px_3px_rgba(0,0,0,0.08)]'"
            :style="{
              transform: viewMode === 'grid' ? 'translateX(0px)' : 'translateX(33px)',
            }"
          />

          <!-- Grid View Button -->
          <button
            type="button"
            class="relative z-10 w-[31px] h-full rounded-[9px] flex items-center justify-center transition-colors duration-200 cursor-pointer"
            :class="[
              viewMode === 'grid'
                ? '!text-[#09090b]'
                : (themeStore.isDark ? 'text-zinc-500 hover:text-zinc-300' : 'text-zinc-500 hover:text-zinc-800')
            ]"
            title="网格卡片视图"
            @click="setViewMode('grid')"
          >
            <IconGrid :size="14" stroke-width="2" />
          </button>

          <!-- List View Button -->
          <button
            type="button"
            class="relative z-10 w-[31px] h-full rounded-[9px] flex items-center justify-center transition-colors duration-200 cursor-pointer"
            :class="[
              viewMode === 'list'
                ? '!text-[#09090b]'
                : (themeStore.isDark ? 'text-zinc-500 hover:text-zinc-300' : 'text-zinc-500 hover:text-zinc-800')
            ]"
            title="列表表格视图"
            @click="setViewMode('list')"
          >
            <IconList :size="14" stroke-width="2" />
          </button>
        </div>
      </div>
    </div>

    <section
      v-if="projectStore.listError"
      role="alert"
      class="mt-4 border rounded-xl p-4 flex-shrink-0"
      :class="themeStore.isDark ? 'border-amber-800 bg-amber-950/30 text-amber-200' : 'border-amber-300 bg-amber-50 text-amber-950'"
    >
      <h3 class="text-sm font-semibold">项目列表读取失败</h3>
      <p class="text-xs mt-2 leading-relaxed">{{ projectStore.listError }}</p>
      <p v-if="projectStore.hasLoadedProjects" class="text-xs mt-2">下方保留上次成功读取的结果，不代表当前数据库状态。</p>
      <n-button size="small" class="mt-3" :disabled="isRefreshing || projectStore.loading" @click="handleManualRefresh">
        重试读取
      </n-button>
    </section>

    <section v-if="runnerStore.stateError" role="alert" class="mt-3 border rounded-xl p-3 flex-shrink-0"
      :class="themeStore.isDark ? 'border-amber-800 text-amber-200' : 'border-amber-300 text-amber-950'">
      <p class="text-xs">运行状态读取失败：{{ runnerStore.stateError }}。请使用右上角刷新重试；未知状态不计入运行筛选。</p>
    </section>

    <!-- Main Content Area with Crisp Ghost-Free Transition -->
    <div ref="projectListRef" class="flex-1 min-h-0 overflow-y-auto pt-2 flex flex-col [scrollbar-gutter:stable]">
      <transition name="tab-crossfade" mode="out-in">
        <div
          v-if="!projectStore.hasLoadedProjects"
          key="unavailable-state"
          role="status"
          class="flex-1 flex items-center justify-center text-sm text-zinc-500 py-8"
        >
          {{ projectStore.loading ? '正在读取项目列表…' : projectStore.listError ? '无法确认项目数量，请先处理上方错误。' : '等待项目数据' }}
        </div>
        <!-- Empty State: only after a successful database read -->
        <div
          v-else-if="projectStore.projects.length === 0"
          key="empty-state"
          class="flex-1 flex flex-col items-center justify-center text-center max-w-lg mx-auto py-8 my-auto"
        >
        <div
          class="w-16 h-16 rounded-2xl border flex items-center justify-center mb-5 shadow-sm"
          :class="themeStore.isDark ? 'bg-[#18181b] border-[#27272a] text-white' : 'bg-white border-zinc-200 text-zinc-950'"
        >
          <IconFolderOpen :size="28" />
        </div>
        <h3 class="text-base font-bold tracking-tight" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
          暂无已导入的 Vibe / 代码项目
        </h3>
        <p class="text-xs mt-2 leading-relaxed max-w-md" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
          无需逐个文件夹配置命令！您可以直接选择包含多个 AI / Vibe Coding 项目的总文件夹，CodeHelm 将秒级自动探测各子项目技术栈、诊断依赖缺失并一键拉起服务。
        </p>

        <!-- 3 Feature Pillars -->
        <div class="grid grid-cols-3 gap-3 my-6 text-left w-full">
          <div
            class="border rounded-xl p-3.5 transition-all"
            :class="themeStore.isDark ? 'bg-[#121216] border-[#27272a]' : 'bg-white border-zinc-200 shadow-sm'"
          >
            <div class="text-xs font-semibold flex items-center gap-1.5" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
              <IconFolderOpen :size="14" />
              <span>总目录扫描</span>
            </div>
            <div class="text-xs mt-1 leading-normal" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
              自动深度探测子项目与 Monorepo 拓扑
            </div>
          </div>

          <div
            class="border rounded-xl p-3.5 transition-all"
            :class="themeStore.isDark ? 'bg-[#121216] border-[#27272a]' : 'bg-white border-zinc-200 shadow-sm'"
          >
            <div class="text-xs font-semibold flex items-center gap-1.5" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
              <IconZap :size="14" />
              <span>智能命令推断</span>
            </div>
            <div class="text-xs mt-1 leading-normal" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
              零配置推断 Vite、Next.js、FastAPI 等启动脚本
            </div>
          </div>

          <div
            class="border rounded-xl p-3.5 transition-all"
            :class="themeStore.isDark ? 'bg-[#121216] border-[#27272a]' : 'bg-white border-zinc-200 shadow-sm'"
          >
            <div class="text-xs font-semibold flex items-center gap-1.5" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
              <IconLock :size="14" />
              <span>纯本地隔离</span>
            </div>
            <div class="text-xs mt-1 leading-normal" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
              零云端上传，进程树防孤儿自动安全清理
            </div>
          </div>
        </div>

        <n-button
          type="primary"
          size="medium"
          class="px-8 font-semibold shadow-sm"
          @click="projectStore.importModalVisible = true"
        >
          <template #icon>
            <IconFolderOpen :size="16" />
          </template>
          导入本地代码工程
        </n-button>
      </div>

      <!-- No Filter/Search Results -->
      <div
        v-else-if="filteredProjects.length === 0"
        :key="'empty-' + activeFilter + '-' + (onlyRunning ? '1' : '0')"
        class="flex-1 flex flex-col items-center justify-center text-center py-16"
      >
        <div
          class="w-12 h-12 rounded-full border flex items-center justify-center mb-3 text-zinc-400"
          :class="themeStore.isDark ? 'bg-[#18181b] border-[#27272a]' : 'bg-zinc-100 border-zinc-200'"
        >
          <IconSearch :size="20" />
        </div>
        <p class="text-sm font-medium" :class="themeStore.isDark ? 'text-zinc-300' : 'text-zinc-700'">未找到与条件匹配的项目</p>
        <p class="text-xs mt-1" :class="themeStore.isDark ? 'text-zinc-500' : 'text-zinc-400'">请尝试调整搜索关键词或分类标签</p>
      </div>

      <!-- View Mode 1: Project Cards Grid (Monochrome) -->
      <div
        v-else-if="viewMode === 'grid'"
        key="project-grid"
        class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-6"
      >
        <div
          v-for="project in pagedProjects"
          :key="project.id"
          class="border rounded-xl p-5 transition-all duration-150 cursor-pointer flex flex-col justify-between group"
          :class="[
            selectedIds.includes(project.id)
              ? (themeStore.isDark
                  ? 'bg-[#151a17] border-emerald-500/60 shadow-md shadow-emerald-950/30'
                  : 'bg-emerald-50/20 border-emerald-400/80 shadow-md shadow-emerald-100/40')
              : (themeStore.isDark
                  ? 'bg-[#121216] hover:bg-[#18181c] border-[#27272a] hover:border-zinc-500 shadow-sm'
                  : 'bg-white hover:bg-zinc-50 border-zinc-200 hover:border-zinc-400 shadow-sm'),
          ]"
          @click="navigateToProject(project.id)"
        >
          <div>
            <!-- Top Card Info: Left Avatar Checkbox & Name; Right Status Badge -->
            <div class="flex items-start justify-between gap-2.5">
              <div class="flex items-center gap-3 min-w-0">
                <ProjectAvatarCheckbox
                  size="md"
                  :project="project"
                  :selected="selectedIds.includes(project.id)"
                  @select="selectProject(project.id, $event)"
                />
                <div class="min-w-0">
                  <h4
                    class="font-bold text-sm group-hover:underline transition-all truncate"
                    :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'"
                  >
                    {{ project.name }}
                  </h4>
                  <p
                    class="text-xs font-mono truncate max-w-200px mt-0.5"
                    :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'"
                    :title="project.rootPath"
                  >
                    {{ project.rootPath }}
                  </p>
                </div>
              </div>

              <!-- Status Badge -->
              <span
                class="px-2 py-0.5 rounded-full text-xs font-sans font-medium inline-flex items-center gap-1 flex-shrink-0 border leading-none"
                :class="statusBadgeClass(project.runtime.status)"
                :title="runtimeStatusTitle(project)"
              >
                <span
                  v-if="project.runtime.status === 'RUNNING'"
                  class="w-1.5 h-1.5 rounded-full bg-emerald-400 pulsing-dot-active flex-shrink-0"
                />
                <span class="leading-none">{{ runtimeStatusLabel(project.runtime.status, project.id) }}</span>
              </span>
            </div>

            <!-- Language & Tag Pills (Monochrome) -->
            <UnresolvedNotice compact :project-id="project.id" :count="runnerStore.getUnresolvedCount(project.id)" />
            <div class="flex flex-wrap gap-1.5 mt-3.5">
              <span
                v-for="lang in (project.primaryLanguages || [])"
                :key="lang"
                class="px-2 py-0.5 rounded text-xs font-medium border font-mono"
                :class="themeStore.isDark ? 'bg-[#18181b] text-zinc-300 border-[#27272a]' : 'bg-zinc-100 text-zinc-800 border-zinc-200'"
              >
                {{ lang }}
              </span>
              <span
                v-for="framework in (project.primaryFrameworks || [])"
                :key="framework"
                class="px-2 py-0.5 rounded text-xs font-medium border font-mono"
                :class="themeStore.isDark ? 'bg-[#27272a] text-zinc-200 border-[#3f3f46]' : 'bg-zinc-200 text-zinc-900 border-zinc-300'"
              >
                {{ framework }}
              </span>
              <span
                v-for="tag in (project.tags || [])"
                :key="tag"
                class="px-2 py-0.5 rounded text-xs border"
                :class="themeStore.isDark ? 'bg-[#18181b] text-zinc-400 border-[#27272a]' : 'bg-zinc-50 text-zinc-600 border-zinc-200'"
              >
                #{{ tag }}
              </span>
            </div>
          </div>

          <!-- Bottom Card Footer -->
          <div
            class="pt-3.5 mt-4 border-t flex items-center justify-between text-xs transition-colors"
            :class="themeStore.isDark ? 'border-[#1f1f23] text-zinc-400' : 'border-zinc-100 text-zinc-500'"
          >
            <div class="flex items-center gap-2 text-xs font-medium">
              <span :class="themeStore.isDark ? 'text-zinc-300' : 'text-zinc-700'">{{ project.moduleCount || 0 }} 模块</span>
              <span>•</span>
              <span :class="themeStore.isDark ? 'text-zinc-300' : 'text-zinc-700'">{{ project.serviceCount || 0 }} 服务</span>
            </div>

            <div class="flex items-center gap-2" @click.stop>
              <ProjectOrganizationActions
                mode="actions-only"
                :project="project"
              />
              <div class="h-3.5 w-px mx-0.5 bg-zinc-200 dark:bg-zinc-800 flex-shrink-0" />
              <n-button
                size="tiny"
                quaternary
                type="error"
                @click.stop="handleRemove(project.id, project.name)"
              >
                移除
              </n-button>
              <span
                class="group-hover:translate-x-0.5 transition-transform text-xs font-semibold flex items-center gap-1"
                :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'"
              >
                <span>进入</span>
                <IconArrowRight :size="12" />
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- View Mode 2: Project Table / List View (Monochrome) -->
      <div
        v-else-if="viewMode === 'list'"
        key="project-list"
        class="border rounded-xl overflow-x-auto pb-6 mb-4"
        :class="themeStore.isDark ? 'bg-[#121216] border-[#27272a]' : 'bg-white border-zinc-200 shadow-sm'"
      >
        <table class="w-full min-w-[1000px] text-left text-xs border-collapse table-fixed">
          <thead>
            <tr
              class="border-b text-xs font-medium"
              :class="themeStore.isDark ? 'bg-[#18181b] border-[#27272a] text-zinc-400' : 'bg-zinc-50 border-zinc-200 text-zinc-600'"
            >
              <th class="py-3 px-4 w-[21%]">工程名称</th>
              <th class="py-3 px-4 w-[21%]">本地路径</th>
              <th class="py-3 px-4 w-[13%]">技术生态</th>
              <th class="py-3 px-4 w-[13%]">架构规模</th>
              <th class="py-3 px-4 w-[16%]">运行状态</th>
              <th class="py-3 px-4 w-[16%] text-right">操作</th>
            </tr>
          </thead>
          <tbody
            class="divide-y"
            :class="themeStore.isDark ? 'divide-[#1f1f23]' : 'divide-zinc-100'"
          >
            <tr
              v-for="project in pagedProjects"
              :key="project.id"
              class="transition-colors cursor-pointer"
              :class="[
                selectedIds.includes(project.id)
                  ? (themeStore.isDark ? 'bg-emerald-950/20 hover:bg-emerald-950/30' : 'bg-emerald-50/35 hover:bg-emerald-50/50')
                  : (themeStore.isDark ? 'hover:bg-[#18181c]' : 'hover:bg-zinc-50'),
              ]"
              @click="navigateToProject(project.id)"
            >
              <!-- Project Name & Avatar -->
              <td class="py-3.5 px-4 truncate">
                <div class="flex items-center gap-2.5 min-w-0">
                  <ProjectAvatarCheckbox
                    size="sm"
                    :project="project"
                    :selected="selectedIds.includes(project.id)"
                    @select="selectProject(project.id, $event)"
                  />
                  <span class="font-bold text-xs truncate" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
                    {{ project.name }}
                  </span>
                </div>
              </td>

              <!-- Path -->
              <td class="py-3.5 px-4 font-mono text-xs truncate" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'" :title="project.rootPath">
                {{ project.rootPath }}
              </td>

              <!-- Tech Stack -->
              <td class="py-3.5 px-4 truncate">
                <div class="flex flex-wrap gap-1 max-w-full">
                  <span
                    v-for="lang in (project.primaryLanguages || []).slice(0, 3)"
                    :key="lang"
                    class="px-1.5 py-0.5 rounded text-xs font-mono border leading-none"
                    :class="themeStore.isDark ? 'bg-[#18181b] text-zinc-300 border-[#27272a]' : 'bg-zinc-100 text-zinc-800 border-zinc-200'"
                  >
                    {{ lang }}
                  </span>
                  <span
                    v-for="fw in (project.primaryFrameworks || []).slice(0, 2)"
                    :key="fw"
                    class="px-1.5 py-0.5 rounded text-xs font-mono border leading-none"
                    :class="themeStore.isDark ? 'bg-[#27272a] text-zinc-200 border-[#3f3f46]' : 'bg-zinc-200 text-zinc-900 border-zinc-300'"
                  >
                    {{ fw }}
                  </span>
                </div>
              </td>

              <!-- Scale -->
              <td class="py-3.5 px-4 text-xs truncate" :class="themeStore.isDark ? 'text-zinc-300' : 'text-zinc-700'">
                <span>{{ project.moduleCount || 0 }} 模块 / {{ project.serviceCount || 0 }} 服务</span>
              </td>

              <!-- Status -->
              <td class="py-3.5 px-4">
                <span
                  class="px-2 py-0.5 rounded-full text-xs font-sans font-medium inline-flex items-center gap-1 border leading-none"
                  :class="statusBadgeClass(project.runtime.status)"
                  :title="runtimeStatusTitle(project)"
                >
                  <span
                    v-if="project.runtime.status === 'RUNNING'"
                    class="w-1.5 h-1.5 rounded-full bg-emerald-400 pulsing-dot-active flex-shrink-0"
                  />
                  <span class="leading-none">{{ runtimeStatusLabel(project.runtime.status, project.id) }}</span>
                </span>
                <UnresolvedNotice compact :project-id="project.id" :count="runnerStore.getUnresolvedCount(project.id)" />
              </td>

              <!-- Actions: Star + Archive | Remove + Enter -->
              <td class="py-3.5 px-4 text-right">
                <div class="flex items-center justify-end gap-1.5" @click.stop>
                  <ProjectOrganizationActions
                    mode="actions-only"
                    :project="project"
                  />
                  <div class="h-3.5 w-px mx-1 bg-zinc-200 dark:bg-zinc-800 flex-shrink-0" />
                  <n-button
                    size="tiny"
                    quaternary
                    type="error"
                    @click.stop="handleRemove(project.id, project.name)"
                  >
                    移除
                  </n-button>
                  <n-button
                    size="tiny"
                    secondary
                    @click.stop="navigateToProject(project.id)"
                  >
                    进入
                  </n-button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </transition>
  </div>
  <nav v-if="projectStore.hasLoadedProjects && pageBounds.pageCount > 1" aria-label="项目分页"
    class="flex items-center justify-between gap-3 pt-3 flex-shrink-0 text-xs"
    :class="themeStore.isDark ? 'text-zinc-300' : 'text-zinc-700'">
    <span role="status">第 {{ pageBounds.start + 1 }}–{{ pageBounds.end }} 项，共 {{ sortedProjects.length }} 项</span>
    <div class="flex items-center gap-3">
      <n-button size="small" :disabled="pageBounds.page === 1" @click="currentPage--">上一页</n-button>
      <span class="font-mono">{{ pageBounds.page }} / {{ pageBounds.pageCount }}</span>
      <n-button size="small" :disabled="pageBounds.page === pageBounds.pageCount" @click="currentPage++">下一页</n-button>
    </div>
  </nav>
</div>
</template>

<script setup lang="ts">
import UnresolvedNotice from '../components/UnresolvedNotice.vue';
import ProjectOrganizationActions from '../components/ProjectOrganizationActions.vue';
import ProjectAvatarCheckbox from '../components/ProjectAvatarCheckbox.vue';
import { matchesOrganization, compareLastRun, runOrganizationBatch } from '../utils/project-organization.js';
import { ref, computed, nextTick, watch, onMounted, onUnmounted } from 'vue';
import type { SelectInst } from 'naive-ui';
import { useRouter } from 'vue-router';
import { dialog, message } from '../utils/discrete.js';
import { useProjectStore } from '../stores/projectStore.js';
import { useRunnerStore } from '../stores/runnerStore.js';
import { useThemeStore } from '../stores/themeStore.js';
import {
  IconSearch,
  IconPlus,
  IconFolder,
  IconFolderOpen,
  IconZap,
  IconLock,
  IconArrowRight,
  IconRefresh,
  IconGrid,
  IconList,
  IconChevronDown,
  IconStar,
  IconArchive,
} from '../components/icons/index.js';
import type { ProjectSummaryDto, UpdateProjectInput } from '@codehelm/contracts';
import { getPageBounds } from '../utils/pagination.js';

const projectStore = useProjectStore();
const runnerStore = useRunnerStore();
const themeStore = useThemeStore();
const router = useRouter();

const isRefreshing = ref(false);

async function handleManualRefresh() {
  if (isRefreshing.value) return;
  isRefreshing.value = true;
  const startTime = Date.now();
  try {
    const [projectsRefreshed, runtimeRefreshed] = await Promise.all([
      projectStore.fetchProjects(), runnerStore.fetchState(),
    ]);
    if (!projectsRefreshed || !runtimeRefreshed) {
      message.error(projectStore.listError || runnerStore.stateError || '状态已更新或刷新被替代，请重试');
      return;
    }
    const elapsed = Date.now() - startTime;
    if (elapsed < 650) {
      await new Promise((r) => setTimeout(r, 650 - elapsed));
    }
    message.success('已刷新项目列表与运行状态');
  } catch (err: any) {
    message.error(err.message || '刷新失败');
  } finally {
    isRefreshing.value = false;
  }
}

const searchQuery = ref('');
const organizationScope = ref('all');
const onlyFavorites = ref(false);
const selectedTags = ref<string[]>([]);
const tagOptions = computed(() => [...new Set(projectStore.projects.flatMap(p => p.tags))].sort().map(tag => ({label:tag,value:tag})));

const isTagFilterOpen = ref(false);
const tagSelectRef = ref<SelectInst | null>(null);
let wasTagFilterOpenOnMouseDown = false;

function handleTagSelectShowChange(show: boolean) {
  isTagFilterOpen.value = show;
  if (!show) {
    wasTagFilterOpenOnMouseDown = false;
  }
}

function handleTagSelectMouseDown(e: MouseEvent) {
  const target = e.target as HTMLElement | null;
  if (target?.closest('.n-tag__close, .n-base-close, .n-base-clear')) {
    wasTagFilterOpenOnMouseDown = false;
    return;
  }
  wasTagFilterOpenOnMouseDown = isTagFilterOpen.value;
}

function handleTagSelectClick(e: MouseEvent) {
  const target = e.target as HTMLElement | null;
  if (target?.closest('.n-tag__close, .n-base-close, .n-base-clear')) {
    return;
  }
  if (wasTagFilterOpenOnMouseDown) {
    isTagFilterOpen.value = false;
    wasTagFilterOpenOnMouseDown = false;
    tagSelectRef.value?.blurInput();
  }
}
const selectedIds = ref<string[]>([]);
const bulkBusy = ref(false);
const bulkCancel = ref(false);
const bulkTotal = ref(0);
const bulkResults = ref<{id:string;name:string;status:string}[]>([]);

const selectedProjects = computed(() => {
  return projectStore.projects.filter((p) => selectedIds.value.includes(p.id));
});

const isAllSelectedFavorite = computed(() => {
  if (selectedProjects.value.length === 0) return false;
  return selectedProjects.value.every((p) => !!p.favorite);
});

const isAllSelectedArchived = computed(() => {
  if (selectedProjects.value.length === 0) return false;
  return selectedProjects.value.every((p) => !!p.archived);
});

const isBatchStarActivating = ref(false);
const isBatchArchiveActivating = ref(false);

function triggerBatchStarAnimation() {
  isBatchStarActivating.value = true;
  setTimeout(() => {
    isBatchStarActivating.value = false;
  }, 480);
}

function triggerBatchArchiveAnimation() {
  isBatchArchiveActivating.value = true;
  setTimeout(() => {
    isBatchArchiveActivating.value = false;
  }, 440);
}

watch(isAllSelectedFavorite, (newVal, oldVal) => {
  if (!oldVal && newVal) {
    triggerBatchStarAnimation();
  }
});

watch(isAllSelectedArchived, (newVal, oldVal) => {
  if (!oldVal && newVal) {
    triggerBatchArchiveAnimation();
  }
});

function selectProject(id: string, selected: boolean) {
  if (bulkBusy.value) return;
  selectedIds.value = selected ? [...new Set([...selectedIds.value, id])] : selectedIds.value.filter(item => item !== id);
}
async function organizeSelected(patch: UpdateProjectInput) {
  const selected = selectedIds.value.map(id => ({id, name:projectStore.projects.find(p => p.id === id)?.name ?? id}));
  bulkBusy.value = true; bulkCancel.value = false; bulkTotal.value = selected.length; bulkResults.value = [];
  try {
    await runOrganizationBatch(selected, () => bulkCancel.value,
      item => window.codehelm.projects.update(item.id, patch),
      (item, status) => { bulkResults.value.push({...item,status}); });
  } finally {
    bulkBusy.value = false;
    await projectStore.fetchProjects();
    selectedIds.value = selectedIds.value.filter(id => projectStore.projects.some(p => p.id === id));
    const successCount = bulkResults.value.filter((r) => r.status === '已完成').length;
    if (successCount > 0) {
      message.success(`批量整理完成：成功 ${successCount} / ${bulkTotal.value}`);
    }
  }
}

// Persist overview filters across route navigation
const savedFilter = sessionStorage.getItem('codehelm_overview_filter') || 'ALL';
const activeFilter = ref<string>(savedFilter);

const savedOnlyRunning = sessionStorage.getItem('codehelm_overview_only_running') === 'true';
const onlyRunning = ref(savedOnlyRunning);

watch(onlyRunning, (val) => {
  sessionStorage.setItem('codehelm_overview_only_running', String(val));
});

const savedSortBy = (sessionStorage.getItem('codehelm_overview_sort_by') as 'recent' | 'lastRun' | 'name' | 'services' | 'status') || 'recent';
const sortBy = ref<'recent' | 'lastRun' | 'name' | 'services' | 'status'>(savedSortBy);

watch(sortBy, (val) => {
  sessionStorage.setItem('codehelm_overview_sort_by', val);
});

const isSortOpen = ref(false);

// Smooth Sliding Magnetic Indicator for Ecosystem Filter Bar
const tabContainerRef = ref<HTMLElement | null>(null);
const tabRefs = new Map<string, HTMLElement>();
const isTransitionReady = ref(false);

function setTabRef(key: string, el: any) {
  if (el) {
    tabRefs.set(key, (el as any).$el || el);
  } else {
    tabRefs.delete(key);
  }
}

const indicatorStyle = ref<{
  transform: string;
  width: string;
  height: string;
  opacity: number;
}>({
  transform: 'translate(0px, 0px)',
  width: '0px',
  height: '0px',
  opacity: 0,
});

function updateIndicator() {
  const container = tabContainerRef.value;
  if (!container) return;

  const activeEl = tabRefs.get(activeFilter.value) || container.querySelector<HTMLElement>(`[data-tab="${activeFilter.value}"]`);
  if (!activeEl) {
    indicatorStyle.value = {
      transform: 'translate(0px, 0px)',
      width: '0px',
      height: '0px',
      opacity: 0,
    };
    return;
  }

  const left = Math.round(activeEl.offsetLeft);
  const top = Math.round(activeEl.offsetTop);
  const width = Math.round(activeEl.offsetWidth);
  const height = Math.round(activeEl.offsetHeight);

  if (width === 0 && height === 0) {
    return;
  }

  indicatorStyle.value = {
    transform: `translate(${left}px, ${top}px)`,
    width: `${width}px`,
    height: `${height}px`,
    opacity: 1,
  };
}

function handleSelectFilter(val: string) {
  activeFilter.value = val;
  sessionStorage.setItem('codehelm_overview_filter', val);
  nextTick(updateIndicator);
}

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  runnerStore.setupListeners();
  void runnerStore.fetchState();

  nextTick(() => {
    updateIndicator();
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          isTransitionReady.value = true;
        });
      });
    } else {
      isTransitionReady.value = true;
    }
  });

  if (typeof ResizeObserver !== 'undefined' && tabContainerRef.value) {
    resizeObserver = new ResizeObserver(() => {
      updateIndicator();
    });
    resizeObserver.observe(tabContainerRef.value);
  }

  window.addEventListener('resize', updateIndicator);
});

onUnmounted(() => {
  window.removeEventListener('resize', updateIndicator);
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
});

const sortOptions = [
  { label: '最近运行', value: 'lastRun' },
  { label: '最近更新', value: 'recent' },
  { label: '名称 (A-Z)', value: 'name' },
  { label: '服务数量', value: 'services' },
  { label: '运行状态优先', value: 'status' },
];

const currentSortLabel = computed(() => {
  const found = sortOptions.find((o) => o.value === sortBy.value);
  return found ? found.label : '最近更新';
});

const viewMode = ref<'grid' | 'list'>(
  localStorage.getItem('codehelm_overview_view_mode') === 'list' ? 'list' : 'grid'
);

function setViewMode(mode: 'grid' | 'list') {
  viewMode.value = mode;
  localStorage.setItem('codehelm_overview_view_mode', mode);
}

const totalModulesCount = computed(() => {
  let count = 0;
  for (const p of projectStore.projects || []) {
    count += p.moduleCount || 1;
  }
  return count;
});

const uniqueTechnologies = computed(() => {
  const set = new Set<string>();
  for (const p of projectStore.projects || []) {
    for (const l of p.primaryLanguages || []) {
      if (l) set.add(l);
    }
    for (const f of p.primaryFrameworks || []) {
      if (f) set.add(f);
    }
  }
  return Array.from(set);
});

const topTechnologiesText = computed(() => {
  if (uniqueTechnologies.value.length === 0) return '尚未识别技术栈';
  return uniqueTechnologies.value.slice(0, 4).join(' • ');
});

const runtimeReady = computed(() => runnerStore.stateLoaded && !runnerStore.stateError);
const projectsWithRuntime = computed(() => projectStore.projects.map(project => ({
  ...project, runtime: runnerStore.getProjectState(project.id),
})));
const runningProjectsCount = computed(() => projectsWithRuntime.value.filter(p => p.runtime.runningCount > 0).length);

function runtimeStatusLabel(status: string, projectId: string) {
  if (status === 'UNKNOWN') return runnerStore.stateError ? '状态未知' : '待读取';
  return status === 'STOPPED' && runnerStore.getUnresolvedCount(projectId) > 0 ? '本次未运行' : status;
}

function runtimeStatusTitle(project: ProjectSummaryDto) {
  const current = runtimeReady.value ? '本次受管状态；未运行不代表历史遗留进程已退出。' : '运行状态尚未可靠读取。';
  return current + (project.lastRunStatus ? ` 上次运行记录：${project.lastRunStatus}（仅作历史参考）` : '');
}

interface EcosystemCategory {
  key: string;
  label: string;
  match: (p: ProjectSummaryDto) => boolean;
}

const standardEcosystems: EcosystemCategory[] = [
  {
    key: 'NODE_WEB',
    label: 'Node / Web 前端',
    match: (p) => {
      const items = [
        ...(Array.isArray(p.primaryLanguages) ? p.primaryLanguages : []),
        ...(Array.isArray(p.primaryFrameworks) ? p.primaryFrameworks : []),
      ].map((s) => (s || '').toLowerCase());
      return items.some((i) =>
        ['vue', 'react', 'typescript', 'javascript', 'html', 'next.js', 'vite', 'nuxt', 'node.js', 'express', 'nestjs', 'electron', 'angular', 'svelte'].includes(i)
      );
    },
  },
  {
    key: 'PYTHON_AI',
    label: 'Python / AI',
    match: (p) => {
      const items = [
        ...(Array.isArray(p.primaryLanguages) ? p.primaryLanguages : []),
        ...(Array.isArray(p.primaryFrameworks) ? p.primaryFrameworks : []),
      ].map((s) => (s || '').toLowerCase());
      return items.some((i) =>
        ['python', 'fastapi', 'flask', 'django', 'pytorch', 'langchain', 'openai', 'transformers', 'pandas', 'numpy'].includes(i)
      );
    },
  },
  {
    key: 'JAVA_SPRING',
    label: 'Java / Spring',
    match: (p) => {
      const items = [
        ...(Array.isArray(p.primaryLanguages) ? p.primaryLanguages : []),
        ...(Array.isArray(p.primaryFrameworks) ? p.primaryFrameworks : []),
      ].map((s) => (s || '').toLowerCase());
      return items.some((i) =>
        ['java', 'spring', 'spring boot', 'maven', 'gradle', 'kotlin'].includes(i)
      );
    },
  },
  {
    key: 'GO',
    label: 'Go',
    match: (p) => {
      const items = [
        ...(Array.isArray(p.primaryLanguages) ? p.primaryLanguages : []),
        ...(Array.isArray(p.primaryFrameworks) ? p.primaryFrameworks : []),
      ].map((s) => (s || '').toLowerCase());
      return items.some((i) =>
        ['go', 'gin', 'echo', 'fiber', 'go modules', 'golang'].includes(i)
      );
    },
  },
  {
    key: 'RUST',
    label: 'Rust',
    match: (p) => {
      const items = [
        ...(Array.isArray(p.primaryLanguages) ? p.primaryLanguages : []),
        ...(Array.isArray(p.primaryFrameworks) ? p.primaryFrameworks : []),
      ].map((s) => (s || '').toLowerCase());
      return items.some((i) =>
        ['rust', 'cargo', 'actix', 'axum', 'tauri', 'tokio'].includes(i)
      );
    },
  },
];

const filterOptions = computed(() => {
  const list = projectStore.projects || [];
  const res = [
    { label: '全部项目', value: 'ALL', count: list.length },
  ];

  for (const eco of standardEcosystems) {
    const count = list.filter(eco.match).length;
    if (count > 0) {
      res.push({
        label: eco.label,
        value: eco.key,
        count,
      });
    }
  }

  return res;
});

watch([() => activeFilter.value, () => filterOptions.value], () => {
  if (activeFilter.value !== 'ALL' && filterOptions.value.length > 0) {
    if (!filterOptions.value.some((o) => o.value === activeFilter.value)) {
      activeFilter.value = 'ALL';
      sessionStorage.setItem('codehelm_overview_filter', 'ALL');
    }
  }
  nextTick(updateIndicator);
}, { deep: true });

const filteredProjects = computed(() => {
  const list = projectsWithRuntime.value;

  return list.filter((p) => {
    if (!p) return false;
    if (!matchesOrganization(p, organizationScope.value, onlyFavorites.value, selectedTags.value)) return false;

    // 1. Independent Running status toggle
    if (onlyRunning.value) {
      if (p.runtime.runningCount === 0) return false;
    }

    // 2. Dynamic Ecosystem category
    if (activeFilter.value !== 'ALL') {
      const eco = standardEcosystems.find((e) => e.key === activeFilter.value);
      if (eco && !eco.match(p)) return false;
    }

    // 3. Search query
    if (searchQuery.value && searchQuery.value.trim()) {
      const q = searchQuery.value.toLowerCase().trim();
      const matchName = (p.name || '').toLowerCase().includes(q);
      const matchPath = (p.rootPath || '').toLowerCase().includes(q);
      const langs = Array.isArray(p.primaryLanguages) ? p.primaryLanguages : [];
      const frameworks = Array.isArray(p.primaryFrameworks) ? p.primaryFrameworks : [];
      const tags = Array.isArray(p.tags) ? p.tags : [];
      const matchLang = langs.some((l: string) => (l || '').toLowerCase().includes(q));
      const matchFw = frameworks.some((f: string) => (f || '').toLowerCase().includes(q));
      const matchTag = tags.some((t: string) => (t || '').toLowerCase().includes(q));
      if (!matchName && !matchPath && !matchLang && !matchFw && !matchTag) return false;
    }

    return true;
  });
});

const sortedProjects = computed(() => {
  const list = [...filteredProjects.value];
  if (sortBy.value === 'lastRun') return list.sort(compareLastRun);
  if (sortBy.value === 'name') {
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }
  if (sortBy.value === 'services') {
    return list.sort((a, b) => (b.serviceCount || 0) - (a.serviceCount || 0));
  }
  if (sortBy.value === 'status') {
    const statusWeight = (s?: string) => {
      if (s === 'RUNNING') return 1;
      if (s === 'STARTING') return 2;
      if (s === 'FAILED') return 3;
      return 4;
    };
    return list.sort((a, b) => Number(b.runtime.runningCount > 0) - Number(a.runtime.runningCount > 0)
      || statusWeight(a.runtime.status) - statusWeight(b.runtime.status));
  }
  return list;
});

const projectListRef = ref<HTMLElement | null>(null);
const currentPage = ref(1);
const pageBounds = computed(() => getPageBounds(sortedProjects.value.length, currentPage.value, 24));
const pagedProjects = computed(() => sortedProjects.value.slice(pageBounds.value.start, pageBounds.value.end));

function toggleSelectPage() {
  if (bulkBusy.value) return;
  if (selectedIds.value.length > 0) {
    selectedIds.value = [];
  } else {
    selectedIds.value = pagedProjects.value.map((p) => p.id);
  }
}

watch([activeFilter, onlyRunning, searchQuery, sortBy, organizationScope, onlyFavorites, selectedTags], () => {
  currentPage.value = 1;
  nextTick(() => { if (projectListRef.value) projectListRef.value.scrollTop = 0; });
});
watch(() => pageBounds.value.page, (page) => {
  currentPage.value = page;
  nextTick(() => { if (projectListRef.value) projectListRef.value.scrollTop = 0; });
});

function navigateToProject(id: string) {
  router.push(`/projects/${id}`);
}

function handleRemove(id: string, name: string) {
  dialog.warning({
    title: '确认移除项目',
    content: `确定从 CodeHelm 中移除项目 "${name}" 吗？此操作仅清除本控制台中的配置与运行记录，绝不会修改或删除您的本地源代码。`,
    positiveText: '确认移除',
    negativeText: '取消',
    positiveButtonProps: {
      type: 'error',
    },
    onPositiveClick: async () => {
      await projectStore.removeProject(id);
      message.success(`已移除项目: ${name}`);
    },
  });
}

function statusBadgeClass(status?: string) {
  switch (status) {
    case 'RUNNING':
      return themeStore.isDark
        ? 'bg-white text-black border-white font-bold'
        : 'bg-black text-white border-black font-bold';
    case 'STARTING':
      return themeStore.isDark
        ? 'bg-zinc-800 text-zinc-200 border-zinc-700'
        : 'bg-zinc-200 text-zinc-800 border-zinc-300';
    case 'FAILED':
    case 'DEGRADED':
    case 'ORPHANED':
      return themeStore.isDark
        ? 'bg-rose-950/40 text-rose-300 border-rose-800'
        : 'bg-rose-50 text-rose-700 border-rose-200';
    default:
      return themeStore.isDark
        ? 'bg-zinc-800 text-zinc-400 border-zinc-700'
        : 'bg-zinc-100 text-zinc-600 border-zinc-200';
  }
}
</script>

<style scoped>
@media (prefers-reduced-motion: reduce) {
  .ecosystem-filter-tab,
  .ecosystem-filter-tab span,
  .ecosystem-tab-indicator {
    transition: none !important;
  }
}

/* Clean Ghost-Free Tab & View Crossfade Transition */
.tab-crossfade-enter-active {
  transition: opacity 100ms ease-out;
  will-change: opacity;
}

.tab-crossfade-leave-active {
  /* out-in must release the old results immediately; retain the incoming feedback. */
  transition: none;
}

.tab-crossfade-enter-from {
  opacity: 0;
}

.tab-crossfade-leave-to {
  opacity: 0;
}

@keyframes refresh-spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

.animate-refresh-spin {
  animation: refresh-spin 650ms cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

/* Option A: Micro-Spring Press & Pop on Select/Cancel toggle button */
:deep(.n-button.btn-select-toggle) {
  --n-ripple-duration: 0s !important;
  --n-ripple-color: transparent !important;
  --n-wave-opacity: 0 !important;
  transition: transform 120ms cubic-bezier(0.34, 1.56, 0.64, 1), background-color 150ms ease, color 150ms ease, border-color 150ms ease !important;
  will-change: transform;
  user-select: none !important;
}

:deep(.n-button.btn-select-toggle:active) {
  transform: scale(0.95) !important;
  transition-duration: 70ms !important;
}

/* Completely suppress Naive UI water wave ripple effect */
:deep(.n-button.btn-select-toggle .n-base-wave),
:deep(.n-button.btn-select-toggle .n-base-wave--active),
:deep(.n-button.btn-cancel-selection .n-base-wave),
:deep(.n-button.btn-cancel-selection .n-base-wave--active) {
  display: none !important;
  opacity: 0 !important;
  animation: none !important;
  box-shadow: none !important;
  visibility: hidden !important;
  pointer-events: none !important;
}

/* Star Pill Toggle Button for Favorite Filter */
.btn-favorite-filter {
  height: 32px;
  min-width: 68px;
  padding: 0 10px;
  border-radius: 8px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "微软雅黑", sans-serif !important;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  user-select: none;
  cursor: pointer;
  outline: none;
  border: 1px solid transparent;
  transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease;
  box-sizing: border-box;
}

.btn-favorite-filter:active {
  transform: scale(0.97);
  transition: transform 70ms ease;
}

.btn-favorite-filter-label {
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}

html.light .btn-favorite-filter {
  background-color: #f4f4f5;
  border-color: #e4e4e7;
  color: #52525b;
}
html.light .btn-favorite-filter:hover {
  background-color: #e4e4e7;
  border-color: #d4d4d8;
  color: #27272a;
}
html.light .btn-favorite-filter.is-active {
  background-color: #fffbeb;
  border-color: #fcd34d;
  color: #78350f;
  font-weight: 500;
}
html.light .btn-favorite-filter.is-active:hover {
  background-color: #fef3c7;
  border-color: #fbbf24;
}

html.dark .btn-favorite-filter {
  background-color: #141418;
  border-color: #27272a;
  color: #a1a1aa;
}
html.dark .btn-favorite-filter:hover {
  background-color: #1e1e24;
  border-color: #3f3f46;
  color: #e4e4e7;
}
html.dark .btn-favorite-filter.is-active {
  background-color: rgba(245, 158, 11, 0.15);
  border-color: rgba(251, 191, 36, 0.35);
  color: #fcd34d;
  font-weight: 500;
}
html.dark .btn-favorite-filter.is-active:hover {
  background-color: rgba(245, 158, 11, 0.22);
  border-color: rgba(251, 191, 36, 0.55);
}

.btn-favorite-filter-icon {
  flex-shrink: 0;
  transition: color 150ms ease;
}

html.light .btn-favorite-filter .btn-favorite-filter-icon {
  color: #71717a;
}
html.light .btn-favorite-filter.is-active .btn-favorite-filter-icon {
  color: #f59e0b;
}

html.dark .btn-favorite-filter .btn-favorite-filter-icon {
  color: #71717a;
}
html.dark .btn-favorite-filter.is-active .btn-favorite-filter-icon {
  color: #fbbf24;
}

/* =========================================================
   Native Batch Organization Action Buttons (No Naive UI Wave)
   ========================================================= */

.btn-batch-action {
  height: 28px;
  min-width: 116px;
  padding: 0 10px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  user-select: none;
  cursor: pointer;
  outline: none;
  border: 1px solid transparent;
  transition: transform 120ms cubic-bezier(0.34, 1.56, 0.64, 1),
              background-color 160ms ease,
              border-color 160ms ease,
              color 160ms ease,
              box-shadow 160ms ease;
  will-change: transform;
}

.btn-batch-action:active:not(:disabled) {
  transform: scale(0.96);
  transition-duration: 70ms;
}

.btn-batch-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none !important;
}

/* Light Mode: Base Inactive */
html.light .btn-batch-action {
  background-color: #ffffff;
  border-color: #e4e4e7;
  color: #27272a;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}
html.light .btn-batch-action:hover:not(:disabled) {
  background-color: #f4f4f5;
  border-color: #d4d4d8;
  color: #09090b;
}

/* Dark Mode: Base Inactive */
html.dark .btn-batch-action {
  background-color: #18181b;
  border-color: #27272a;
  color: #e4e4e7;
}
html.dark .btn-batch-action:hover:not(:disabled) {
  background-color: #27272a;
  border-color: #3f3f46;
  color: #ffffff;
}

/* Light Mode: Star Active State (批量取消收藏) */
html.light .btn-batch-star.is-active {
  background-color: #fffbeb;
  border-color: #fcd34d;
  color: #92400e;
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(245, 158, 11, 0.15);
}
html.light .btn-batch-star.is-active:hover:not(:disabled) {
  background-color: #fef3c7;
  border-color: #fbbf24;
}

/* Dark Mode: Star Active State (批量取消收藏) */
html.dark .btn-batch-star.is-active {
  background-color: rgba(245, 158, 11, 0.15);
  border-color: rgba(251, 191, 36, 0.35);
  color: #fef08a;
  font-weight: 600;
}
html.dark .btn-batch-star.is-active:hover:not(:disabled) {
  background-color: rgba(245, 158, 11, 0.22);
  border-color: rgba(251, 191, 36, 0.55);
}

/* Light Mode: Archive Active State (批量取消归档) */
html.light .btn-batch-archive.is-active {
  background-color: #f0f9ff;
  border-color: #7dd3fc;
  color: #0369a1;
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(14, 165, 233, 0.15);
}
html.light .btn-batch-archive.is-active:hover:not(:disabled) {
  background-color: #e0f2fe;
  border-color: #38bdf8;
}

/* Dark Mode: Archive Active State (批量取消归档) */
html.dark .btn-batch-archive.is-active {
  background-color: rgba(14, 165, 233, 0.15);
  border-color: rgba(56, 189, 248, 0.35);
  color: #bae6fd;
  font-weight: 600;
}
html.dark .btn-batch-archive.is-active:hover:not(:disabled) {
  background-color: rgba(14, 165, 233, 0.22);
  border-color: rgba(56, 189, 248, 0.55);
}

/* Button Text Transition */
.batch-btn-label {
  display: inline-block;
  will-change: transform, opacity;
  white-space: nowrap;
}

.batch-btn-text-enter-active,
.batch-btn-text-leave-active {
  transition: opacity 0.16s cubic-bezier(0.16, 1, 0.3, 1),
              transform 0.16s cubic-bezier(0.16, 1, 0.3, 1);
}

.batch-btn-text-enter-from {
  opacity: 0;
  transform: translateY(3px) scale(0.96);
}

.batch-btn-text-leave-to {
  opacity: 0;
  transform: translateY(-3px) scale(0.96);
}

/* Action Icons */
.btn-batch-icon {
  flex-shrink: 0;
  transform-origin: 50% 50%;
  transition: transform 0.26s cubic-bezier(0.34, 1.56, 0.64, 1),
              color 0.2s ease,
              stroke 0.2s ease,
              filter 0.2s ease;
  will-change: transform;
}

/* Star Icon Colors */
html.light .btn-batch-icon-star {
  color: #71717a;
  stroke: #71717a;
}
html.light .btn-batch-star:hover:not(:disabled) .btn-batch-icon-star {
  color: #d97706;
  stroke: #d97706;
}
html.light .btn-batch-icon-star.is-active {
  color: #f59e0b !important;
  stroke: #f59e0b !important;
  filter: drop-shadow(0 1px 2px rgba(245, 158, 11, 0.45));
}

html.dark .btn-batch-icon-star {
  color: #a1a1aa;
  stroke: #a1a1aa;
}
html.dark .btn-batch-star:hover:not(:disabled) .btn-batch-icon-star {
  color: #facc15;
  stroke: #facc15;
}
html.dark .btn-batch-icon-star.is-active {
  color: #facc15 !important;
  stroke: #facc15 !important;
  filter: drop-shadow(0 1px 2px rgba(250, 204, 21, 0.45));
}

.btn-batch-icon-star.is-animating {
  animation: star-spring-bounce 0.46s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

/* Archive Icon Colors */
html.light .btn-batch-icon-archive {
  color: #71717a;
  stroke: #71717a;
}
html.light .btn-batch-archive:hover:not(:disabled) .btn-batch-icon-archive {
  color: #0284c7;
  stroke: #0284c7;
}
html.light .btn-batch-icon-archive.is-active {
  color: #0284c7 !important;
  stroke: #0284c7 !important;
  filter: drop-shadow(0 1px 2px rgba(2, 132, 199, 0.45));
}

html.dark .btn-batch-icon-archive {
  color: #a1a1aa;
  stroke: #a1a1aa;
}
html.dark .btn-batch-archive:hover:not(:disabled) .btn-batch-icon-archive {
  color: #38bdf8;
  stroke: #38bdf8;
}
html.dark .btn-batch-icon-archive.is-active {
  color: #38bdf8 !important;
  stroke: #38bdf8 !important;
  filter: drop-shadow(0 1px 2px rgba(56, 189, 248, 0.45));
}

.btn-batch-icon-archive.is-animating {
  animation: archive-spring-bounce 0.42s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

@keyframes star-spring-bounce {
  0% { transform: scale(0.76) rotate(-14deg); }
  42% { transform: scale(1.32) rotate(6deg); }
  72% { transform: scale(0.93) rotate(-2deg); }
  100% { transform: scale(1) rotate(0deg); }
}

@keyframes archive-spring-bounce {
  0% { transform: scale(0.85) translateY(1.5px); }
  42% { transform: scale(1.24) translateY(-2px); }
  72% { transform: scale(0.95) translateY(0.5px); }
  100% { transform: scale(1) rotate(0deg); }
}

@media (prefers-reduced-motion: reduce) {
  .btn-batch-icon-star.is-animating,
  .btn-batch-icon-archive.is-animating {
    animation: none !important;
  }
  .btn-batch-icon,
  .btn-batch-action,
  .batch-btn-text-enter-active,
  .batch-btn-text-leave-active {
    transition: none !important;
  }
}

</style>
