import { createRouter, createWebHashHistory } from 'vue-router';
import MainLayout from '../layouts/MainLayout.vue';
import OverviewView from '../views/OverviewView.vue';
import ProjectDetailView from '../views/ProjectDetailView.vue';
import RunnerView from '../views/RunnerView.vue';
import ConsoleView from '../views/ConsoleView.vue';
import SettingsView from '../views/SettingsView.vue';
import { setPageTitle } from '../utils/title.js';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      component: MainLayout,
      children: [
        {
          path: '',
          name: 'overview',
          component: OverviewView,
          meta: { title: '项目总览' },
        },
        {
          path: 'projects/:id',
          name: 'project-detail',
          component: ProjectDetailView,
          props: true,
          meta: { title: '项目详情' },
        },
        {
          path: 'runner',
          name: 'runner',
          component: RunnerView,
          meta: { title: '运行中心' },
        },
        {
          path: 'console',
          name: 'console',
          component: ConsoleView,
          meta: { title: '实时控制台' },
        },
        {
          path: 'settings',
          name: 'settings',
          component: SettingsView,
          meta: { title: '系统设置' },
        },
      ],
    },
  ],
});

router.afterEach((to) => {
  const pageTitle = to.meta?.title as string | undefined;
  setPageTitle(pageTitle);
});

export default router;
