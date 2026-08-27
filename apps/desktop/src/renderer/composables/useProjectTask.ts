import { computed, ref } from 'vue';
import type { CodeHelmApi, ProjectTaskDto, ProjectTaskProgressDto } from '@codehelm/contracts';

const terminal = (state: ProjectTaskProgressDto) => !['running', 'cancelling'].includes(state.status);

export function useProjectTask(
  api: CodeHelmApi['projects'],
  onFinished: (state: ProjectTaskDto) => void,
  onError: (error: unknown) => void,
) {
  const state = ref<ProjectTaskDto | null>(null);
  const starting = ref(false);
  const busy = computed(() => starting.value || (state.value !== null && !terminal(state.value)));
  let generation = 0;
  let disposed = false;
  let lastFinished: string | undefined;
  let unsubscribe: (() => void) | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let refreshing = false;

  async function refresh() {
    const taskId = state.value?.taskId;
    const version = generation;
    if (!taskId || disposed || refreshing) return;
    refreshing = true;
    try {
      const next = await api.getTask(taskId);
      if (!next || disposed || version !== generation || state.value?.taskId !== taskId) return;
      state.value = next;
      if (terminal(next) && lastFinished !== taskId) {
        lastFinished = taskId;
        onFinished(next);
      }
    } finally { refreshing = false; }
  }

  function subscribe() {
    if (unsubscribe) return;
    unsubscribe = api.onTaskProgress((event) => {
      if (disposed || event.taskId !== state.value?.taskId) return;
      if (terminal(event)) void refresh().catch(onError);
      else state.value = { ...state.value, ...event };
    });
    timer = setInterval(() => { if (busy.value) void refresh().catch(onError); }, 1000);
  }

  async function start(kind: ProjectTaskDto['kind'], request: () => Promise<{ taskId: string }>) {
    if (busy.value || disposed) return;
    const version = ++generation;
    state.value = null;
    starting.value = true;
    try {
      const { taskId } = await request();
      if (disposed || generation !== version) { await api.cancelTask(taskId); return; }
      state.value = { taskId, kind, status: 'running', stage: '正在启动任务…', completedCount: 0, totalCount: 0,
        scannedDirectories: 0, foundProjects: 0, scannedFiles: 0, discovered: [], results: [] };
      await refresh();
    } catch (error) {
      if (!disposed && generation === version) onError(error);
    } finally { if (generation === version) starting.value = false; }
  }

  async function cancel() {
    if (!state.value || !busy.value) return;
    const taskId = state.value.taskId;
    state.value = { ...state.value, status: 'cancelling', stage: '正在停止任务，已保存的项目将保留…' };
    try { await api.cancelTask(taskId); await refresh(); }
    catch (error) { onError(error); await refresh().catch(onError); }
  }

  function reset() {
    generation++;
    const previous = state.value;
    state.value = null;
    starting.value = false;
    if (previous && !terminal(previous)) void api.cancelTask(previous.taskId).catch(onError);
  }

  return { state, busy, starting, subscribe, refresh, start, cancel, reset,
    dispose() { disposed = true; unsubscribe?.(); unsubscribe = undefined; clearInterval(timer); reset(); },
  };
}
