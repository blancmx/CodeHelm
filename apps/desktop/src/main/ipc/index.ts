import type { Database as DatabaseInstance } from 'better-sqlite3';
import { registerProjectHandlers } from './project-handlers.js';
import { registerProfileHandlers } from './profile-handlers.js';
import { registerAnalysisHandlers } from './analysis-handlers.js';
import { registerRunnerHandlers } from './runner-handlers.js';
import { registerSettingsHandlers } from './settings-handlers.js';

export { stopAllRunnerSessions } from './runner-handlers.js';

export function registerAllIpcHandlers(db: DatabaseInstance) {
  registerProjectHandlers(db);
  registerProfileHandlers(db);
  registerAnalysisHandlers(db);
  registerRunnerHandlers(db);
  registerSettingsHandlers(db);
}
