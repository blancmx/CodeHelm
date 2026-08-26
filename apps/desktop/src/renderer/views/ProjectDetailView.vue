<template>
  <div class="flex-1 flex flex-col h-full overflow-hidden p-6" v-if="projectStore.currentProject">
    <!-- Top Header -->
    <header
      class="flex items-center justify-between pb-5 border-b flex-shrink-0 transition-colors duration-200"
      :class="themeStore.isDark ? 'border-[#27272a]' : 'border-zinc-200'"
    >
      <div class="flex items-center gap-4 min-w-0">
        <n-button quaternary circle size="small" @click="$router.push('/')" title="返回项目列表">
          <template #icon>
            <IconArrowLeft :size="16" />
          </template>
        </n-button>
        <div class="min-w-0">
          <div class="flex items-center gap-2.5">
            <h2 class="text-xl font-bold tracking-tight truncate" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
              {{ projectStore.currentProject.name }}
            </h2>
            <div class="flex items-center gap-1.5">
              <div
                class="flex items-center gap-1.5 border px-2.5 py-1 rounded-lg text-xs font-mono cursor-pointer transition-colors group"
                :class="themeStore.isDark ? 'bg-[#18181b] hover:bg-[#27272a] border-[#27272a] text-zinc-300' : 'bg-zinc-100 hover:bg-zinc-200 border-zinc-200 text-zinc-700'"
                @click="copyRootPath"
                title="点击复制完整路径"
              >
                <span class="truncate max-w-320px">{{ projectStore.currentProject.rootPath }}</span>
                <IconCopy :size="13" class="text-zinc-400 group-hover:text-zinc-200" />
              </div>

              <!-- Inline Path Editor Popover -->
              <n-popover trigger="click" v-model:show="isEditPathOpen" placement="bottom-start">
                <template #trigger>
                  <button
                    class="p-1 rounded-md border text-zinc-400 hover:text-white transition-colors cursor-pointer"
                    :class="themeStore.isDark ? 'bg-[#18181b] hover:bg-[#27272a] border-[#27272a]' : 'bg-white hover:bg-zinc-100 border-zinc-200 text-zinc-600'"
                    title="自定义/修正真实项目绝对物理路径"
                    @click="initEditPath"
                  >
                    <IconEdit :size="13" />
                  </button>
                </template>
                <div class="p-2.5 space-y-2.5 w-360px">
                  <div class="text-xs font-bold" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
                    修改项目物理根路径
                  </div>
                  <n-input
                    v-model:value="editingPathInput"
                    size="small"
                    placeholder="输入真实的绝对物理路径..."
                    class="font-mono text-xs"
                    @keyup.enter="handleSavePath"
                  />
                  <div class="flex justify-end gap-2 pt-0.5">
                    <n-button size="tiny" secondary @click="isEditPathOpen = false">取消</n-button>
                    <n-button size="tiny" type="primary" :loading="isSavingPath" :disabled="!editingPathInput.trim()" @click="handleSavePath">
                      保存修改
                    </n-button>
                  </div>
                </div>
              </n-popover>
            </div>
          </div>
          <div class="flex items-center gap-3 text-xs mt-1" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
            <span>导入时间: {{ formatTime(projectStore.currentProject.createdAt) }}</span>
            <span v-if="latestSnapshot?.completedAt">
              • 最近分析: {{ formatTime(latestSnapshot.completedAt) }}
            </span>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-2.5 flex-shrink-0">
        <n-button
          type="default"
          secondary
          size="small"
          :loading="isAnalyzing"
          @click="handleStartAnalysis"
        >
          <template #icon>
            <IconRefresh :size="14" />
          </template>
          {{ isAnalyzing ? '分析中...' : '重新分析' }}
        </n-button>

        <template v-if="isAnyServiceRunning">
          <!-- Quick Web Browser Launch for Running Services (Frontend Web & Backend API Docs) -->
          <n-button
            v-for="srv in runningServicesWithPort"
            :key="srv.url"
            :type="srv.type === 'frontend' ? 'primary' : 'default'"
            :secondary="srv.type !== 'frontend'"
            size="small"
            class="font-semibold shadow-sm cursor-pointer"
            :class="srv.type === 'frontend' ? 'animate-pulse' : ''"
            @click="openBrowser(srv.url)"
          >
            <template #icon>
              <IconExternalLink :size="14" />
            </template>
            {{ srv.label }}
          </n-button>

          <n-button
            type="error"
            secondary
            size="small"
            class="font-semibold shadow-sm !text-rose-600 dark:!text-rose-400 !border-rose-500/40 hover:!bg-rose-500/10"
            @click="handleStopSession"
          >
            <template #icon>
              <IconSquare :size="14" class="text-rose-600 dark:text-rose-400" />
            </template>
            <span class="text-rose-600 dark:text-rose-400 font-semibold">停止全部服务</span>
          </n-button>
        </template>

        <template v-else>
          <n-button
            type="primary"
            secondary
            size="small"
            class="font-semibold"
            :loading="isLaunching"
            :disabled="isLaunching || !activeProfile || activeProfile.services.filter((s) => s.enabled).length === 0"
            @click="handleInstallAndLaunch"
          >
            <template #icon>
              <IconZap :size="14" />
            </template>
            装依赖并运行
          </n-button>

          <n-button
            type="primary"
            size="small"
            class="font-semibold shadow-sm"
            :loading="isLaunching"
            :disabled="isLaunching || !activeProfile || activeProfile.services.filter((s) => s.enabled).length === 0"
            @click="handleLaunchClick"
          >
            <template #icon>
              <IconPlay :size="14" />
            </template>
            一键启动方案
          </n-button>
        </template>
      </div>
    </header>

    <!-- Analysis Progress Bar -->
    <div
      v-if="isAnalyzing"
      class="border rounded-xl p-4 my-3 flex-shrink-0 shadow-sm transition-all"
      :class="themeStore.isDark ? 'bg-[#18181b] border-[#27272a]' : 'bg-zinc-100 border-zinc-300'"
    >
      <div class="flex items-center justify-between text-xs mb-2">
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full pulsing-dot-active" :class="themeStore.isDark ? 'bg-white' : 'bg-black'" />
          <span class="font-semibold tracking-wide" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
            {{ analysisStage }}
          </span>
        </div>
        <span class="font-mono font-bold" :class="themeStore.isDark ? 'text-zinc-300' : 'text-zinc-700'">
          {{ analysisPercentage }}%
        </span>
      </div>
      <n-progress
        type="line"
        :percentage="analysisPercentage"
        :show-indicator="false"
        processing
      />
    </div>

    <!-- Main Tabs -->
    <div class="flex-1 overflow-hidden pt-3 flex flex-col">
      <n-tabs type="line" animated v-model:value="activeMainTab" class="h-full flex flex-col">
        <!-- Tab 1: 概览 (Overview) -->
        <n-tab-pane name="overview" tab="项目概览" class="h-full overflow-y-auto">
          <div class="space-y-4 pt-2 pb-6">
            <!-- Project Description & Key Highlights from README -->
            <div
              v-if="readmeSummary"
              class="border rounded-xl p-5 transition-all"
              :class="themeStore.isDark ? 'bg-[#121216] border-[#27272a]' : 'bg-white border-zinc-200 shadow-sm'"
            >
              <div class="flex items-start justify-between gap-4 pb-3 border-b transition-colors" :class="themeStore.isDark ? 'border-[#20202d]' : 'border-zinc-100'">
                <div class="space-y-1">
                  <div class="flex items-center gap-2">
                    <IconFileText :size="16" :class="themeStore.isDark ? 'text-zinc-300' : 'text-zinc-700'" />
                    <h3 class="text-sm font-bold tracking-tight" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
                      {{ readmeSummary.title || projectStore.currentProject?.name || '项目介绍' }}
                    </h3>
                    <span
                      v-if="readmeSummary.hasReadme"
                      class="text-[10px] font-mono px-1.5 py-0.2 rounded border font-medium"
                      :class="themeStore.isDark ? 'bg-[#18181b] text-zinc-400 border-[#27272a]' : 'bg-zinc-100 text-zinc-600 border-zinc-200'"
                    >
                      README.md
                    </span>
                  </div>
                  <p class="text-xs leading-relaxed" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-600'">
                    {{ readmeSummary.description }}
                  </p>
                </div>
              </div>

              <!-- Main Features List extracted from README -->
              <div v-if="readmeSummary.features && readmeSummary.features.length > 0" class="mt-3.5">
                <div class="text-[11px] font-medium mb-2.5 flex items-center gap-1.5" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
                  <IconZap :size="12" />
                  <span>主要功能与核心亮点</span>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div
                    v-for="(feature, idx) in readmeSummary.features"
                    :key="idx"
                    class="border rounded-lg p-2.5 text-xs flex items-start gap-2.5 transition-colors"
                    :class="themeStore.isDark ? 'bg-[#18181b] border-[#27272a] text-zinc-300' : 'bg-zinc-50 border-zinc-200 text-zinc-800'"
                  >
                    <span class="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" :class="themeStore.isDark ? 'bg-white' : 'bg-black'" />
                    <span class="leading-snug break-words flex-1 select-text">{{ feature }}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- 3 Stat Metrics -->
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div
                class="border rounded-xl p-5 transition-all"
                :class="themeStore.isDark ? 'bg-[#121216] border-[#27272a]' : 'bg-white border-zinc-200 shadow-sm'"
              >
                <div class="text-xs font-medium" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">主导编程语言</div>
                <div class="text-xl font-bold mt-2 flex items-center gap-2" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
                  <span>{{ latestSnapshot?.primaryLanguage || '未分析' }}</span>
                </div>
                <div class="text-xs mt-1 font-medium" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
                  共识别 {{ latestSnapshot?.languages?.length || 0 }} 种语言
                </div>
              </div>

              <div
                class="border rounded-xl p-5 transition-all"
                :class="themeStore.isDark ? 'bg-[#121216] border-[#27272a]' : 'bg-white border-zinc-200 shadow-sm'"
              >
                <div class="text-xs font-medium" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">架构与模块</div>
                <div class="text-xl font-bold mt-2 font-mono" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
                  {{ latestSnapshot?.modules?.length || 1 }} <span class="text-sm font-sans font-normal" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">个独立模块</span>
                </div>
                <div class="text-xs mt-1 font-medium" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
                  检测到 {{ allDetectedTechs.length }} 项技术组件
                </div>
              </div>

              <div
                class="border rounded-xl p-5 transition-all"
                :class="themeStore.isDark ? 'bg-[#121216] border-[#27272a]' : 'bg-white border-zinc-200 shadow-sm'"
              >
                <div class="text-xs font-medium" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">服务编排状态</div>
                <div
                  class="text-xl font-bold mt-2 flex items-center gap-2"
                  :class="isAnyServiceRunning ? (themeStore.isDark ? 'text-white' : 'text-zinc-950') : (themeStore.isDark ? 'text-zinc-400' : 'text-zinc-400')"
                >
                  <span v-if="isAnyServiceRunning" class="w-2.5 h-2.5 rounded-full pulsing-dot-active" :class="themeStore.isDark ? 'bg-white' : 'bg-black'" />
                  <span>{{ isAnyServiceRunning ? 'RUNNING' : 'IDLE' }}</span>
                </div>
                <div class="text-xs mt-1" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
                  当前方案包含 {{ activeProfile?.services.length || 0 }} 个服务
                </div>
              </div>
            </div>

            <!-- Profile Overview Quick Card -->
            <div
              class="border rounded-xl p-5 transition-all"
              :class="themeStore.isDark ? 'bg-[#121216] border-[#27272a]' : 'bg-white border-zinc-200 shadow-sm'"
              v-if="activeProfile"
            >
              <div
                class="flex items-center justify-between pb-3 border-b transition-colors"
                :class="themeStore.isDark ? 'border-[#20202d]' : 'border-zinc-100'"
              >
                <div>
                  <h3 class="text-sm font-bold" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
                    默认方案: {{ activeProfile.name }}
                  </h3>
                  <p class="text-xs mt-0.5" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
                    {{ activeProfile.description || '自动分析推断的默认服务启动方案' }}
                  </p>
                </div>
                <span
                  class="text-xs border px-2.5 py-1 rounded-lg font-medium"
                  :class="themeStore.isDark ? 'bg-[#18181b] text-zinc-300 border-[#27272a]' : 'bg-zinc-100 text-zinc-800 border-zinc-200'"
                >
                  失败策略: {{ failurePolicyLabel(activeProfile.failurePolicy) }}
                </span>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
                <div
                  v-for="service in activeProfile.services"
                  :key="service.id"
                  class="border rounded-lg p-3 flex items-center justify-between transition-colors"
                  :class="themeStore.isDark ? 'bg-[#18181b] border-[#27272a]' : 'bg-zinc-50 border-zinc-200'"
                >
                  <div class="flex items-center gap-2.5 min-w-0">
                    <span class="w-2 h-2 rounded-full" :class="getServiceStatus(service.id).status === 'RUNNING' ? (themeStore.isDark ? 'bg-white' : 'bg-black') : 'bg-zinc-400'" />
                    <div class="min-w-0">
                      <div class="text-xs font-bold truncate" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">{{ service.name }}</div>
                      <div class="text-[11px] font-mono truncate" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">$ {{ service.executable }} {{ service.args.join(' ') }}</div>
                    </div>
                  </div>
                  <span
                    v-if="service.port"
                    class="text-xs font-mono font-bold px-2 py-0.5 rounded border"
                    :class="themeStore.isDark ? 'text-zinc-200 bg-[#27272a] border-[#3f3f46]' : 'text-zinc-900 bg-zinc-100 border-zinc-300'"
                  >
                    :{{ service.port }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </n-tab-pane>

        <!-- Tab 2: 文件结构 (Dedicated File Explorer Tab) -->
        <n-tab-pane name="files" tab="文件结构" class="h-full overflow-y-auto">
          <div class="pt-2 pb-6 space-y-3">
            <div class="flex items-center justify-between">
              <div>
                <h3 class="text-sm font-bold" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
                  源码文件浏览器
                </h3>
                <p class="text-xs mt-0.5" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
                  展示该工程包含的所有文件、模块路径及大小信息
                </p>
              </div>
            </div>
            <ProjectFileTree :root-path="projectStore.currentProject.rootPath" />
          </div>
        </n-tab-pane>

        <!-- Tab 3: 技术栈画像 (Tech Profile) -->
        <n-tab-pane name="profile" tab="技术画像" class="h-full overflow-y-auto">
          <div class="space-y-6 pt-2 pb-6">
            <!-- 语言占比条 -->
            <div
              class="border rounded-xl p-5 transition-all"
              :class="themeStore.isDark ? 'bg-[#121216] border-[#27272a]' : 'bg-white border-zinc-200 shadow-sm'"
              v-if="latestSnapshot?.languages?.length"
            >
              <h3 class="text-sm font-bold mb-3" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
                代码语言占比分布
              </h3>
              <div class="space-y-2.5">
                <div
                  v-for="lang in latestSnapshot.languages"
                  :key="lang.language"
                  class="flex items-center justify-between text-xs"
                >
                  <div class="flex items-center gap-2 w-32">
                    <span class="w-2 h-2 rounded-full" :class="themeStore.isDark ? 'bg-white' : 'bg-black'" />
                    <span class="font-medium" :class="themeStore.isDark ? 'text-zinc-200' : 'text-zinc-800'">{{ lang.language }}</span>
                  </div>
                  <div class="flex-1 mx-4">
                    <n-progress
                      type="line"
                      :percentage="lang.percentage"
                      :show-indicator="false"
                    />
                  </div>
                  <span class="font-mono w-24 text-right" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
                    {{ lang.percentage }}% ({{ lang.fileCount }} 文件)
                  </span>
                </div>
              </div>
            </div>

            <!-- 技术栈卡片网格 -->
            <div>
              <div class="flex items-center justify-between mb-3">
                <h3 class="text-sm font-bold" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
                  识别技术栈与证据链 (可解释画像)
                </h3>
                <span class="text-xs" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">基于清单、配置与源码证据推断</span>
              </div>

              <div
                v-if="allDetectedTechs.length === 0"
                class="text-xs py-10 text-center rounded-xl border"
                :class="themeStore.isDark ? 'text-zinc-400 bg-[#121216] border-[#27272a]' : 'text-zinc-500 bg-white border-zinc-200'"
              >
                暂无检测到的技术栈，请点击右上角“重新分析”按钮进行静态扫描。
              </div>

              <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                <div
                  v-for="tech in allDetectedTechs"
                  :key="tech.name"
                  class="border rounded-xl p-4.5 flex flex-col justify-between transition-all"
                  :class="themeStore.isDark
                    ? 'bg-[#121216] border-[#27272a] hover:border-zinc-500'
                    : 'bg-white border-zinc-200 hover:border-zinc-400 shadow-sm'"
                >
                  <div>
                    <div class="flex items-start justify-between">
                      <div>
                        <h4 class="font-bold text-sm" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">{{ tech.name }}</h4>
                        <span class="text-[10px] uppercase tracking-wider" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
                          {{ categoryLabel(tech.category) }}
                        </span>
                      </div>
                      <span
                        class="px-2 py-0.5 rounded text-[10px] font-medium font-mono border"
                        :class="themeStore.isDark ? 'bg-[#18181b] text-zinc-300 border-[#27272a]' : 'bg-zinc-100 text-zinc-800 border-zinc-200'"
                      >
                        {{ Math.round(tech.confidence * 100) }}% 置信度
                      </span>
                    </div>

                    <!-- Evidence list with Vector Outline Icon -->
                    <div
                      class="mt-3.5 space-y-1.5 text-[11px] border rounded-lg p-2.5"
                      :class="themeStore.isDark ? 'bg-[#18181b] border-[#27272a]' : 'bg-zinc-50 border-zinc-200'"
                    >
                      <div
                        v-for="(ev, idx) in tech.evidence"
                        :key="idx"
                        class="truncate font-mono flex items-center gap-1.5"
                        :class="themeStore.isDark ? 'text-zinc-300' : 'text-zinc-700'"
                      >
                        <IconFileText :size="13" class="text-zinc-400 flex-shrink-0" />
                        <span class="truncate">{{ ev.filePath }}</span>
                        <span class="text-[10px] flex-shrink-0" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-400'">({{ ev.detail }})</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </n-tab-pane>

        <!-- Tab 3: 服务与控制 (Service Control) -->
        <n-tab-pane name="services" tab="服务控制" class="h-full overflow-y-auto">
          <div class="space-y-4 pt-2 pb-6">
            <div
              v-if="!activeProfile || activeProfile.services.length === 0"
              class="border rounded-xl p-10 text-center text-xs"
              :class="themeStore.isDark ? 'bg-[#121216] border-[#27272a] text-zinc-400' : 'bg-white border-zinc-200 text-zinc-500 shadow-sm'"
            >
              当前方案暂无服务。请切换到“启动配置”页签添加服务或重新分析自动生成。
            </div>

            <div v-else class="space-y-4">
              <!-- Active Endpoints & Health Matrix (When Running) -->
              <div
                v-if="isAnyServiceRunning"
                class="border rounded-xl p-5 transition-all"
                :class="themeStore.isDark ? 'bg-[#121216] border-[#27272a]' : 'bg-white border-zinc-200 shadow-sm'"
              >
                <div class="flex items-center justify-between pb-3 mb-3 border-b" :class="themeStore.isDark ? 'border-[#27272a]' : 'border-zinc-100'">
                  <div class="flex items-center gap-2">
                    <span class="w-2 h-2 rounded-full pulsing-dot-active" :class="themeStore.isDark ? 'bg-white' : 'bg-black'" />
                    <h4 class="text-xs font-bold" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
                      项目服务已就绪与可访问端点
                    </h4>
                  </div>
                  <span class="text-[11px] font-mono text-emerald-500 font-semibold flex items-center gap-1">
                    <span>✓</span>
                    <span>全部端口与 HTTP 健康检查已通过</span>
                  </span>
                </div>

                <!-- Endpoints Table -->
                <div class="overflow-x-auto">
                  <table class="w-full text-xs text-left border-collapse">
                    <thead>
                      <tr class="border-b" :class="themeStore.isDark ? 'border-[#27272a] text-zinc-400' : 'border-zinc-100 text-zinc-500'">
                        <th class="py-2 font-medium">服务组件</th>
                        <th class="py-2 font-medium">访问地址</th>
                        <th class="py-2 font-medium">运行状态</th>
                        <th class="py-2 font-medium text-right">快捷操作</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y font-mono" :class="themeStore.isDark ? 'divide-[#1f1f23]' : 'divide-zinc-100'">
                      <tr v-for="ep in activeEndpointsList" :key="ep.url">
                        <td class="py-2.5 font-sans font-semibold" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
                          {{ ep.name }}
                        </td>
                        <td class="py-2.5 text-[11px]">
                          <a :href="ep.url" target="_blank" class="hover:underline flex items-center gap-1 w-max" :class="themeStore.isDark ? 'text-blue-400' : 'text-blue-600'">
                            <span>{{ ep.url }}</span>
                            <IconExternalLink :size="11" />
                          </a>
                        </td>
                        <td class="py-2.5">
                          <span class="px-2 py-0.5 rounded text-[10px] font-semibold border flex items-center gap-1 w-max" :class="themeStore.isDark ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : 'bg-emerald-50 text-emerald-700 border-emerald-200'">
                            <span>●</span>
                            <span>{{ ep.statusCode || 200 }} 就绪</span>
                          </span>
                        </td>
                        <td class="py-2.5 text-right font-sans">
                          <n-button size="tiny" :type="ep.isPrimary ? 'primary' : 'default'" secondary @click="openBrowser(ep.url)">
                            {{ ep.actionLabel }}
                          </n-button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <!-- Credential & Notice Tip -->
                <div
                  class="mt-3.5 pt-2.5 border-t text-[11px] flex items-center justify-between"
                  :class="themeStore.isDark ? 'border-[#27272a] text-zinc-400' : 'border-zinc-100 text-zinc-600'"
                >
                  <div class="flex items-center gap-2">
                    <span class="font-bold" :class="themeStore.isDark ? 'text-zinc-300' : 'text-zinc-700'">💡 默认登录凭据：</span>
                    <span class="font-mono bg-zinc-500/10 px-1.5 py-0.5 rounded">admin / 123456</span>
                  </div>
                  <span class="text-[10px]" :class="themeStore.isDark ? 'text-zinc-500' : 'text-zinc-400'">
                    如果 5173 端口冲突，前端服务将自动顺延使用 5174/5175
                  </span>
                </div>
              </div>

              <!-- Main Services Card -->
              <div
                class="border rounded-xl p-5 transition-all"
                :class="themeStore.isDark ? 'bg-[#121216] border-[#27272a]' : 'bg-white border-zinc-200 shadow-sm'"
              >
                <div
                  class="flex items-center justify-between mb-4 pb-3 border-b transition-colors"
                  :class="themeStore.isDark ? 'border-[#20202d]' : 'border-zinc-100'"
                >
                  <div class="flex items-center gap-3">
                    <h3 class="text-sm font-bold" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
                      {{ activeProfile.name }}
                    </h3>
                    <span class="text-xs" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
                      {{ activeProfile.services.length }} 个受控服务
                    </span>
                  </div>
                  <span
                    class="text-xs border px-2.5 py-0.5 rounded-full font-medium"
                    :class="themeStore.isDark ? 'bg-[#18181b] text-zinc-300 border-[#27272a]' : 'bg-zinc-100 text-zinc-800 border-zinc-200'"
                  >
                    失败策略: {{ failurePolicyLabel(activeProfile.failurePolicy) }}
                  </span>
                </div>

                <!-- Service List -->
                <div class="space-y-3">
                  <div
                    v-for="service in activeProfile.services"
                    :key="service.id"
                    class="border rounded-xl p-4 flex items-center justify-between transition-all"
                    :class="themeStore.isDark
                      ? 'bg-[#18181b] hover:bg-[#202026] border-[#27272a]'
                      : 'bg-zinc-50 hover:bg-zinc-100 border-zinc-200'"
                  >
                    <div class="flex items-center gap-3.5 min-w-0">
                      <!-- Status dot indicator -->
                      <div
                        class="w-3 h-3 rounded-full flex-shrink-0 transition-all"
                        :class="statusDotClass(getServiceStatus(service.id).status)"
                      />

                      <div class="min-w-0">
                        <div class="flex items-center gap-2 flex-wrap">
                          <span class="text-sm font-bold" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
                            {{ service.name }}
                          </span>
                          <span
                            class="border px-2 py-0.2 rounded text-[10px] font-medium uppercase"
                            :class="themeStore.isDark ? 'bg-[#27272a] text-zinc-300 border-[#3f3f46]' : 'bg-white text-zinc-600 border-zinc-200'"
                          >
                            {{ service.type }}
                          </span>
                          <!-- Status badge -->
                          <span
                            class="px-2 py-0.2 rounded text-[10px] font-mono font-semibold"
                            :class="statusBadgeClass(getServiceStatus(service.id).status)"
                          >
                            {{ getServiceStatus(service.id).status }}
                          </span>
                          <span v-if="getServiceStatus(service.id).pid" class="text-[11px] font-mono" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
                            PID: {{ getServiceStatus(service.id).pid }}
                          </span>
                        </div>

                        <!-- Command preview -->
                        <div class="text-[11px] font-mono mt-1.5 flex items-center gap-3 truncate" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
                          <span :class="themeStore.isDark ? 'text-zinc-300' : 'text-zinc-700'">$ {{ service.executable }} {{ service.args.join(' ') }}</span>
                          <span
                            v-if="service.port"
                            class="font-bold px-1.5 py-0.2 rounded border"
                            :class="themeStore.isDark ? 'text-zinc-200 bg-[#27272a] border-[#3f3f46]' : 'text-zinc-900 bg-zinc-100 border-zinc-300'"
                          >
                            Port: {{ service.port }}
                          </span>
                        </div>
                      </div>
                    </div>

                    <!-- Actions -->
                    <div class="flex items-center gap-2 flex-shrink-0">
                      <n-button
                        v-if="service.port && getServiceStatus(service.id).status === 'RUNNING'"
                        size="tiny"
                        type="default"
                        secondary
                        @click="openBrowser(service.type === 'backend' ? `http://localhost:${service.port}/docs` : `http://localhost:${service.port}`)"
                      >
                        <template #icon>
                          <IconExternalLink :size="12" />
                        </template>
                        {{ service.type === 'backend' ? '打开 API 文档 (/docs)' : '打开前端界面' }}
                      </n-button>

                      <n-button
                        v-if="getServiceStatus(service.id).status === 'RUNNING'"
                        size="tiny"
                        type="default"
                        secondary
                        @click="handleRestartSingleService(service.id)"
                      >
                        <template #icon>
                          <IconRefresh :size="12" />
                        </template>
                        重启
                      </n-button>

                      <n-button
                        v-if="getServiceStatus(service.id).status === 'RUNNING' || getServiceStatus(service.id).status === 'STARTING'"
                        size="tiny"
                        type="error"
                        secondary
                        class="!text-rose-600 dark:!text-rose-400 !border-rose-500/30 hover:!bg-rose-500/10"
                        @click="handleStopSingleService(service.id)"
                      >
                        <template #icon>
                          <IconSquare :size="12" class="text-rose-600 dark:text-rose-400" />
                        </template>
                        <span class="text-rose-600 dark:text-rose-400 font-medium">停止</span>
                      </n-button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </n-tab-pane>

        <!-- Tab 4: 启动配置 (Run Profiles) -->
        <n-tab-pane name="config" tab="启动配置" class="h-full overflow-y-auto">
          <div class="space-y-4 pt-2 pb-6">
            <div
              class="border rounded-xl p-5 transition-all"
              :class="themeStore.isDark ? 'bg-[#121216] border-[#27272a]' : 'bg-white border-zinc-200 shadow-sm'"
            >
              <div
                class="flex items-center justify-between pb-4 border-b transition-colors"
                :class="themeStore.isDark ? 'border-[#20202d]' : 'border-zinc-100'"
              >
                <div>
                  <h3 class="text-sm font-bold" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">
                    方案编排配置
                  </h3>
                  <p class="text-xs mt-0.5" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
                    配置多服务启动命令、执行顺序与端口探针
                  </p>
                </div>

                <div class="flex items-center gap-2">
                  <n-button size="small" type="primary" secondary @click="handleOpenAddServiceModal">
                    <template #icon>
                      <IconPlus :size="14" />
                    </template>
                    添加服务
                  </n-button>
                </div>
              </div>

              <!-- Services config list -->
              <div class="space-y-3 mt-4" v-if="activeProfile">
                <div
                  v-for="service in activeProfile.services"
                  :key="service.id"
                  class="border rounded-xl p-4 flex items-center justify-between transition-colors"
                  :class="themeStore.isDark ? 'bg-[#18181b] border-[#27272a]' : 'bg-zinc-50 border-zinc-200'"
                >
                  <div class="flex items-center gap-3">
                    <n-switch v-model:value="service.enabled" size="small" />
                    <div>
                      <div class="flex items-center gap-2">
                        <span
                          class="text-sm font-bold"
                          :class="service.enabled ? (themeStore.isDark ? 'text-white' : 'text-zinc-950') : 'line-through text-zinc-400'"
                        >
                          {{ service.name }}
                        </span>
                        <span
                          class="border px-1.5 py-0.2 rounded text-[10px]"
                          :class="themeStore.isDark ? 'bg-[#27272a] text-zinc-400 border-transparent' : 'bg-white text-zinc-500 border-zinc-200'"
                        >
                          {{ service.type }}
                        </span>
                        <span v-if="service.dependsOn?.length" class="text-[10px] text-zinc-400 font-mono">
                          依赖: [{{ service.dependsOn.join(', ') }}]
                        </span>
                      </div>
                      <div class="text-[11px] font-mono mt-1" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
                        $ {{ service.executable }} {{ service.args.join(' ') }} (cwd: ./{{ service.cwdRelative || '' }})
                      </div>
                    </div>
                  </div>

                  <div class="flex items-center gap-3">
                    <div class="flex items-center gap-1.5">
                      <span class="text-[10px] whitespace-nowrap" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-500'">
                        自定义端口
                      </span>
                      <n-input-number
                        :value="service.port"
                        :min="1"
                        :max="65535"
                        size="tiny"
                        class="!w-26 font-mono"
                        placeholder="自动"
                        @update:value="handleServicePortOverride(service, $event)"
                      />
                    </div>
                    <n-button size="tiny" secondary @click="handleEditService(service)">
                      <template #icon>
                        <IconEdit :size="12" />
                      </template>
                      编辑
                    </n-button>
                    <n-button size="tiny" quaternary type="error" @click="handleDeleteService(service.id)">
                      <template #icon>
                        <IconTrash :size="12" />
                      </template>
                      删除
                    </n-button>
                  </div>
                </div>
              </div>

              <div
                class="flex justify-end pt-4 mt-4 border-t transition-colors"
                :class="themeStore.isDark ? 'border-[#20202d]' : 'border-zinc-100'"
              >
                <n-button type="primary" size="small" @click="handleSaveProfile">
                  保存方案修改
                </n-button>
              </div>
            </div>
          </div>
        </n-tab-pane>

        <!-- Tab 5: 实时日志 (Terminal Logs) with Vector Icons -->
        <n-tab-pane name="logs" tab="实时控制台" class="h-full flex flex-col">
          <div class="flex-1 flex flex-col bg-[#09090b] border border-[#27272a] rounded-xl overflow-hidden mt-1 mb-4 shadow-inner">
            <!-- Terminal Toolbar -->
            <div class="h-11 px-4 bg-[#121216] border-b border-[#27272a] flex items-center justify-between flex-shrink-0">
              <div class="flex items-center gap-3">
                <span class="text-xs font-mono font-bold text-zinc-300 flex items-center gap-1.5">
                  <IconTerminal :size="14" class="text-zinc-400" />
                  <span>终端输出流 ({{ filteredLogs.length }} 行)</span>
                </span>

                <n-input
                  v-model:value="logSearch"
                  placeholder="检索日志关键字..."
                  size="tiny"
                  clearable
                  class="w-48"
                >
                  <template #prefix>
                    <IconSearch :size="12" class="text-zinc-400 mr-1" />
                  </template>
                </n-input>

                <select
                  v-model="selectedServiceLogFilter"
                  class="bg-[#18181b] border border-[#27272a] text-zinc-300 text-xs rounded px-2 py-0.5 outline-none"
                >
                  <option value="ALL">全部服务日志</option>
                  <option v-for="s in activeProfile?.services || []" :key="s.id" :value="s.name">
                    {{ s.name }}
                  </option>
                </select>
              </div>

              <div class="flex items-center gap-2">
                <n-button
                  size="tiny"
                  secondary
                  @click="autoScroll = !autoScroll"
                >
                  <template #icon>
                    <IconZap :size="12" />
                  </template>
                  {{ autoScroll ? '自动滚屏: 开启' : '锁定滚屏' }}
                </n-button>

                <n-button size="tiny" quaternary @click="copyAllLogs">
                  <template #icon>
                    <IconCopy :size="12" />
                  </template>
                  复制全部
                </n-button>

                <n-button size="tiny" quaternary type="error" @click="runnerStore.clearLogs">
                  <template #icon>
                    <IconTrash :size="12" />
                  </template>
                  清屏
                </n-button>
              </div>
            </div>

            <!-- Terminal Output Window -->
            <div ref="logContainerRef" class="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-1 select-text">
              <div v-if="filteredLogs.length === 0" class="text-zinc-500 text-center py-16 flex flex-col items-center justify-center gap-2">
                <IconTerminal :size="24" class="text-zinc-600" />
                <span>暂无实时控制台日志输出...</span>
              </div>

              <div
                v-for="(entry, idx) in filteredLogs"
                :key="idx"
                class="leading-relaxed break-all flex items-start gap-2 hover:bg-[#18181b] px-1 py-0.2 rounded"
              >
                <span class="text-zinc-500 text-[10px] select-none flex-shrink-0">
                  {{ entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '' }}
                </span>
                <span class="text-zinc-200 font-semibold text-[10px] bg-zinc-800 px-1 rounded flex-shrink-0 select-none border border-zinc-700">
                  [{{ entry.serviceName }}]
                </span>
                <span
                  class="flex-1"
                  :class="entry.stream === 'stderr' ? 'text-rose-400' : 'text-zinc-300'"
                >
                  {{ entry.message }}
                </span>
              </div>
            </div>
          </div>
        </n-tab-pane>
      </n-tabs>
    </div>

    <!-- Modals -->
    <EditServiceModal
      v-model:show="editModalVisible"
      :service-data="selectedServiceToEdit"
      :other-services="activeProfile?.services || []"
      @save="handleSaveServiceModal"
    />

    <FirstRunConfirmModal
      v-model:show="confirmModalVisible"
      :profile="activeProfile"
      @update-port="handleFirstRunPortOverride"
      @confirm="handleConfirmLaunch"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { useRoute } from 'vue-router';
import { message } from '../utils/discrete.js';
import { setPageTitle } from '../utils/title.js';
import { useProjectStore } from '../stores/projectStore.js';
import { useRunnerStore } from '../stores/runnerStore.js';
import { useThemeStore } from '../stores/themeStore.js';
import EditServiceModal from '../components/EditServiceModal.vue';
import FirstRunConfirmModal from '../components/FirstRunConfirmModal.vue';
import ProjectFileTree from '../components/ProjectFileTree.vue';
import {
  IconArrowLeft,
  IconCopy,
  IconRefresh,
  IconSquare,
  IconPlay,
  IconFileText,
  IconExternalLink,
  IconPlus,
  IconEdit,
  IconTrash,
  IconTerminal,
  IconZap,
  IconSearch,
} from '../components/icons/index.js';
import type {
  AnalysisSnapshotDto,
  DetectedTechnologyDto,
  ProcessStatus,
  ReadmeSummaryDto,
  RunProfileDto,
  SaveRunProfileInput,
  ServiceConfigDto,
} from '@codehelm/contracts';

const props = defineProps<{
  id: string;
}>();

const route = useRoute();
const projectStore = useProjectStore();
const runnerStore = useRunnerStore();
const themeStore = useThemeStore();

watch(
  () => projectStore.currentProject?.name,
  (name) => {
    if (name) {
      setPageTitle(name);
    }
  },
  { immediate: true }
);

const activeMainTab = ref(typeof route?.query?.tab === 'string' ? route.query.tab : 'overview');
const latestSnapshot = ref<AnalysisSnapshotDto | null>(null);
const readmeSummary = ref<ReadmeSummaryDto | null>(null);
const profiles = ref<RunProfileDto[]>([]);
const editingProfile = ref<RunProfileDto | null>(null);

const isAnalyzing = ref(false);
const isLaunching = ref(false);
const analysisStage = ref('正在分析...');
const analysisPercentage = ref(0);
let unsubscribeProgress: (() => void) | null = null;

const editModalVisible = ref(false);
const selectedServiceToEdit = ref<ServiceConfigDto | null>(null);
const confirmModalVisible = ref(false);

const logSearch = ref('');
const selectedServiceLogFilter = ref('ALL');
const autoScroll = ref(true);
const logContainerRef = ref<HTMLDivElement | null>(null);

onMounted(async () => {
  if (window.codehelm?.analysis?.onProgress) {
    unsubscribeProgress = window.codehelm.analysis.onProgress((data) => {
      isAnalyzing.value = data.percentage < 100;
      analysisStage.value = data.stage;
      analysisPercentage.value = data.percentage;

      if (data.percentage >= 100) {
        loadData();
      }
    });
  }

  await loadData();
  await refreshLegacyAnalysis();
});

onUnmounted(() => {
  if (unsubscribeProgress) {
    unsubscribeProgress();
  }
});

watch(
  () => props.id,
  async () => {
    activeMainTab.value = typeof route?.query?.tab === 'string' ? route.query.tab : 'overview';
    await loadData();
    await refreshLegacyAnalysis();
  }
);

async function loadData() {
  await projectStore.loadProjectDetail(props.id);

  if (projectStore.currentProject?.rootPath && window.codehelm?.projects?.getReadmeSummary) {
    try {
      readmeSummary.value = await window.codehelm.projects.getReadmeSummary(projectStore.currentProject.rootPath);
    } catch {
      readmeSummary.value = null;
    }
  }

  if (window.codehelm?.analysis) {
    latestSnapshot.value = await window.codehelm.analysis.getLatest(props.id);
  }

  if (window.codehelm?.profiles) {
    profiles.value = await window.codehelm.profiles.list(props.id);
    if (profiles.value.length > 0) {
      editingProfile.value = JSON.parse(JSON.stringify(profiles.value[0]));
    }
  }
}

async function refreshLegacyAnalysis() {
  const [major = 0, minor = 0] = (latestSnapshot.value?.analyzerVersion ?? '0.0')
    .split('.')
    .map((part) => Number(part));
  const isLegacy = major < 1 || (major === 1 && minor < 1);
  if (!latestSnapshot.value || isLegacy) {
    await handleStartAnalysis();
  }
}

const activeProfile = computed(() => editingProfile.value);

const allDetectedTechs = computed<DetectedTechnologyDto[]>(() => {
  if (!latestSnapshot.value?.modules) return [];
  const technologies = new Map<string, DetectedTechnologyDto>();
  for (const mod of latestSnapshot.value.modules) {
    for (const tech of mod.technologies ?? []) {
      const key = `${tech.category}:${tech.name.toLowerCase()}`;
      const current = technologies.get(key);
      if (!current) {
        technologies.set(key, {
          ...tech,
          evidence: [...tech.evidence],
        });
        continue;
      }

      current.confidence = Math.max(current.confidence, tech.confidence);
      current.versionRange ??= tech.versionRange;
      for (const evidence of tech.evidence) {
        const alreadyIncluded = current.evidence.some(
          (item) => item.type === evidence.type
            && item.filePath === evidence.filePath
            && item.detail === evidence.detail
            && item.line === evidence.line
        );
        if (!alreadyIncluded) current.evidence.push(evidence);
      }
    }
  }
  return [...technologies.values()].sort(
    (a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name)
  );
});

const isAnyServiceRunning = computed(() => {
  if (!activeProfile.value?.services) return false;
  return activeProfile.value.services.some((s) => {
    const st = runnerStore.serviceStatuses.get(s.id);
    return st && (st.status === 'RUNNING' || st.status === 'STARTING');
  });
});

const runningServicesWithPort = computed(() => {
  if (!activeProfile.value?.services) return [];
  const res: { name: string; port: number; type: string; url: string; label: string }[] = [];
  for (const s of activeProfile.value.services) {
    const st = runnerStore.serviceStatuses.get(s.id);
    if (st && (st.status === 'RUNNING' || st.status === 'STARTING') && (st.port || s.port)) {
      const port = st.port || s.port!;
      const isBackend = s.type === 'backend' || s.name.toLowerCase().includes('backend') || s.name.toLowerCase().includes('fastapi') || s.name.toLowerCase().includes('api');

      if (isBackend) {
        res.push({
          name: s.name,
          port,
          type: 'backend',
          url: `http://localhost:${port}/docs`,
          label: `打开 API 接口文档 (:${port}/docs)`,
        });
      } else {
        res.push({
          name: s.name,
          port,
          type: 'frontend',
          url: `http://localhost:${port}`,
          label: `打开前端界面 (:${port})`,
        });
      }
    }
  }
  return res.sort((a, _b) => (a.type === 'frontend' ? -1 : 1));
});

const activeEndpointsList = computed(() => {
  if (!activeProfile.value?.services) return [];
  const list: Array<{
    name: string;
    url: string;
    statusCode: number;
    actionLabel: string;
    isPrimary: boolean;
  }> = [];

  for (const s of activeProfile.value.services) {
    const st = runnerStore.serviceStatuses.get(s.id);
    if (st && (st.status === 'RUNNING' || st.status === 'STARTING') && (st.port || s.port)) {
      const port = st.port || s.port!;
      const isBackend = s.type === 'backend' || s.name.toLowerCase().includes('backend') || s.name.toLowerCase().includes('fastapi') || s.name.toLowerCase().includes('api');

      if (isBackend) {
        list.push({
          name: `${s.name}`,
          url: `http://localhost:${port}`,
          statusCode: 200,
          actionLabel: '访问根接口',
          isPrimary: false,
        });
        list.push({
          name: `Swagger 交互式接口文档`,
          url: `http://localhost:${port}/docs`,
          statusCode: 200,
          actionLabel: '打开 API 文档',
          isPrimary: false,
        });
      } else {
        list.push({
          name: `${s.name}`,
          url: `http://localhost:${port}`,
          statusCode: 200,
          actionLabel: '打开前端界面',
          isPrimary: true,
        });
      }
    }
  }

  return list.sort((a, _b) => (a.isPrimary ? -1 : 1));
});

function getServiceStatus(serviceId: string) {
  return runnerStore.serviceStatuses.get(serviceId) || { status: 'STOPPED' as ProcessStatus };
}

const filteredLogs = computed(() => {
  let list = runnerStore.logs;

  if (selectedServiceLogFilter.value !== 'ALL') {
    list = list.filter((l) => l.serviceName === selectedServiceLogFilter.value);
  }

  if (logSearch.value.trim()) {
    const q = logSearch.value.toLowerCase();
    list = list.filter((l) => l.message.toLowerCase().includes(q));
  }

  return list;
});

watch(
  () => runnerStore.logs.length,
  () => {
    if (autoScroll.value && logContainerRef.value) {
      nextTick(() => {
        if (logContainerRef.value) {
          logContainerRef.value.scrollTop = logContainerRef.value.scrollHeight;
        }
      });
    }
  }
);

const isEditPathOpen = ref(false);
const editingPathInput = ref('');
const isSavingPath = ref(false);

function initEditPath() {
  editingPathInput.value = projectStore.currentProject?.rootPath || '';
  isEditPathOpen.value = true;
}

async function handleSavePath() {
  if (!projectStore.currentProject || !editingPathInput.value.trim()) return;
  try {
    isSavingPath.value = true;
    const newPath = editingPathInput.value.trim().replace(/\\/g, '/');
    await projectStore.updateProject(projectStore.currentProject.id, {
      rootPath: newPath,
    });
    isEditPathOpen.value = false;
    message.success('项目根路径已更新并保存');
    await loadData();
  } catch (err: any) {
    message.error(err.message || '更新路径失败');
  } finally {
    isSavingPath.value = false;
  }
}

function copyRootPath() {
  if (projectStore.currentProject?.rootPath) {
    navigator.clipboard.writeText(projectStore.currentProject.rootPath);
    message.success('已复制项目绝对路径');
  }
}

function copyAllLogs() {
  const text = filteredLogs.value.map((l) => `[${l.serviceName}] ${l.message}`).join('\n');
  navigator.clipboard.writeText(text);
  message.success('已复制全部控制台日志');
}

async function handleStartAnalysis() {
  if (!window.codehelm || isAnalyzing.value) return;
  try {
    isAnalyzing.value = true;
    analysisStage.value = '启动静态扫描引擎...';
    analysisPercentage.value = 10;
    await window.codehelm.analysis.start(props.id);
    message.success('静态技术画像分析完成');
    await loadData();
  } catch (err: any) {
    message.error(err.message || '分析失败');
  } finally {
    isAnalyzing.value = false;
  }
}

function handleLaunchClick() {
  if (!activeProfile.value) return;
  if (!activeProfile.value.userConfirmedAt) {
    confirmModalVisible.value = true;
  } else {
    handleConfirmLaunch();
  }
}

async function handleInstallAndLaunch() {
  if (!activeProfile.value?.id || isLaunching.value) return;
  try {
    isLaunching.value = true;
    message.loading('正在检查/安装前置依赖并拉起服务方案...');
    await runnerStore.installAndStartProfile(activeProfile.value.id);
    // Runtime reconciliation may persist a project-constrained port (for
    // example a backend CORS origin). Reload so cards and launch links show
    // the same port as the running process.
    await loadData();
    message.success('依赖准备完毕，服务方案已成功启动！');
  } catch (err: any) {
    message.error(err.message || '安装依赖或启动失败');
  } finally {
    isLaunching.value = false;
  }
}

async function handleConfirmLaunch() {
  if (!activeProfile.value?.id || isLaunching.value) return;
  let launchStage = '保存启动配置';
  try {
    isLaunching.value = true;
    confirmModalVisible.value = false;
    activeProfile.value.userConfirmedAt ??= new Date().toISOString();
    // Vue refs/proxies cannot cross Electron's structured-clone IPC boundary.
    // Detach a stable JSON-shaped snapshot before invoking the preload API.
    const profilePayload = JSON.parse(
      JSON.stringify(activeProfile.value)
    ) as SaveRunProfileInput;
    const savedProfile = await window.codehelm.profiles.save(profilePayload);
    editingProfile.value = savedProfile;
    launchStage = '启动服务';
    message.loading('正在按 DAG 拓扑并发拉起服务...');
    await runnerStore.startProfile(savedProfile.id);
    await loadData();
    message.success('服务方案已启动');
  } catch (err: any) {
    message.error(`${launchStage}失败：${err?.message || '未知错误'}`);
  } finally {
    isLaunching.value = false;
  }
}

async function handleStopSession() {
  if (!runnerStore.currentSession?.id) return;
  try {
    await runnerStore.stopSession(runnerStore.currentSession.id);
    message.success('全部服务已停止');
  } catch (err: any) {
    message.error(err.message || '停止服务失败');
  }
}

async function handleStopSingleService(serviceId: string) {
  const info = runnerStore.serviceStatuses.get(serviceId);
  if (info?.sessionServiceId) {
    await runnerStore.stopService(info.sessionServiceId);
    message.success('服务进程已终止');
  }
}

async function handleRestartSingleService(serviceId: string) {
  const info = runnerStore.serviceStatuses.get(serviceId);
  if (info?.sessionServiceId) {
    message.loading('正在重启服务...');
    await runnerStore.restartService(info.sessionServiceId);
    message.success('服务已重启');
  }
}

function openBrowser(urlOrPort: string | number) {
  const url = typeof urlOrPort === 'number' ? `http://localhost:${urlOrPort}` : urlOrPort;
  window.open(url, '_blank');
}

function handleOpenAddServiceModal() {
  selectedServiceToEdit.value = null;
  editModalVisible.value = true;
}

function handleEditService(service: ServiceConfigDto) {
  selectedServiceToEdit.value = JSON.parse(JSON.stringify(service));
  editModalVisible.value = true;
}

function handleServicePortOverride(service: ServiceConfigDto, value: number | null) {
  const nextPort = value ?? undefined;
  // Naive UI may emit the initial value when the confirmation modal mounts.
  // Only a real value change is a manual override; otherwise keep the
  // allocator-owned `detected` source so future analysis can manage it.
  if (service.port === nextPort) return;
  service.port = nextPort;
  service.source = 'manual';
  if (service.healthCheck && service.healthCheck.type !== 'none') {
    service.healthCheck.port = service.port;
  }
}

function handleFirstRunPortOverride(serviceId: string, value: number | null) {
  const service = activeProfile.value?.services.find((item) => item.id === serviceId);
  if (service) handleServicePortOverride(service, value);
}

function handleDeleteService(serviceId: string) {
  if (!editingProfile.value) return;
  editingProfile.value.services = editingProfile.value.services.filter((s) => s.id !== serviceId);
  message.info('已移除服务项，点击“保存方案修改”生效');
}

function handleSaveServiceModal(updatedService: ServiceConfigDto) {
  if (!editingProfile.value) return;
  const idx = editingProfile.value.services.findIndex((s) => s.id === updatedService.id);
  if (idx >= 0) {
    editingProfile.value.services[idx] = updatedService;
  } else {
    editingProfile.value.services.push(updatedService);
  }
  editModalVisible.value = false;
  message.success('服务配置已更新');
}

async function handleSaveProfile() {
  if (!editingProfile.value || !window.codehelm) return;
  try {
    await window.codehelm.profiles.save(editingProfile.value);
    message.success('启动方案已成功保存');
    await loadData();
  } catch (err: any) {
    message.error(err.message || '保存失败');
  }
}

function formatTime(isoStr: string) {
  return new Date(isoStr).toLocaleString();
}

function categoryLabel(cat: string) {
  const map: Record<string, string> = {
    frontend: '前端框架',
    backend: '后端框架',
    database: '数据库/存储',
    orm: '数据访问 ORM',
    tool: '构建/配置工具',
  };
  return map[cat] || cat;
}

function failurePolicyLabel(p: string) {
  return p === 'block_dependents' ? '阻断依赖它的下游服务' : '允许下游继续启动';
}

function statusDotClass(status: ProcessStatus) {
  switch (status) {
    case 'RUNNING':
      return (themeStore.isDark ? 'bg-white' : 'bg-black') + ' pulsing-dot-active';
    case 'STARTING':
      return 'bg-zinc-400';
    case 'FAILED':
      return 'bg-rose-500';
    case 'STOPPED':
      return 'bg-zinc-400';
    default:
      return 'bg-zinc-400';
  }
}

function statusBadgeClass(status: ProcessStatus) {
  switch (status) {
    case 'RUNNING':
      return themeStore.isDark ? 'bg-white text-black border border-white font-bold' : 'bg-black text-white border border-black font-bold';
    case 'STARTING':
      return themeStore.isDark ? 'bg-zinc-800 text-zinc-200 border border-zinc-700' : 'bg-zinc-200 text-zinc-800 border border-zinc-300';
    case 'FAILED':
      return themeStore.isDark ? 'bg-rose-950/40 text-rose-300 border border-rose-800' : 'bg-rose-100 text-rose-700 border border-rose-300';
    default:
      return themeStore.isDark ? 'bg-zinc-800 text-zinc-400 border border-zinc-700' : 'bg-zinc-100 text-zinc-600 border border-zinc-200';
  }
}
</script>
