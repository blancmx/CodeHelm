import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels } from '@codehelm/contracts';
import type { CodeHelmApi } from '@codehelm/contracts';
import { toIpcPayload } from './ipc-payload.js';

const api: CodeHelmApi = {
  projects: {
    workspaces: () => ipcRenderer.invoke(IpcChannels.PROJECTS_WORKSPACES),
    startScan: (input) => ipcRenderer.invoke(IpcChannels.PROJECTS_START_SCAN, toIpcPayload(input)),
    startImport: (input) => ipcRenderer.invoke(IpcChannels.PROJECTS_START_IMPORT, toIpcPayload(input)),
    getTask: (taskId) => ipcRenderer.invoke(IpcChannels.PROJECTS_GET_TASK, taskId),
    cancelTask: (taskId) => ipcRenderer.invoke(IpcChannels.PROJECTS_CANCEL_TASK, taskId),
    onTaskProgress: (listener) => {
      const subscription = (_event: Electron.IpcRendererEvent, data: Parameters<typeof listener>[0]) => listener(data);
      ipcRenderer.on(IpcChannels.PROJECTS_ON_TASK_PROGRESS, subscription);
      return () => ipcRenderer.removeListener(IpcChannels.PROJECTS_ON_TASK_PROGRESS, subscription);
    },
    selectDirectory: () => ipcRenderer.invoke(IpcChannels.PROJECTS_SELECT_DIRECTORY),
    import: (input) => ipcRenderer.invoke(IpcChannels.PROJECTS_IMPORT, toIpcPayload(input)),
    batchImport: (input) => ipcRenderer.invoke(IpcChannels.PROJECTS_BATCH_IMPORT, toIpcPayload(input)),
    scanWorkspace: (rootPath, options) =>
      ipcRenderer.invoke(IpcChannels.PROJECTS_SCAN_WORKSPACE, rootPath, toIpcPayload(options)),
    list: () => ipcRenderer.invoke(IpcChannels.PROJECTS_LIST),
    get: (id) => ipcRenderer.invoke(IpcChannels.PROJECTS_GET, id),
    remove: (id) => ipcRenderer.invoke(IpcChannels.PROJECTS_REMOVE, id),
    update: (id, patch) => ipcRenderer.invoke(IpcChannels.PROJECTS_UPDATE, id, toIpcPayload(patch)),
    previewRelocation: (id, rootPath) => ipcRenderer.invoke(IpcChannels.PROJECTS_PREVIEW_RELOCATION, id, rootPath),
    relocate: (id, token) => ipcRenderer.invoke(IpcChannels.PROJECTS_RELOCATE, id, token),
    getFileTree: (rootPath, options) =>
      ipcRenderer.invoke(IpcChannels.PROJECTS_GET_FILE_TREE, rootPath, toIpcPayload(options)),
    getReadmeSummary: (rootPath) =>
      ipcRenderer.invoke(IpcChannels.PROJECTS_GET_README, rootPath),
  },
  analysis: {
    review: (projectId) => ipcRenderer.invoke(IpcChannels.ANALYSIS_REVIEW, projectId),
    apply: (projectId, token) => ipcRenderer.invoke(IpcChannels.ANALYSIS_APPLY, projectId, token),
    start: (projectId) => ipcRenderer.invoke(IpcChannels.ANALYSIS_START, projectId),
    cancel: (taskId) => ipcRenderer.invoke(IpcChannels.ANALYSIS_CANCEL, taskId),
    getTask: (projectId) => ipcRenderer.invoke(IpcChannels.ANALYSIS_GET_TASK, projectId),
    getLatest: (projectId) => ipcRenderer.invoke(IpcChannels.ANALYSIS_GET_LATEST, projectId),
    onProgress: (listener) => {
      const channel = IpcChannels.ANALYSIS_ON_PROGRESS;
      const subscription = (_event: any, data: any) => listener(data);
      ipcRenderer.on(channel, subscription);
      return () => ipcRenderer.removeListener(channel, subscription);
    },
  },
  profiles: {
    exportTemplate: id => ipcRenderer.invoke(IpcChannels.PROFILES_EXPORT_TEMPLATE, id),
    saveTemplateFile: id => ipcRenderer.invoke(IpcChannels.PROFILES_SAVE_TEMPLATE_FILE, id),
    inspectTemplate: text => ipcRenderer.invoke(IpcChannels.PROFILES_INSPECT_TEMPLATE, text),
    previewImport: input => ipcRenderer.invoke(IpcChannels.PROFILES_PREVIEW_IMPORT, toIpcPayload(input)),
    importTemplate: token => ipcRenderer.invoke(IpcChannels.PROFILES_IMPORT_TEMPLATE, token),
    save: (input) => ipcRenderer.invoke(IpcChannels.PROFILES_SAVE, toIpcPayload(input)),
    list: (projectId) => ipcRenderer.invoke(IpcChannels.PROFILES_LIST, projectId),
    get: (id) => ipcRenderer.invoke(IpcChannels.PROFILES_GET, id),
    copy: (id, name) => ipcRenderer.invoke(IpcChannels.PROFILES_COPY, id, name),
    remove: (id) => ipcRenderer.invoke(IpcChannels.PROFILES_REMOVE, id),
  },
  runner: {
    queryHistory: input => ipcRenderer.invoke(IpcChannels.HISTORY_QUERY, toIpcPayload(input)),
    queryLogs: input => ipcRenderer.invoke(IpcChannels.HISTORY_LOGS, toIpcPayload(input)),
    probeRuntime: (profileId, family) => ipcRenderer.invoke(IpcChannels.RUNNER_PROBE_RUNTIME, { profileId, family }),
    diagnose: (profileId) => ipcRenderer.invoke(IpcChannels.RUNNER_DIAGNOSE, { profileId }),
    getState: () => ipcRenderer.invoke(IpcChannels.RUNNER_GET_STATE),
    confirmExecution: (profileId, mode, theme) =>
      ipcRenderer.invoke(
        IpcChannels.RUNNER_CONFIRM_EXECUTION,
        toIpcPayload({ profileId, mode, theme })
      ),
    reuseExecutionApproval: (profileId, mode) =>
      ipcRenderer.invoke(
        IpcChannels.RUNNER_REUSE_EXECUTION_APPROVAL,
        toIpcPayload({ profileId, mode })
      ),
    start: (profileId, approvalToken) =>
      ipcRenderer.invoke(
        IpcChannels.RUNNER_START_SESSION,
        toIpcPayload({ profileId, approvalToken })
      ),
    installAndStart: (profileId, approvalToken) =>
      ipcRenderer.invoke(
        IpcChannels.RUNNER_INSTALL_AND_START,
        toIpcPayload({ profileId, approvalToken })
      ),
    stopSession: (sessionId) => ipcRenderer.invoke(IpcChannels.RUNNER_STOP_SESSION, sessionId),
    stopService: (serviceSessionId) => ipcRenderer.invoke(IpcChannels.RUNNER_STOP_SERVICE, serviceSessionId),
    restartService: (serviceSessionId) => ipcRenderer.invoke(IpcChannels.RUNNER_RESTART_SERVICE, serviceSessionId),
    onStatus: (listener) => {
      const channel = IpcChannels.RUNNER_ON_STATUS;
      const subscription = (_event: any, data: any) => listener(data);
      ipcRenderer.on(channel, subscription);
      return () => ipcRenderer.removeListener(channel, subscription);
    },
    onLogs: (listener) => {
      const channel = IpcChannels.RUNNER_ON_LOGS;
      const subscription = (_event: any, data: any) => listener(data);
      ipcRenderer.on(channel, subscription);
      return () => ipcRenderer.removeListener(channel, subscription);
    },
  },
  backups: {
    list:()=>ipcRenderer.invoke(IpcChannels.BACKUPS_LIST),
    create:()=>ipcRenderer.invoke(IpcChannels.BACKUPS_CREATE),
    pin:(id,pinned)=>ipcRenderer.invoke(IpcChannels.BACKUPS_PIN,id,pinned),
    setPolicy:policy=>ipcRenderer.invoke(IpcChannels.BACKUPS_POLICY,toIpcPayload(policy)),
    prepare:id=>ipcRenderer.invoke(IpcChannels.BACKUPS_PREPARE,id),
    restore:token=>ipcRenderer.invoke(IpcChannels.BACKUPS_RESTORE,token),
    openDirectory:()=>ipcRenderer.invoke(IpcChannels.BACKUPS_OPEN),
  },
  settings: {
    get: () => ipcRenderer.invoke(IpcChannels.SETTINGS_GET),
    update: (patch) => ipcRenderer.invoke(IpcChannels.SETTINGS_UPDATE, toIpcPayload(patch)),
    getLogStatus: () => ipcRenderer.invoke(IpcChannels.SETTINGS_LOG_STATUS),
    clearLogs: () => ipcRenderer.invoke(IpcChannels.SETTINGS_CLEAR_LOGS),
    openLogDirectory: () => ipcRenderer.invoke(IpcChannels.SETTINGS_OPEN_LOG_DIRECTORY),
  },
  window: {
    minimize: () => ipcRenderer.invoke(IpcChannels.WINDOW_MINIMIZE),
    toggleMaximize: () => ipcRenderer.invoke(IpcChannels.WINDOW_TOGGLE_MAXIMIZE),
    close: () => ipcRenderer.invoke(IpcChannels.WINDOW_CLOSE),
    isMaximized: () => ipcRenderer.invoke(IpcChannels.WINDOW_IS_MAXIMIZED),
    onMaximizeChange: (listener) => {
      const channel = IpcChannels.WINDOW_ON_MAXIMIZE_CHANGE;
      const subscription = (_event: any, isMax: boolean) => listener(isMax);
      ipcRenderer.on(channel, subscription);
      return () => ipcRenderer.removeListener(channel, subscription);
    },
  },
};

contextBridge.exposeInMainWorld('codehelm', api);
