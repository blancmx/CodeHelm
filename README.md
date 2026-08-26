# <img src="./assets/logo.svg" width="36" height="36" valign="middle" alt="CodeHelm" /> CodeHelm

### 本地项目控制台与多进程自动化运行中心
**A Local Project Dashboard & Multi-Process Orchestrator for the AI & Vibe Coding Era**

<p align="left">
  <img src="https://img.shields.io/badge/Electron-33.x-black?style=flat-square&logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/Vue-3.5-black?style=flat-square&logo=vue.js" alt="Vue 3" />
  <img src="https://img.shields.io/badge/TypeScript-5.x-black?style=flat-square&logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-6.x-black?style=flat-square&logo=vite" alt="Vite" />
  <img src="https://img.shields.io/badge/SQLite-Better--sqlite3-black?style=flat-square&logo=sqlite" alt="SQLite" />
  <img src="https://img.shields.io/badge/License-MIT-black?style=flat-square" alt="License" />
</p>

---

##  项目简介 (Overview)

随着 AI 编程助手（Cursor, Claude Dev, Windsurf, Copilot 等）的普及，开发者本地积累了大量通过 **Vibe Coding** 快速生成的单体应用、微服务及多仓库项目。然而，管理分散的项目、逐个记忆和敲击复杂的开发命令、排查端口冲突与残留孤儿进程成为了新的痛点。

**CodeHelm** 是一款专为开发者打造的**本地优先、安全隔离的现代化工程控制台**。只需选择本地代码根目录，CodeHelm 即可秒级深度扫描技术拓扑、智能推断启动命令，并提供统一的进程生命周期编排与实时日志监控。

---

## ✨ 核心特性 (Key Features)

### 1. 📂 智能工程扫描与技术画像 (Smart Discovery & Tech Profiling)
- **单/多项目与 Monorepo 探测**：支持单项目快速导入与总文件夹（Workspace）递归扫描，自动识别 pnpm/npm workspace、Lerna 及嵌套多子工程。
- **全生态语言与框架识别**：覆盖 TypeScript, JavaScript, Python (FastAPI/Flask/Django), Java (Spring Boot/Maven/Gradle), Go, Rust 等主流生态。
- **依赖与命令推断**：自动解析 `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`，秒级生成开箱即用的启动脚本配置。

### 2. ⚡ 多进程统一编排与运行中心 (Unified Process Runner)
- **一键编排拉起**：多服务（前后端、微服务、工作流）一键并行或拓扑依赖顺序拉起。
- **防孤儿进程安全清理 (Process Tree Killer)**：利用操作系统级进程树追踪与安全终止机制，彻底杜绝后台隐藏占用与悬挂进程。
- **动态端口分配与防冲突**：自动探测端口占用并分配空闲端口，支持一键快捷打开前端界面及 API 文档（如 `/docs`）。
- **实时日志流与分流监控**：集中式查看服务 stdout/stderr 实时日志流，支持关键词过滤与日志清空。

### 3. 🛡️ 纯本地优先与隐私安全 (100% Local & Privacy-First)
- **零代码上传**：无需连接云端，所有工程探测、分析与运行调度 100% 在本地完成。
- **本地 SQLite 嵌入持久化**：工程元数据、运行记录与自定义方案完全保存在本地 SQLite 数据库中。
- **安全隔离操作**：从控制台移除项目仅清除纳管记录与配置，绝不触碰或删除本地源代码。

---

## 🏛️ 项目架构 (Architecture)

CodeHelm 采用标准 **pnpm Monorepo** 架构，将核心逻辑模块化分层：

```
desk/
├── apps/
│   └── desktop/               # Electron + Vite + Vue 3 桌面端应用
│       ├── src/main/          # Electron 主进程与 IPC 通信调度
│       ├── src/preload/       # 安全沙箱桥接层 (Preload Bridge)
│       └── src/renderer/      # 基于 Naive UI & UnoCSS 的前端视图层
├── packages/
│   ├── domain/                # 领域核心实体与类型契约
│   ├── shared/                # 路径安全校验、通用异常与 ID 生成器
│   ├── contracts/             # IPC 通信通道与类型安全 DTO 定义
│   ├── database/              # SQLite 本地持久化与 Repository 仓储层
│   ├── analyzer/              # 代码静态扫描、框架探测与命令推断引擎
│   └── runner/                # 跨平台多进程管理、端口分配与拓扑编排器
├── start-desktop.bat          # 桌面端一键交互启动脚本
└── package.json               # Monorepo 根依赖配置
```

---

## 🚀 快速上手 (Getting Started)

### 前置环境 (Prerequisites)
- [Node.js](https://nodejs.org/) (>= 18.0.0)
- [pnpm](https://pnpm.io/) (>= 9.0.0)
- Windows / macOS / Linux

### 1. 克隆与安装依赖
```bash
git clone https://github.com/blancmx/CodeHelm.git
cd CodeHelm

pnpm install
```

### 2. 编译核心公共包
```bash
pnpm build
```

### 3. 启动开发模式
- **方式一：通过终端启动**
```bash
pnpm dev
```
- **方式二：Windows 桌面双击直接启动**
双击运行根目录下的 `start-desktop.bat` 脚本。

- **方式三：纯浏览器访问**
启动后直接在浏览器中打开：[http://localhost:5173/](http://localhost:5173/)（内置完整浏览器模拟适配层）。

### 4. 构建打包
```bash
# 构建全部包及桌面客户端应用
pnpm -r run build
```

---

## 🛠️ 技术栈 (Tech Stack)

| 领域 | 技术方案 |
| :--- | :--- |
| **桌面框架** | [Electron](https://www.electronjs.org/) 33.x |
| **前端视图** | [Vue 3](https://vuejs.org/) (Composition API, `<script setup>`), [Vue Router](https://router.vuejs.org/), [Pinia](https://pinia.vuejs.org/) |
| **构建工具** | [Vite](https://vitejs.dev/) 6.x + `vite-plugin-electron` |
| **组件 & 样式** | [Naive UI](https://www.naiveui.com/), [UnoCSS](https://unocss.dev/), Lucide Icons |
| **本地数据** | [Better-sqlite3](https://github.com/WiseLibs/better-sqlite3) |
| **进程与编排** | Node.js `child_process`, `tree-kill`, 自研端口调度器 |
| **语言与工程化**| TypeScript 5.x, pnpm Workspaces |

---

## 📄 开源协议 (License)

本项目采用 [MIT License](LICENSE) 开源协议。
