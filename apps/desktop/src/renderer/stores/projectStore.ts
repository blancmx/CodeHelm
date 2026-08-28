import { defineStore } from 'pinia';
import { ref } from 'vue';
import type {
  ImportProjectInput,
  DiscoveredProjectDto,
  ProjectDto,
  ProjectSummaryDto,
} from '@codehelm/contracts';

export const useProjectStore = defineStore('project', () => {
  const projects = ref<ProjectSummaryDto[]>([]);
  const currentProject = ref<ProjectDto | null>(null);
  const loading = ref(false);
  const listError = ref<string | null>(null);
  const hasLoadedProjects = ref(false);
  let listRequest = 0;
  const importModalVisible = ref(false);
  const searchModalVisible = ref(false);

  function openSearchModal() {
    searchModalVisible.value = true;
  }

  function closeSearchModal() {
    searchModalVisible.value = false;
  }

  async function fetchProjects(): Promise<boolean> {
    const request = ++listRequest;
    loading.value = true;
    try {
      if (!window.codehelm?.projects) throw new Error('项目数据接口不可用，请确认桌面端已正常启动');
      const result = await window.codehelm.projects.list();
      if (request !== listRequest) return false;
      projects.value = result;
      hasLoadedProjects.value = true;
      listError.value = null;
      return true;
    } catch (err) {
      console.error('Failed to fetch projects:', err);
      if (request === listRequest) {
        const detail = err instanceof Error ? err.message : String(err);
        listError.value = /SQLITE_CORRUPT|database disk image is malformed/i.test(detail)
          ? '数据库完整性异常，项目记录暂时无法读取。请保留数据库和日志，不要清库或重复导入。'
          : `项目列表读取失败：${detail}`;
      }
      return false;
    } finally {
      if (request === listRequest) loading.value = false;
    }
  }

  async function selectDirectory() {
    if (window.codehelm?.projects) {
      return await window.codehelm.projects.selectDirectory();
    }
    return null;
  }

  async function scanWorkspace(rootPath: string, options?: { maxDepth?: number }): Promise<DiscoveredProjectDto[]> {
    if (window.codehelm?.projects) {
      return await window.codehelm.projects.scanWorkspace(rootPath, options);
    }
    return [];
  }

  async function importProject(input: ImportProjectInput) {
    loading.value = true;
    try {
      if (window.codehelm?.projects) {
        const project = await window.codehelm.projects.import(input);
        await fetchProjects();
        return project;
      }
    } finally {
      loading.value = false;
    }
    return null;
  }

  async function batchImport(projectInputs: ImportProjectInput[]) {
    loading.value = true;
    try {
      if (window.codehelm?.projects) {
        const result = await window.codehelm.projects.batchImport({ projects: projectInputs });
        await fetchProjects();
        return result;
      }
    } finally {
      loading.value = false;
    }
    return [];
  }

  async function loadProjectDetail(id: string) {
    loading.value = true;
    try {
      if (window.codehelm?.projects) {
        currentProject.value = await window.codehelm.projects.get(id);
      }
    } finally {
      loading.value = false;
    }
  }

  async function removeProject(id: string) {
    if (window.codehelm?.projects) {
      await window.codehelm.projects.remove(id);
      await fetchProjects();
      if (currentProject.value?.id === id) {
        currentProject.value = null;
      }
    }
  }

  async function updateProject(id: string, patch: Partial<ProjectDto>) {
    if (window.codehelm?.projects?.update) {
      const updated = await window.codehelm.projects.update(id, patch);
      if (updated) {
        currentProject.value = updated;
        await fetchProjects();
      }
      return updated;
    }
    return null;
  }

  return {
    projects,
    currentProject,
    loading,
    listError,
    hasLoadedProjects,
    importModalVisible,
    searchModalVisible,
    openSearchModal,
    closeSearchModal,
    fetchProjects,
    selectDirectory,
    scanWorkspace,
    importProject,
    batchImport,
    loadProjectDetail,
    removeProject,
    updateProject,
  };
});
