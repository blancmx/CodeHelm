import { dialog, ipcMain, BrowserWindow } from 'electron';
import type { Database as DatabaseInstance } from 'better-sqlite3';
import {
  IpcChannels,
  RunSessionDtoSchema,
  RunnerExecutionConfirmationRequestSchema,
  RunnerExecutionRequestSchema,
  ServiceSessionDtoSchema,
} from '@codehelm/contracts';
import type { RunnerExecutionMode } from '@codehelm/contracts';
import { DEFAULT_MAX_LOG_ENTRY_BYTES, truncateUtf8 } from '@codehelm/domain';
import { ProfileRepository, ProjectRepository } from '@codehelm/database';
import { killProcessTree, Orchestrator } from '@codehelm/runner';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import {
  checkPythonModuleAvailable,
  createDependencyInstallPlans,
  type DependencyInstallPlan,
} from './dependency-installer.js';
import {
  createExecutionConfigurationFingerprint,
  createExecutionFingerprint,
  ExecutionApprovalGuard,
  ExecutionSlotGuard,
} from './execution-approval.js';
import { applyRuntimeProfileConstraints } from './runtime-profile-constraints.js';
import { decryptProfileSecrets, protectProfileSecrets } from './profile-secrets.js';
import type { LogStorage } from './log-storage.js';

const orchestrator = new Orchestrator();
const activeInstallerProcesses = new Set<ChildProcess>();
let runnerShutdownRequested = false;

export async function stopAllRunnerSessions(): Promise<void> {
  runnerShutdownRequested = true;
  const installerStops = [...activeInstallerProcesses].map(async (child) => {
    const pid = child.pid;
    try {
      if (pid && child.exitCode === null) {
        await killProcessTree(
          pid,
          'SIGKILL',
          1000,
          () => child.pid === pid && child.exitCode === null && child.signalCode === null,
          () => child.pid === pid && child.exitCode === null && child.signalCode === null,
          () => child.pid === pid && child.exitCode === null && child.signalCode === null,
          (signal) => child.kill(signal as NodeJS.Signals)
        );
      } else if (!pid && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    } finally {
      activeInstallerProcesses.delete(child);
    }
  });

  await Promise.allSettled([
    orchestrator.stopAll(),
    ...installerStops,
  ]);
}

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

export function registerRunnerHandlers(db: DatabaseInstance, logs?: LogStorage) {
  const profileRepo = new ProfileRepository(db);
  const projectRepo = new ProjectRepository(db);
  const executionApprovals = new ExecutionApprovalGuard();
  const activeExecutions = new ExecutionSlotGuard();

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
    logs?.accept(batch);
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
          message: truncateUtf8(message, DEFAULT_MAX_LOG_ENTRY_BYTES),
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
    if (runnerShutdownRequested) {
      throw new Error('Runner shutdown in progress');
    }
    // The caller consumes the profile-bound approval token before this runtime check.
    if (
      plan.pythonModuleCheck
      && checkPythonModuleAvailable(plan.executable, plan.pythonModuleCheck.moduleName, plan.cwd)
    ) {
      broadcastLog(
        'CodeHelm Installer',
        `[Dependency] ${plan.label} 已存在，跳过安装。\n`
      );
      return;
    }
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
      activeInstallerProcesses.add(child);
      const removeInstaller = () => activeInstallerProcesses.delete(child);
      child.stdout?.on('data', (data: Buffer | string) => {
        broadcastLog('CodeHelm Installer', data.toString().trimEnd());
      });
      child.stderr?.on('data', (data: Buffer | string) => {
        broadcastLog('CodeHelm Installer', data.toString().trimEnd(), 'stderr');
      });
      child.once('error', (error) => {
        removeInstaller();
        reject(error);
      });
      child.once('close', (code: number | null) => {
        removeInstaller();
        if (code === 0) resolve();
        else reject(new Error(`子模块 ${plan.label} 依赖安装失败（退出码 ${code ?? '未知'}）`));
      });
    });
  }

  function reconcileProfile(profileId: string) {
    const storedProfile = profileRepo.findById(profileId);
    if (!storedProfile) throw new Error(`Profile not found: ${profileId}`);
    const protectedResult = protectProfileSecrets(storedProfile);
    const persistedProfile = protectedResult.changed
      ? profileRepo.save({
          id: protectedResult.profile.id,
          projectId: protectedResult.profile.projectId,
          name: protectedResult.profile.name,
          description: protectedResult.profile.description,
          isDefault: protectedResult.profile.isDefault,
          failurePolicy: protectedResult.profile.failurePolicy,
          services: protectedResult.profile.services,
          userConfirmedAt: protectedResult.profile.userConfirmedAt,
        })
      : protectedResult.profile;
    const project = projectRepo.findById(persistedProfile.projectId);
    if (!project) throw new Error(`Project not found: ${persistedProfile.projectId}`);

    const constrained = applyRuntimeProfileConstraints(project.rootPath, persistedProfile);
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
    return { profile: decryptProfileSecrets(profile), project };
  }

  function getExecutionContext(profileId: string, mode: RunnerExecutionMode) {
    const { profile, project } = reconcileProfile(profileId);
    const plans = mode === 'install'
      ? createDependencyInstallPlans(project.rootPath, profile.services)
      : [];
    return buildExecutionContext(profile, project, mode, plans);
  }

  function buildExecutionContext(
    profile: ReturnType<typeof reconcileProfile>['profile'],
    project: ReturnType<typeof reconcileProfile>['project'],
    mode: RunnerExecutionMode,
    plans: DependencyInstallPlan[]
  ) {
    return {
      profile,
      project,
      plans,
      approvalContext: {
        profileId: profile.id,
        mode,
        configurationFingerprint: createExecutionConfigurationFingerprint(
          profile,
          project.rootPath
        ),
        executionFingerprint: createExecutionFingerprint(
          profile,
          project.rootPath,
          mode,
          plans
        ),
      },
    };
  }

  function requireExecutionSlot(profileId: string): void {
    activeExecutions.acquire(profileId);
  }

  function releaseExecutionSlot(profileId: string): void {
    activeExecutions.release(profileId);
  }

  function requireNoActiveExecution(profileId: string): void {
    activeExecutions.assertAvailable(profileId);
  }

  async function requestInteractiveExecutionConfirmation(
    profile: ReturnType<typeof reconcileProfile>['profile'],
    project: ReturnType<typeof reconcileProfile>['project'],
    mode: RunnerExecutionMode,
    plans: DependencyInstallPlan[],
    approvalContext: ReturnType<typeof getExecutionContext>['approvalContext']
  ): Promise<string> {
    const serviceDetails = profile.services
      .filter((service) => service.enabled)
      .map((service) => {
        const command = [service.executable, ...service.args].join(' ');
        const envNames = service.env
          .map((entry) => entry.key)
          .filter(Boolean)
          .join(', ');
        return [
          `- ${service.name}: ${command}`,
          `  cwd: ${service.cwdRelative || '.'}`,
          `  env names: ${envNames || '(none)'}`,
        ].join('\n');
      });
    const installDetails = plans.map((plan) =>
      `- ${plan.executable} ${plan.args.join(' ')} (cwd: ${plan.cwd})`
    );
    const detail = [
      `Project root: ${project.rootPath}`,
      `Execution mode: ${mode === 'install' ? 'install dependencies and start' : 'start'}`,
      'Services:',
      ...(serviceDetails.length > 0 ? serviceDetails : ['- (none)']),
      ...(mode === 'install'
        ? ['Dependency install plans:', ...(installDetails.length > 0 ? installDetails : ['- (none)'])]
        : []),
    ].join('\n');
    const options = {
      type: 'warning' as const,
      title: mode === 'install' ? 'Confirm dependency installation and start' : 'Confirm service start',
      message: 'CodeHelm is about to execute the current project run profile.',
      detail,
      buttons: ['Confirm execution', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    };
    const owner = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
    const result = owner
      ? await dialog.showMessageBox(owner, options)
      : await dialog.showMessageBox(options);
    if (result.response !== 0) {
      throw new Error('Execution confirmation cancelled.');
    }
    return executionApprovals.confirm(approvalContext);
  }

  ipcMain.handle(IpcChannels.RUNNER_CONFIRM_EXECUTION, async (_event, rawRequest) => {
    const request = RunnerExecutionConfirmationRequestSchema.parse(rawRequest);
    requireNoActiveExecution(request.profileId);
    const { profile, project, plans, approvalContext } = getExecutionContext(
      request.profileId,
      request.mode
    );
    return requestInteractiveExecutionConfirmation(
      profile,
      project,
      request.mode,
      plans,
      approvalContext
    );
  });

  ipcMain.handle(IpcChannels.RUNNER_REUSE_EXECUTION_APPROVAL, async (_event, rawRequest) => {
    const request = RunnerExecutionConfirmationRequestSchema.parse(rawRequest);
    requireNoActiveExecution(request.profileId);
    const { profile, project } = reconcileProfile(request.profileId);
    const configurationFingerprint = createExecutionConfigurationFingerprint(
      profile,
      project.rootPath
    );
    if (request.mode === 'install') {
      return executionApprovals.reuseConfiguration(
        profile.id,
        request.mode,
        configurationFingerprint
      );
    }
    const { approvalContext } = buildExecutionContext(profile, project, request.mode, []);
    return executionApprovals.reuse(approvalContext);
  });

  ipcMain.handle(IpcChannels.RUNNER_START_SESSION, async (_event, rawRequest) => {
    const request = RunnerExecutionRequestSchema.parse(rawRequest);
    requireExecutionSlot(request.profileId);
    try {
      const { profile, project, approvalContext } = getExecutionContext(request.profileId, 'start');
      executionApprovals.consume(approvalContext, request.approvalToken);

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
    } finally {
      releaseExecutionSlot(request.profileId);
    }
  });

  // Install dependencies and then start session
  ipcMain.handle(IpcChannels.RUNNER_INSTALL_AND_START, async (_event, rawRequest) => {
    const request = RunnerExecutionRequestSchema.parse(rawRequest);
    requireExecutionSlot(request.profileId);
    try {
      const { profile, project } = reconcileProfile(request.profileId);
      const configurationFingerprint = createExecutionConfigurationFingerprint(
        profile,
        project.rootPath
      );
      executionApprovals.assertConfiguration(request.approvalToken, {
        profileId: profile.id,
        mode: 'install',
        configurationFingerprint,
      });

      // Only an already issued, profile-bound token may trigger the runtime
      // checks below. In particular, inferred Python checks can spawn a
      // local interpreter and must not happen for an unapproved request.
      const plans = createDependencyInstallPlans(project.rootPath, profile.services);
      const { approvalContext } = buildExecutionContext(profile, project, 'install', plans);
      executionApprovals.consume(approvalContext, request.approvalToken);

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
    } finally {
      releaseExecutionSlot(request.profileId);
    }
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
