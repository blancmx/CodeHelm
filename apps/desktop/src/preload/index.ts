import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels } from '@codehelm/contracts';
import type { CodeHelmApi } from '@codehelm/contracts';
import { toIpcPayload } from './ipc-payload.js';

const api: CodeHelmApi = {
  projects: {
    selectDirectory: () => ipcRenderer.invoke(IpcChannels.PROJECTS_SELECT_DIRECTORY),
    import: (input) => ipcRenderer.invoke(IpcChannels.PROJECTS_IMPORT, toIpcPayload(input)),
    batchImport: (input) => ipcRenderer.invoke(IpcChannels.PROJECTS_BATCH_IMPORT, toIpcPayload(input)),
    scanWorkspace: (rootPath, options) =>
      ipcRenderer.invoke(IpcChannels.PROJECTS_SCAN_WORKSPACE, rootPath, toIpcPayload(options)),
    list: () => ipcRenderer.invoke(IpcChannels.PROJECTS_LIST),
    get: (id) => ipcRenderer.invoke(IpcChannels.PROJECTS_GET, id),
    remove: (id) => ipcRenderer.invoke(IpcChannels.PROJECTS_REMOVE, id),
    update: (id, patch) => ipcRenderer.invoke(IpcChannels.PROJECTS_UPDATE, id, toIpcPayload(patch)),
    getFileTree: (rootPath, options) =>
      ipcRenderer.invoke(IpcChannels.PROJECTS_GET_FILE_TREE, rootPath, toIpcPayload(options)),
  },
  analysis: {
    start: (projectId) => ipcRenderer.invoke(IpcChannels.ANALYSIS_START, projectId),
    cancel: (taskId) => ipcRenderer.invoke(IpcChannels.ANALYSIS_CANCEL, taskId),
    getLatest: (projectId) => ipcRenderer.invoke(IpcChannels.ANALYSIS_GET_LATEST, projectId),
    onProgress: (listener) => {
      const channel = IpcChannels.ANALYSIS_ON_PROGRESS;
      const subscription = (_event: any, data: any) => listener(data);
      ipcRenderer.on(channel, subscription);
      return () => ipcRenderer.removeListener(channel, subscription);
    },
  },
  profiles: {
    save: (input) => ipcRenderer.invoke(IpcChannels.PROFILES_SAVE, toIpcPayload(input)),
    list: (projectId) => ipcRenderer.invoke(IpcChannels.PROFILES_LIST, projectId),
    get: (id) => ipcRenderer.invoke(IpcChannels.PROFILES_GET, id),
  },
  runner: {
    start: (profileId) => ipcRenderer.invoke(IpcChannels.RUNNER_START_SESSION, profileId),
    installAndStart: (profileId) =>
      ipcRenderer.invoke(IpcChannels.RUNNER_INSTALL_AND_START, profileId),
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
  settings: {
    get: () => ipcRenderer.invoke(IpcChannels.SETTINGS_GET),
    update: (patch) => ipcRenderer.invoke(IpcChannels.SETTINGS_UPDATE, toIpcPayload(patch)),
  },
};

contextBridge.exposeInMainWorld('codehelm', api);
