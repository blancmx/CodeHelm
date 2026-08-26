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
import fs from 'node:fs';
import path from 'node:path';

const orchestrator = new Orchestrator();

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

  ipcMain.handle(IpcChannels.RUNNER_START_SESSION, async (_event, profileId: string) => {
    const profile = profileRepo.findById(profileId);
    if (!profile) {
      throw new Error(`Profile not found: ${profileId}`);
    }

    const project = projectRepo.findById(profile.projectId);
    if (!project) {
      throw new Error(`Project not found: ${profile.projectId}`);
    }

    const session = await orchestrator.startSession(project.rootPath, profile);

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
    const profile = profileRepo.findById(profileId);
    if (!profile) {
      throw new Error(`Profile not found: ${profileId}`);
    }

    const project = projectRepo.findById(profile.projectId);
    if (!project) {
      throw new Error(`Project not found: ${profile.projectId}`);
    }

    const projectRoot = project.rootPath;

    // Detect if Node.js project needs install
    const hasPackageJson = fs.existsSync(path.join(projectRoot, 'package.json'));
    const hasNodeModules = fs.existsSync(path.join(projectRoot, 'node_modules'));
    const hasRequirementsTxt = fs.existsSync(path.join(projectRoot, 'requirements.txt'));

    if (hasPackageJson && !hasNodeModules) {
      let pm = 'npm';
      if (fs.existsSync(path.join(projectRoot, 'pnpm-lock.yaml'))) pm = 'pnpm';
      else if (fs.existsSync(path.join(projectRoot, 'yarn.lock'))) pm = 'yarn';
      else if (fs.existsSync(path.join(projectRoot, 'bun.lockb')) || fs.existsSync(path.join(projectRoot, 'bun.lock'))) pm = 'bun';

      broadcastLog('CodeHelm Installer', `[Vibe Auto-Fix] 正在为项目安装 Node.js 依赖: ${pm} install...`);

      await new Promise<void>((resolve, reject) => {
        const child = spawn(pm, ['install'], {
          cwd: projectRoot,
          shell: true,
          env: { ...process.env },
        });

        child.stdout?.on('data', (data: Buffer | string) => {
          broadcastLog('CodeHelm Installer', data.toString().trimEnd());
        });

        child.stderr?.on('data', (data: Buffer | string) => {
          broadcastLog('CodeHelm Installer', data.toString().trimEnd(), 'stderr');
        });

        child.on('close', (code: number | null) => {
          if (code === 0) {
            broadcastLog('CodeHelm Installer', `[Vibe Auto-Fix] 依赖安装完成！准备拉起服务...`);
            resolve();
          } else {
            reject(new Error(`依赖安装失败 (退出码: ${code})，请检查网络或配置`));
          }
        });

        child.on('error', (err: Error) => reject(err));
      });
    } else if (hasRequirementsTxt) {
      broadcastLog('CodeHelm Installer', `[Vibe Auto-Fix] 正在检查/安装 Python 依赖: pip install -r requirements.txt...`);
      await new Promise<void>((resolve) => {
        const child = spawn('pip', ['install', '-r', 'requirements.txt'], {
          cwd: projectRoot,
          shell: true,
          env: { ...process.env },
        });

        child.stdout?.on('data', (data: Buffer | string) => {
          broadcastLog('CodeHelm Installer', data.toString().trimEnd());
        });

        child.stderr?.on('data', (data: Buffer | string) => {
          broadcastLog('CodeHelm Installer', data.toString().trimEnd(), 'stderr');
        });

        child.on('close', () => {
          resolve();
        });
      });
    }

    // Now start the session
    const session = await orchestrator.startSession(project.rootPath, profile);

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
