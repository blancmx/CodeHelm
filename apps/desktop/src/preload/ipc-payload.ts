/**
 * Electron IPC cannot structured-clone Vue reactive proxies. DTOs crossing the
 * preload boundary are JSON-shaped, so normalize them into detached plain data
 * before calling ipcRenderer.invoke.
 */
export function toIpcPayload<T>(value: T): T {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}
