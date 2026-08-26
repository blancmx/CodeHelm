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
            class="text-xs border px-2.5 py-0.5 rounded-full font-mono font-medium"
            :class="themeStore.isDark ? 'bg-[#18181b] text-zinc-300 border-[#27272a]' : 'bg-zinc-100 text-zinc-800 border-zinc-200'"
          >
            {{ projectStore.projects.length }} 个工程
          </span>
        </div>
        <p class="text-xs mt-1" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
          集中式工程工作区、技术栈自动推断画像与全生命周期进程编排
        </p>
      </div>

      <!-- Header Actions: Search & Import & View Toggle -->
      <div class="flex items-center gap-2.5 flex-shrink-0">
        <!-- Global Search Input -->
        <div class="relative flex items-center">
          <n-input
            v-model:value="searchQuery"
            placeholder="搜索项目..."
            clearable
            size="small"
            class="text-xs font-sans"
            style="width: 280px;"
            :input-props="{ style: { fontSize: '12px', lineHeight: '20px' } }"
          >
            <template #prefix>
              <IconSearch :size="14" class="text-zinc-400 mr-1.5 flex-shrink-0" />
            </template>
          </n-input>
        </div>

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
          <div class="text-[11px] font-medium" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
            已纳管工程总数
          </div>
          <div class="text-2xl font-bold mt-1 font-mono tracking-tight" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
            {{ projectStore.projects.length }}
          </div>
          <div class="text-[10px] mt-1 flex items-center gap-1.5" :class="themeStore.isDark ? 'text-zinc-500' : 'text-zinc-400'">
            <span>覆盖 {{ totalModulesCount }} 个子模块</span>
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
          <div class="text-[11px] font-medium flex items-center gap-1.5" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
            <span>活跃运行中服务</span>
            <span v-if="runnerStore.runningCount > 0" class="w-1.5 h-1.5 rounded-full bg-white pulsing-dot-active" />
          </div>
          <div class="text-2xl font-bold mt-1 font-mono tracking-tight" :class="runnerStore.runningCount > 0 ? (themeStore.isDark ? 'text-white' : 'text-zinc-950') : (themeStore.isDark ? 'text-zinc-500' : 'text-zinc-400')">
            {{ runnerStore.runningCount }}
          </div>
          <div class="text-[10px] mt-1 flex items-center gap-1" :class="themeStore.isDark ? 'text-zinc-400 group-hover:text-white' : 'text-zinc-500 group-hover:text-zinc-900'">
            <span>查看控制中心日志流</span>
            <IconArrowRight :size="10" class="transition-transform group-hover:translate-x-0.5" />
          </div>
        </div>
        <div
          class="w-10 h-10 rounded-xl flex items-center justify-center border transition-colors"
          :class="runnerStore.runningCount > 0
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
          <div class="text-[11px] font-medium" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
            技术生态与语言画像
          </div>
          <div class="text-2xl font-bold mt-1 font-mono tracking-tight" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
            {{ uniqueTechnologies.length }} <span class="text-xs font-normal font-sans" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">类技术</span>
          </div>
          <div class="text-[10px] mt-1 truncate max-w-200px font-mono" :class="themeStore.isDark ? 'text-zinc-500' : 'text-zinc-400'">
            {{ topTechnologiesText }}
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

    <!-- Quick Filter Tabs, Sorting & View Mode Switcher -->
    <div class="flex items-center justify-between pt-3 pb-2 flex-shrink-0 gap-3">
      <!-- Left: Dynamic Ecosystem Tabs & Independent Running Toggle -->
      <div class="flex items-center gap-2 overflow-x-auto py-0.5 min-w-0">
        <!-- Dynamic Ecosystem Filter Tabs -->
        <div class="flex items-center gap-1.5 flex-shrink-0">
          <button
            v-for="filter in filterOptions"
            :key="filter.value"
            type="button"
            class="h-7 px-3 rounded-lg text-xs font-medium transition-colors duration-150 cursor-pointer flex items-center justify-center flex-shrink-0 select-none border"
            :class="activeFilter === filter.value
              ? (themeStore.isDark ? 'bg-white text-black border-white shadow-xs' : 'bg-black text-white border-black shadow-xs')
              : (themeStore.isDark ? 'bg-[#18181b] text-zinc-400 hover:text-white border-[#27272a] hover:border-zinc-500' : 'bg-white text-zinc-700 hover:bg-zinc-100 border-zinc-200 hover:border-zinc-300')"
            @click="activeFilter = filter.value"
          >
            <span>{{ filter.label }}</span>
            <span
              v-if="filter.count !== undefined"
              class="ml-1 text-[10px] font-mono opacity-80"
            >
              ({{ filter.count }})
            </span>
          </button>
        </div>

        <!-- Vertical Divider -->
        <div class="h-4 w-[1px] flex-shrink-0" :class="themeStore.isDark ? 'bg-[#27272a]' : 'bg-zinc-200'" />

        <!-- Independent Running Status Filter Toggle Pill -->
        <button
          type="button"
          class="h-7 px-2.5 rounded-lg text-xs font-medium transition-colors duration-150 cursor-pointer flex items-center gap-1.5 flex-shrink-0 select-none border"
          :class="[
            onlyRunning
              ? (themeStore.isDark
                  ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/80 shadow-xs'
                  : 'bg-emerald-50 text-emerald-800 border-emerald-400 shadow-xs')
              : (themeStore.isDark
                  ? 'bg-[#18181b] text-zinc-400 hover:text-zinc-200 border-[#27272a] hover:border-zinc-500'
                  : 'bg-white text-zinc-600 hover:text-zinc-900 border-zinc-200 hover:border-zinc-300 shadow-2xs')
          ]"
          :title="onlyRunning ? '点击展示所有状态项目' : '点击仅筛选当前处于运行中的项目'"
          @click="onlyRunning = !onlyRunning"
        >
          <span
            class="w-1.5 h-1.5 rounded-full flex-shrink-0"
            :class="runningProjectsCount > 0 ? (onlyRunning ? 'bg-emerald-400 pulsing-dot-active' : 'bg-emerald-400') : 'bg-zinc-400'"
          />
          <span>仅看运行中</span>
          <span class="text-[10px] opacity-80 font-mono">({{ runningProjectsCount }})</span>
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
            class="h-7.5 w-[124px] px-2.5 rounded-lg border flex items-center justify-between text-xs font-medium transition-all cursor-pointer select-none"
            :class="[
              isSortOpen
                ? (themeStore.isDark ? 'bg-[#18181b] border-white text-white shadow-xs' : 'bg-white border-black text-black shadow-xs')
                : (themeStore.isDark ? 'bg-[#18181b] border-[#27272a] text-zinc-300 hover:border-zinc-500' : 'bg-white border-zinc-200 text-zinc-700 hover:border-zinc-400 shadow-2xs')
            ]"
            title="选择排序方式"
          >
            <span class="truncate">{{ currentSortLabel }}</span>
            <IconChevronDown
              :size="12"
              class="transition-transform duration-300 ease-in-out flex-shrink-0 ml-1"
              :class="isSortOpen ? 'rotate-180 text-white' : 'rotate-0 text-zinc-400'"
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

    <!-- Main Content Area with Smooth View Transition -->
    <div class="flex-1 overflow-y-auto pt-2 flex flex-col [scrollbar-gutter:stable]">
      <transition name="view-fade-slide" mode="out-in">
        <!-- Empty State -->
        <div
          v-if="filteredProjects.length === 0 && !searchQuery.trim() && activeFilter === 'ALL' && !onlyRunning"
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
            <div class="text-[10px] mt-1 leading-normal" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
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
            <div class="text-[10px] mt-1 leading-normal" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
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
            <div class="text-[10px] mt-1 leading-normal" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
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
        key="no-results"
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
        key="grid-view"
        class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-6"
      >
        <div
          v-for="project in sortedProjects"
          :key="project.id"
          class="border rounded-xl p-5 transition-all duration-200 cursor-pointer flex flex-col justify-between group"
          :class="themeStore.isDark
            ? 'bg-[#121216] hover:bg-[#18181c] border-[#27272a] hover:border-zinc-500 shadow-sm'
            : 'bg-white hover:bg-zinc-50 border-zinc-200 hover:border-zinc-400 shadow-sm'"
          @click="navigateToProject(project.id)"
        >
          <div>
            <!-- Top Card Info -->
            <div class="flex items-start justify-between">
              <div class="flex items-center gap-3 min-w-0">
                <!-- Monogram Avatar -->
                <div
                  class="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm flex-shrink-0 border font-mono transition-transform duration-200 group-hover:scale-105"
                  :class="themeStore.isDark ? 'bg-[#18181b] border-[#27272a] text-white' : 'bg-zinc-100 border-zinc-200 text-zinc-900'"
                >
                  {{ (project.name || 'P').slice(0, 2).toUpperCase() }}
                </div>
                <div class="min-w-0">
                  <h4
                    class="font-bold text-sm group-hover:underline transition-all truncate"
                    :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'"
                  >
                    {{ project.name }}
                  </h4>
                  <p
                    class="text-[11px] font-mono truncate max-w-200px mt-0.5"
                    :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'"
                    :title="project.rootPath"
                  >
                    {{ project.rootPath }}
                  </p>
                </div>
              </div>

              <!-- Status Badge (Monochrome) -->
              <span
                v-if="project.lastRunStatus"
                class="px-2 py-0.5 rounded-full text-[10px] font-mono font-medium flex items-center gap-1.5 flex-shrink-0 border"
                :class="statusBadgeClass(project.lastRunStatus)"
              >
                <span
                  v-if="project.lastRunStatus === 'RUNNING'"
                  class="w-1.5 h-1.5 rounded-full pulsing-dot-active"
                  :class="themeStore.isDark ? 'bg-white' : 'bg-black'"
                />
                <span>{{ project.lastRunStatus }}</span>
              </span>
            </div>

            <!-- Language & Tag Pills (Monochrome) -->
            <div class="flex flex-wrap gap-1.5 mt-3.5">
              <span
                v-for="lang in (project.primaryLanguages || [])"
                :key="lang"
                class="px-2 py-0.5 rounded text-[10px] font-medium border font-mono"
                :class="themeStore.isDark ? 'bg-[#18181b] text-zinc-300 border-[#27272a]' : 'bg-zinc-100 text-zinc-800 border-zinc-200'"
              >
                {{ lang }}
              </span>
              <span
                v-for="framework in (project.primaryFrameworks || [])"
                :key="framework"
                class="px-2 py-0.5 rounded text-[10px] font-medium border font-mono"
                :class="themeStore.isDark ? 'bg-[#27272a] text-zinc-200 border-[#3f3f46]' : 'bg-zinc-200 text-zinc-900 border-zinc-300'"
              >
                {{ framework }}
              </span>
              <span
                v-for="tag in (project.tags || [])"
                :key="tag"
                class="px-2 py-0.5 rounded text-[10px] border"
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
            <div class="flex items-center gap-2 text-[11px] font-medium">
              <span :class="themeStore.isDark ? 'text-zinc-300' : 'text-zinc-700'">{{ project.moduleCount || 0 }} 模块</span>
              <span>•</span>
              <span :class="themeStore.isDark ? 'text-zinc-300' : 'text-zinc-700'">{{ project.serviceCount || 0 }} 服务</span>
            </div>

            <div class="flex items-center gap-2">
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
        key="list-view"
        class="border rounded-xl overflow-hidden pb-6 mb-4"
        :class="themeStore.isDark ? 'bg-[#121216] border-[#27272a]' : 'bg-white border-zinc-200 shadow-sm'"
      >
        <table class="w-full text-left text-xs border-collapse">
          <thead>
            <tr
              class="border-b text-[11px] font-medium"
              :class="themeStore.isDark ? 'bg-[#18181b] border-[#27272a] text-zinc-400' : 'bg-zinc-50 border-zinc-200 text-zinc-600'"
            >
              <th class="py-3 px-4">工程名称</th>
              <th class="py-3 px-4">本地路径</th>
              <th class="py-3 px-4">技术生态</th>
              <th class="py-3 px-4">架构规模</th>
              <th class="py-3 px-4">运行状态</th>
              <th class="py-3 px-4 text-right">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y" :class="themeStore.isDark ? 'divide-[#1f1f23]' : 'divide-zinc-100'">
            <tr
              v-for="project in sortedProjects"
              :key="project.id"
              class="transition-colors cursor-pointer"
              :class="themeStore.isDark ? 'hover:bg-[#18181c]' : 'hover:bg-zinc-50'"
              @click="navigateToProject(project.id)"
            >
              <!-- Project Name & Avatar -->
              <td class="py-3.5 px-4">
                <div class="flex items-center gap-2.5 min-w-0">
                  <div
                    class="w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs flex-shrink-0 border font-mono"
                    :class="themeStore.isDark ? 'bg-[#18181b] border-[#27272a] text-white' : 'bg-zinc-100 border-zinc-200 text-zinc-900'"
                  >
                    {{ (project.name || 'P').slice(0, 2).toUpperCase() }}
                  </div>
                  <span class="font-bold text-xs truncate max-w-160px" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
                    {{ project.name }}
                  </span>
                </div>
              </td>

              <!-- Path -->
              <td class="py-3.5 px-4 font-mono text-[11px] truncate max-w-220px" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'" :title="project.rootPath">
                {{ project.rootPath }}
              </td>

              <!-- Tech Stack -->
              <td class="py-3.5 px-4">
                <div class="flex flex-wrap gap-1 max-w-220px">
                  <span
                    v-for="lang in (project.primaryLanguages || []).slice(0, 3)"
                    :key="lang"
                    class="px-1.5 py-0.2 rounded text-[10px] font-mono border"
                    :class="themeStore.isDark ? 'bg-[#18181b] text-zinc-300 border-[#27272a]' : 'bg-zinc-100 text-zinc-800 border-zinc-200'"
                  >
                    {{ lang }}
                  </span>
                  <span
                    v-for="fw in (project.primaryFrameworks || []).slice(0, 2)"
                    :key="fw"
                    class="px-1.5 py-0.2 rounded text-[10px] font-mono border"
                    :class="themeStore.isDark ? 'bg-[#27272a] text-zinc-200 border-[#3f3f46]' : 'bg-zinc-200 text-zinc-900 border-zinc-300'"
                  >
                    {{ fw }}
                  </span>
                </div>
              </td>

              <!-- Scale -->
              <td class="py-3.5 px-4 text-[11px]" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
                <span>{{ project.moduleCount || 0 }} 模块 / {{ project.serviceCount || 0 }} 服务</span>
              </td>

              <!-- Status -->
              <td class="py-3.5 px-4">
                <span
                  v-if="project.lastRunStatus"
                  class="px-2 py-0.5 rounded-full text-[10px] font-mono font-medium inline-flex items-center gap-1.5 border"
                  :class="statusBadgeClass(project.lastRunStatus)"
                >
                  <span
                    v-if="project.lastRunStatus === 'RUNNING'"
                    class="w-1.5 h-1.5 rounded-full pulsing-dot-active"
                    :class="themeStore.isDark ? 'bg-white' : 'bg-black'"
                  />
                  <span>{{ project.lastRunStatus }}</span>
                </span>
                <span v-else class="text-[11px]" :class="themeStore.isDark ? 'text-zinc-600' : 'text-zinc-400'">
                  未启动
                </span>
              </td>

              <!-- Actions -->
              <td class="py-3.5 px-4 text-right">
                <div class="flex items-center justify-end gap-2" @click.stop>
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
</div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
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
} from '../components/icons/index.js';
import type { ProjectSummaryDto } from '@codehelm/contracts';

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
    await projectStore.fetchProjects();
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
const activeFilter = ref<string>('ALL');
const onlyRunning = ref(false);
const sortBy = ref<'recent' | 'name' | 'services' | 'status'>('recent');
const isSortOpen = ref(false);

const sortOptions = [
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

const runningProjectsCount = computed(() => {
  return (projectStore.projects || []).filter(
    (p: ProjectSummaryDto) => p.lastRunStatus === 'RUNNING' || p.lastRunStatus === 'STARTING'
  ).length;
});

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

const filteredProjects = computed(() => {
  const list = projectStore.projects || [];

  return list.filter((p: ProjectSummaryDto) => {
    if (!p) return false;

    // 1. Independent Running status toggle
    if (onlyRunning.value) {
      if (p.lastRunStatus !== 'RUNNING' && p.lastRunStatus !== 'STARTING') return false;
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
    return list.sort((a, b) => statusWeight(a.lastRunStatus) - statusWeight(b.lastRunStatus));
  }
  return list;
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
.view-fade-slide-enter-active,
.view-fade-slide-leave-active {
  transition: opacity 220ms cubic-bezier(0.4, 0, 0.2, 1), transform 220ms cubic-bezier(0.4, 0, 0.2, 1);
  will-change: opacity, transform;
}

.view-fade-slide-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.view-fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-6px);
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
</style>
