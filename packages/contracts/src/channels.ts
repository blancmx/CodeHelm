export const IpcChannels = {
  // Projects
  PROJECTS_SELECT_DIRECTORY: 'codehelm:projects:select-directory',
  PROJECTS_IMPORT: 'codehelm:projects:import',
  PROJECTS_BATCH_IMPORT: 'codehelm:projects:batch-import',
  PROJECTS_SCAN_WORKSPACE: 'codehelm:projects:scan-workspace',
  PROJECTS_LIST: 'codehelm:projects:list',
  PROJECTS_GET: 'codehelm:projects:get',
  PROJECTS_REMOVE: 'codehelm:projects:remove',
  PROJECTS_UPDATE: 'codehelm:projects:update',
  PROJECTS_GET_FILE_TREE: 'codehelm:projects:get-file-tree',
  PROJECTS_GET_README: 'codehelm:projects:get-readme',

  // Analysis
  ANALYSIS_START: 'codehelm:analysis:start',
  ANALYSIS_CANCEL: 'codehelm:analysis:cancel',
  ANALYSIS_GET_LATEST: 'codehelm:analysis:get-latest',
  ANALYSIS_ON_PROGRESS: 'codehelm:analysis:on-progress',

  // Run Profiles
  PROFILES_SAVE: 'codehelm:profiles:save',
  PROFILES_LIST: 'codehelm:profiles:list',
  PROFILES_GET: 'codehelm:profiles:get',

  // Runner
  RUNNER_START_SESSION: 'codehelm:runner:start-session',
  RUNNER_INSTALL_AND_START: 'codehelm:runner:install-and-start',
  RUNNER_STOP_SESSION: 'codehelm:runner:stop-session',
  RUNNER_STOP_SERVICE: 'codehelm:runner:stop-service',
  RUNNER_RESTART_SERVICE: 'codehelm:runner:restart-service',
  RUNNER_ON_STATUS: 'codehelm:runner:on-status',
  RUNNER_ON_LOGS: 'codehelm:runner:on-logs',

  // Settings
  SETTINGS_GET: 'codehelm:settings:get',
  SETTINGS_UPDATE: 'codehelm:settings:update',
} as const;
