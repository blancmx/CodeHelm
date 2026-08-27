import { computed, ref } from 'vue';
import type { AnalysisTaskDto, CodeHelmApi } from '@codehelm/contracts';

const terminal = (state: AnalysisTaskDto) => ['completed', 'failed', 'cancelled'].includes(state.status);

export function useAnalysisTask(
  api: CodeHelmApi['analysis'],
  projectId: () => string,
  onFinished: (state: AnalysisTaskDto) => void,
  onError: (error: unknown) => void,
) {
  const task = ref<AnalysisTaskDto | null>(null);
  const starting = ref(false);
  let generation = 0;
  let disposed = false;
  let unsubscribe: (() => void) | undefined;
  let lastFinishedId: string | undefined;
  const busy = computed(() => starting.value || (task.value !== null && !terminal(task.value)));
  const canCancel = computed(() => task.value?.status === 'running');

  function accept(state: AnalysisTaskDto, notify = true) {
    if (disposed || state.projectId !== projectId()) return;
    task.value = state;
    if (terminal(state) && state.taskId !== lastFinishedId) {
      lastFinishedId = state.taskId;
      if (notify) onFinished(state);
    }
  }

  async function restore(notify = false) {
    const version = generation;
    const id = projectId();
    const state = await api.getTask(id);
    if (!disposed && generation === version && id === projectId() && state) accept(state, notify);
  }

  async function start() {
    if (busy.value || disposed) return;
    const version = generation;
    const id = projectId();
    starting.value = true;
    task.value = null;
    try {
      const { taskId } = await api.start(id);
      if (disposed || generation !== version || id !== projectId()) {
        await api.cancel(taskId);
        return;
      }
      // Result can finish before invoke resolves. Query its authoritative terminal state.
      await restore(true);
    } catch (error) {
      if (!disposed && generation === version) onError(error);
    } finally {
      if (generation === version) starting.value = false;
    }
  }

  async function cancel() {
    if (!task.value || !canCancel.value) return;
    const id = task.value.taskId;
    task.value = { ...task.value, status: 'cancelling', stage: '正在停止扫描 Worker…' };
    try {
      await api.cancel(id);
      await restore(true);
    } catch (error) {
      onError(error);
      try { await restore(); } catch { /* Keep the error visible; never claim cancellation succeeded. */ }
    }
  }

  function reset() {
    const previous = task.value;
    generation++;
    task.value = null;
    starting.value = false;
    if (previous && !terminal(previous)) void api.cancel(previous.taskId).catch(onError);
  }

  return { task, busy, canCancel, start, cancel, restore, reset,
    subscribe() { unsubscribe ??= api.onProgress(accept); },
    dispose() { disposed = true; unsubscribe?.(); unsubscribe = undefined; reset(); },
  };
}
