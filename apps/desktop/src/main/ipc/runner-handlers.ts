import { ipcMain, BrowserWindow } from 'electron';
import type { Database as DatabaseInstance } from 'better-sqlite3';
import {
  IpcChannels,
  RunSessionDtoSchema,
  ServiceSessionDtoSchema,
} from '@codehelm/contracts';
import { ProfileRepository, ProjectRepository } from '@codehelm/database';
import { Orchestrator } from '@codehelm/runner';
import { spawn } from 'node:child_process';
import { createDependencyInstallPlans, type DependencyInstallPlan } from './dependency-installer.js';
import { applyRuntimeProfileConstraints } from './runtime-profile-constraints.js';

const orchestrator = new Orchestrator();

function requireStartedSession(session: Awaited<ReturnType<Orchestrator['startSession']>>) {
  if (session.status !== 'FAILED') return session;

  const details = session.services
    .filter((service) => service.status === 'FAILED')
    .map((service) => `${service.serviceName}: ${service.errorMessage || '进程已退出'}`);
  throw new Error(
    details.length > 0
      ? `服务方案启动失败：${details.join('；')}`
      : '服务方案启动失败：没有服务成功运行，请检查端口占用与项目启动配置。'
  );
}

export function registerRunnerHandlers(db: DatabaseInstance) {
  const profileRepo = new ProfileRepository(db);
  const projectRepo = new ProjectRepository(db);

  // Hook background status & log broadcasters
  orchestrator.onStatusChange((session, projectId, runSessionId) => {
    const eventData = {
      projectId,
      runSessionId,
      serviceSessionId: session.id,
      serviceConfigId: session.serviceConfigId,
      serviceName: session.serviceName,
      status: session.status,
      pid: session.pid,
      port: session.port,
      errorMessage: session.errorMessage,
      exitCode: session.exitCode,
    };

    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send(IpcChannels.RUNNER_ON_STATUS, eventData);
      }
    }
  });

  orchestrator.onLogs((batch) => {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send(IpcChannels.RUNNER_ON_LOGS, batch);
      }
    }
  });

  function broadcastLog(serviceName: string, message: string, stream: 'stdout' | 'stderr' = 'stdout') {
    const batch = {
      serviceSessionId: 'install-step',
      serviceName,
      entries: [
        {
          timestamp: new Date().toISOString(),
          stream,
          message,
        },
      ],
    };
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send(IpcChannels.RUNNER_ON_LOGS, batch);
      }
    }
  }

  async function runDependencyPlan(plan: DependencyInstallPlan): Promise<void> {
    broadcastLog(
      'CodeHelm Installer',
      `[Dependency] 正在准备子模块 ${plan.label}: ${plan.executable} ${plan.args.join(' ')}\n`
    );
    await new Promise<void>((resolve, reject) => {
      const child = spawn(plan.executable, plan.args, {
        cwd: plan.cwd,
        shell: true,
        env: { ...process.env },
      });
      child.stdout?.on('data', (data: Buffer | string) => {
        broadcastLog('CodeHelm Installer', data.toString().trimEnd());
      });
      child.stderr?.on('data', (data: Buffer | string) => {
        broadcastLog('CodeHelm Installer', data.toString().trimEnd(), 'stderr');
      });
      child.once('error', reject);
      child.once('close', (code: number | null) => {
        if (code === 0) resolve();
        else reject(new Error(`子模块 ${plan.label} 依赖安装失败（退出码 ${code ?? '未知'}）`));
      });
    });
  }

  function reconcileProfile(profileId: string) {
    const storedProfile = profileRepo.findById(profileId);
    if (!storedProfile) throw new Error(`Profile not found: ${profileId}`);
    const project = projectRepo.findById(storedProfile.projectId);
    if (!project) throw new Error(`Project not found: ${storedProfile.projectId}`);

    const constrained = applyRuntimeProfileConstraints(project.rootPath, storedProfile);
    let profile = constrained.profile;
    if (constrained.messages.length > 0) {
      profile = profileRepo.save({
        id: profile.id,
        projectId: profile.projectId,
        name: profile.name,
        description: profile.description,
        isDefault: profile.isDefault,
        failurePolicy: profile.failurePolicy,
        services: profile.services,
        userConfirmedAt: profile.userConfirmedAt,
      });
      for (const message of constrained.messages) {
        broadcastLog('CodeHelm Runtime', `${message}\n`);
      }
    }
    return { profile, project };
  }

  ipcMain.handle(IpcChannels.RUNNER_START_SESSION, async (_event, profileId: string) => {
    const { profile, project } = reconcileProfile(profileId);

    const session = requireStartedSession(
      await orchestrator.startSession(project.rootPath, profile)
    );

    // Update project lastRunAt
    db.prepare('UPDATE projects SET last_run_at = ? WHERE id = ?').run(
      new Date().toISOString(),
      project.id
    );

    // The orchestrator keeps mutating its live session in the background.
    // Return a detached DTO snapshot so Electron never attempts to clone a
    // live object while the service startup pipeline is updating it.
    return RunSessionDtoSchema.parse(session);
  });

  // Install dependencies and then start session
  ipcMain.handle(IpcChannels.RUNNER_INSTALL_AND_START, async (_event, profileId: string) => {
    const { profile, project } = reconcileProfile(profileId);

    const plans = createDependencyInstallPlans(project.rootPath, profile.services);
    for (const plan of plans) {
      await runDependencyPlan(plan);
    }
    if (plans.length > 0) {
      broadcastLog('CodeHelm Installer', '[Dependency] 所有缺失依赖已安装，准备拉起服务。\n');
    }

    // Now start the session
    const session = requireStartedSession(
      await orchestrator.startSession(project.rootPath, profile)
    );

    db.prepare('UPDATE projects SET last_run_at = ? WHERE id = ?').run(
      new Date().toISOString(),
      project.id
    );

    return RunSessionDtoSchema.parse(session);
  });

  ipcMain.handle(IpcChannels.RUNNER_STOP_SESSION, async (_event, sessionId: string) => {
    await orchestrator.stopSession(sessionId);
    return { success: true };
  });

  ipcMain.handle(IpcChannels.RUNNER_STOP_SERVICE, async (_event, serviceSessionId: string) => {
    await orchestrator.stopService(serviceSessionId);
    return { success: true };
  });

  ipcMain.handle(IpcChannels.RUNNER_RESTART_SERVICE, async (_event, serviceSessionId: string) => {
    const newSession = await orchestrator.restartService(serviceSessionId);
    return ServiceSessionDtoSchema.parse(newSession);
  });
}
