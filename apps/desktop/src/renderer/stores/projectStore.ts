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
  const importModalVisible = ref(false);

  async function fetchProjects() {
    loading.value = true;
    try {
      if (window.codehelm?.projects) {
        projects.value = await window.codehelm.projects.list();
      }
    } catch (err) {
      console.error('Failed to fetch projects:', err);
    } finally {
      loading.value = false;
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
    importModalVisible,
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
