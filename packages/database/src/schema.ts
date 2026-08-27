export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT UNIQUE NOT NULL,
  real_path_hash TEXT,
  description TEXT,
  color TEXT,
  icon TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_analyzed_at TEXT,
  last_run_at TEXT
);

CREATE TABLE IF NOT EXISTS analysis_snapshots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  analyzer_version TEXT NOT NULL,
  status TEXT NOT NULL,
  primary_language TEXT NOT NULL DEFAULT '',
  languages_json TEXT NOT NULL DEFAULT '[]',
  started_at TEXT NOT NULL,
  completed_at TEXT,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS modules (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES analysis_snapshots(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  module_type TEXT NOT NULL,
  technologies_json TEXT NOT NULL DEFAULT '[]',
  suggested_commands_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS technology_evidence (
  id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  technology TEXT NOT NULL,
  category TEXT NOT NULL,
  confidence REAL NOT NULL,
  evidence_type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  detail TEXT NOT NULL,
  line INTEGER
);

CREATE TABLE IF NOT EXISTS run_profiles (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_default INTEGER NOT NULL DEFAULT 1,
  failure_policy TEXT NOT NULL DEFAULT 'block_dependents',
  user_confirmed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS service_configs (
  id TEXT PRIMARY KEY,
  run_profile_id TEXT NOT NULL REFERENCES run_profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  module_relative_path TEXT NOT NULL,
  executable TEXT NOT NULL,
  args_json TEXT NOT NULL DEFAULT '[]',
  cwd_relative TEXT NOT NULL,
  env_json TEXT NOT NULL DEFAULT '[]',
  port INTEGER,
  port_mode TEXT NOT NULL DEFAULT 'auto',
  port_extract_regex TEXT,
  health_check_json TEXT,
  depends_on_json TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'detected',
  start_timeout_ms INTEGER,
  stop_timeout_ms INTEGER
);

CREATE TABLE IF NOT EXISTS run_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_profile_id TEXT NOT NULL REFERENCES run_profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  stopped_at TEXT
);

CREATE TABLE IF NOT EXISTS service_sessions (
  id TEXT PRIMARY KEY,
  run_session_id TEXT NOT NULL REFERENCES run_sessions(id) ON DELETE CASCADE,
  service_config_id TEXT NOT NULL,
  service_name TEXT NOT NULL,
  service_type TEXT NOT NULL,
  status TEXT NOT NULL,
  pid INTEGER,
  fingerprint_json TEXT,
  port INTEGER,
  exit_code INTEGER,
  exit_signal TEXT,
  error_message TEXT,
  started_at TEXT,
  stopped_at TEXT
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_root ON projects(root_path);
CREATE INDEX IF NOT EXISTS idx_analysis_proj ON analysis_snapshots(project_id);
CREATE INDEX IF NOT EXISTS idx_modules_snap ON modules(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_profiles_proj ON run_profiles(project_id);
CREATE INDEX IF NOT EXISTS idx_services_prof ON service_configs(run_profile_id);
CREATE INDEX IF NOT EXISTS idx_sessions_proj ON run_sessions(project_id);
`;
