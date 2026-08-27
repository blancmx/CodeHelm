export const IpcChannels = {
  // Projects
  PROJECTS_SELECT_DIRECTORY: 'codehelm:projects:select-directory',
  PROJECTS_IMPORT: 'codehelm:projects:import',
  PROJECTS_BATCH_IMPORT: 'codehelm:projects:batch-import',
  PROJECTS_SCAN_WORKSPACE: 'codehelm:projects:scan-workspace',
  PROJECTS_START_SCAN: 'codehelm:projects:start-scan',
  PROJECTS_START_IMPORT: 'codehelm:projects:start-import',
  PROJECTS_GET_TASK: 'codehelm:projects:get-task',
  PROJECTS_CANCEL_TASK: 'codehelm:projects:cancel-task',
  PROJECTS_ON_TASK_PROGRESS: 'codehelm:projects:on-task-progress',
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
  ANALYSIS_GET_TASK: 'codehelm:analysis:get-task',
  ANALYSIS_ON_PROGRESS: 'codehelm:analysis:on-progress',

  // Run Profiles
  PROFILES_SAVE: 'codehelm:profiles:save',
  PROFILES_LIST: 'codehelm:profiles:list',
  PROFILES_GET: 'codehelm:profiles:get',

  // Runner
  RUNNER_CONFIRM_EXECUTION: 'codehelm:runner:confirm-execution',
  RUNNER_REUSE_EXECUTION_APPROVAL: 'codehelm:runner:reuse-execution-approval',
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
  SETTINGS_LOG_STATUS: 'codehelm:settings:log-status',
  SETTINGS_CLEAR_LOGS: 'codehelm:settings:clear-logs',
  SETTINGS_OPEN_LOG_DIRECTORY: 'codehelm:settings:open-log-directory',

  // Window Controls
  WINDOW_MINIMIZE: 'codehelm:window:minimize',
  WINDOW_TOGGLE_MAXIMIZE: 'codehelm:window:toggle-maximize',
  WINDOW_CLOSE: 'codehelm:window:close',
  WINDOW_IS_MAXIMIZED: 'codehelm:window:is-maximized',
  WINDOW_ON_MAXIMIZE_CHANGE: 'codehelm:window:on-maximize-change',
} as const;
