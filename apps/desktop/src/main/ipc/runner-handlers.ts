import type { RegisterIpcHandler } from './trusted-ipc.js';
import { BrowserWindow } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { showExecutionConfirmation } from '../execution-confirmation-window.js';
import type { Database as DatabaseInstance } from 'better-sqlite3';
import {
  IpcChannels,
  RunSessionDtoSchema,
  RunnerExecutionConfirmationRequestSchema,
  RunnerExecutionRequestSchema,
  ServiceSessionDtoSchema,
  RunnerStateDtoSchema,
} from '@codehelm/contracts';
import type { RunnerExecutionMode } from '@codehelm/contracts';
import { DEFAULT_MAX_LOG_ENTRY_BYTES, truncateUtf8 } from '@codehelm/domain';
import { ProfileRepository, ProjectRepository, SessionRepository } from '@codehelm/database';
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
  createExecutionApprovalContext,
  createExecutionProfileFingerprint,
  ExecutionApprovalGuard,
  ExecutionSlotGuard,
} from './execution-approval.js';
import { applyRuntimeProfileConstraints } from './runtime-profile-constraints.js';
import { decryptProfileSecrets, protectProfileSecrets } from './profile-secrets.js';
import type { LogStorage } from './log-storage.js';
import { recoverInterruptedSessions } from './session-recovery.js';

const orchestrator = new Orchestrator();
const activeInstallerProcesses = new Set<ChildProcess>();
const activeExecutionReads = new Set<AbortController>();
let runnerShutdownRequested = false;

export async function stopAllRunnerSessions(): Promise<void> {
  runnerShutdownRequested = true;
  for (const controller of activeExecutionReads) controller.abort();
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

export async function registerRunnerHandlers(handle: RegisterIpcHandler, db: DatabaseInstance, logs?: LogStorage) {
  const profileRepo = new ProfileRepository(db);
  const projectRepo = new ProjectRepository(db);
  const sessionRepo = new SessionRepository(db);
  const recovered = await recoverInterruptedSessions(sessionRepo);
  console.log('[Runner] Reconciled historical sessions:', recovered);
  orchestrator.setSessionPersistence(session => sessionRepo.save(session));
  const executionApprovals = new ExecutionApprovalGuard();
  const activeExecutions = new ExecutionSlotGuard();

  handle(IpcChannels.RUNNER_GET_STATE, () => {
    const activeSessions = orchestrator.getActiveSessions();
    const activeIds = new Set(activeSessions.map(s => s.id));
    return RunnerStateDtoSchema.parse({
      // Retain failed/stopped siblings in an active run. The renderer gates actions by
      // service status; filtering here loses failures whenever it refreshes.
      activeSessions,
      history: sessionRepo.listRecent(100).filter(s => !activeIds.has(s.id)).slice(0, 50),
      unresolvedSessions: sessionRepo.listUnresolved(),
      persistenceError: orchestrator.getPersistenceError(),
    });
  });

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

  async function reconcileProfile(profileId: string, signal: AbortSignal) {
    signal.throwIfAborted();
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

    const snapshot = structuredClone({ profile: persistedProfile, project });
    const revision = JSON.stringify(snapshot);
    const constrained = await applyRuntimeProfileConstraints(snapshot.project.rootPath, snapshot.profile, { signal });
    signal.throwIfAborted();
    if (runnerShutdownRequested) throw new Error('Runner shutdown in progress');
    // Discovery yields to edits. Do not overwrite newer metadata or execution state.
    if (JSON.stringify({ profile: profileRepo.findById(profileId), project: projectRepo.findById(project.id) }) !== revision) {
      throw new Error('Execution confirmation required: 执行内容已变化，请重新核对后启动。');
    }
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
    return { profile: decryptProfileSecrets(profile), project: snapshot.project };
  }

  async function getExecutionContext(profileId: string, mode: RunnerExecutionMode, signal: AbortSignal) {
    const { profile, project } = await reconcileProfile(profileId, signal);
    const plans = mode === 'install'
      ? createDependencyInstallPlans(project.rootPath, profile.services)
      : [];
    return buildExecutionContext(profile, project, mode, plans, signal);
  }

  async function buildExecutionContext(
    profile: Awaited<ReturnType<typeof reconcileProfile>>['profile'],
    project: Awaited<ReturnType<typeof reconcileProfile>>['project'],
    mode: RunnerExecutionMode,
    plans: DependencyInstallPlan[],
    signal: AbortSignal
  ) {
    const snapshot = structuredClone({ profile, project, plans });
    return {
      ...snapshot,
      approvalContext: await createExecutionApprovalContext(
        snapshot.profile, snapshot.project.rootPath, mode, snapshot.plans, { signal }
      ),
    };
  }

  function assertCurrentSnapshot(
    profile: Awaited<ReturnType<typeof reconcileProfile>>['profile'],
    project: Awaited<ReturnType<typeof reconcileProfile>>['project'],
    signal: AbortSignal
  ): void {
    signal.throwIfAborted();
    if (runnerShutdownRequested) throw new Error('Runner shutdown in progress');
    // Compare repository state only. Re-running discovery here adds unrelated
    // filesystem work after the bounded read and may mutate the reviewed plan.
    const storedProfile = profileRepo.findById(profile.id);
    const currentProject = storedProfile && projectRepo.findById(storedProfile.projectId);
    if (!storedProfile || !currentProject) throw new Error('Execution confirmation required: 执行内容已变化。');
    if (createExecutionProfileFingerprint(profile, project.rootPath)
      !== createExecutionProfileFingerprint(decryptProfileSecrets(storedProfile), currentProject.rootPath)) {
      throw new Error('Execution confirmation required: 执行内容已变化，请重新核对后启动。');
    }
  }

  const pendingRequests = new Set<number>();
  function handleExecutionRequest(
    channel: string,
    callback: (event: IpcMainInvokeEvent, request: unknown, signal: AbortSignal) => Promise<unknown>
  ): void {
    handle(channel, async (event, request) => {
      const owner = BrowserWindow.fromWebContents(event.sender);
      if (!owner || owner.isDestroyed() || event.senderFrame !== event.sender.mainFrame) {
        throw new Error('执行确认必须来自应用主窗口。');
      }
      if (runnerShutdownRequested) throw new Error('Runner shutdown in progress');
      if (pendingRequests.has(event.sender.id)) throw new Error('已有执行请求，请先完成或取消。');
      const controller = new AbortController();
      const cancel = () => controller.abort(new Error('执行请求已取消。'));
      pendingRequests.add(event.sender.id);
      activeExecutionReads.add(controller);
      owner.once('closed', cancel);
      event.sender.on('did-start-navigation', cancel);
      event.sender.once('render-process-gone', cancel);
      try { return await callback(event, request, controller.signal); }
      finally {
        owner.removeListener('closed', cancel);
        event.sender.removeListener('did-start-navigation', cancel);
        event.sender.removeListener('render-process-gone', cancel);
        activeExecutionReads.delete(controller);
        pendingRequests.delete(event.sender.id);
      }
    });
  }

  function requireExecutionSlot(profileId: string): void {
    requireNoActiveExecution(profileId);
    activeExecutions.acquire(profileId);
  }

  function releaseExecutionSlot(profileId: string): void {
    activeExecutions.release(profileId);
  }

  function requireNoActiveExecution(profileId: string): void {
    orchestrator.assertCanStart();
    if (sessionRepo.hasUnresolvedProfile(profileId)) {
      throw new Error('此方案存在重启后未确认归属的进程，请先人工核验并关闭遗留进程，再重开 CodeHelm；不会自动接管或重复启动。');
    }
    activeExecutions.assertAvailable(profileId);
  }

  handleExecutionRequest(IpcChannels.RUNNER_CONFIRM_EXECUTION, async (event, rawRequest, signal) => {
    const request = RunnerExecutionConfirmationRequestSchema.parse(rawRequest);
    const owner = BrowserWindow.fromWebContents(event.sender);
    if (!owner || owner.isDestroyed() || event.senderFrame !== event.sender.mainFrame) {
      throw new Error('执行确认必须来自应用主窗口。');
    }
    requireNoActiveExecution(request.profileId);
    const { profile, project, plans, approvalContext } = await getExecutionContext(request.profileId, request.mode, signal);
    assertCurrentSnapshot(profile, project, signal);
    requireNoActiveExecution(request.profileId);
    const approved = await showExecutionConfirmation(owner, {
      profile, projectRoot: project.rootPath, plans, mode: request.mode, theme: request.theme,
    });
    if (!approved) throw new Error('Execution confirmation cancelled.');
    requireNoActiveExecution(request.profileId);
    // Review and execution must describe the same main-process snapshot.
    const checked = await getExecutionContext(request.profileId, request.mode, signal);
    assertCurrentSnapshot(checked.profile, checked.project, signal);
    requireNoActiveExecution(request.profileId);
    const current = checked.approvalContext;
    if (current.configurationFingerprint !== approvalContext.configurationFingerprint
      || current.executionFingerprint !== approvalContext.executionFingerprint) {
      throw new Error('Execution confirmation required: 执行内容已变化，请重新核对后启动。');
    }
    return executionApprovals.confirm(approvalContext);
  });

  handleExecutionRequest(IpcChannels.RUNNER_REUSE_EXECUTION_APPROVAL, async (_event, rawRequest, signal) => {
    const request = RunnerExecutionConfirmationRequestSchema.parse(rawRequest);
    requireNoActiveExecution(request.profileId);
    const { profile, project, approvalContext } = await getExecutionContext(request.profileId, 'start', signal);
    assertCurrentSnapshot(profile, project, signal);
    requireNoActiveExecution(request.profileId);
    if (request.mode === 'install') {
      return executionApprovals.reuseConfiguration(
        profile.id,
        request.mode,
        approvalContext.configurationFingerprint
      );
    }
    return executionApprovals.reuse(approvalContext);
  });

  handleExecutionRequest(IpcChannels.RUNNER_START_SESSION, async (_event, rawRequest, signal) => {
    const request = RunnerExecutionRequestSchema.parse(rawRequest);
    requireExecutionSlot(request.profileId);
    try {
      const { profile, project, approvalContext } = await getExecutionContext(request.profileId, 'start', signal);
      assertCurrentSnapshot(profile, project, signal);
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
  handleExecutionRequest(IpcChannels.RUNNER_INSTALL_AND_START, async (_event, rawRequest, signal) => {
    const request = RunnerExecutionRequestSchema.parse(rawRequest);
    requireExecutionSlot(request.profileId);
    try {
      const { profile, project } = await reconcileProfile(request.profileId, signal);
      const configurationFingerprint = await createExecutionConfigurationFingerprint(
        profile,
        project.rootPath,
        { signal }
      );
      assertCurrentSnapshot(profile, project, signal);
      executionApprovals.assertConfiguration(request.approvalToken, {
        profileId: profile.id,
        mode: 'install',
        configurationFingerprint,
      });

      // Only an already issued, profile-bound token may trigger the runtime
      // checks below. In particular, inferred Python checks can spawn a
      // local interpreter and must not happen for an unapproved request.
      const plans = createDependencyInstallPlans(project.rootPath, profile.services);
      const { approvalContext } = await buildExecutionContext(profile, project, 'install', plans, signal);
      assertCurrentSnapshot(profile, project, signal);
      executionApprovals.consume(approvalContext, request.approvalToken);

      for (const plan of plans) {
        signal.throwIfAborted();
        await runDependencyPlan(plan);
      }
      if (plans.length > 0) {
        broadcastLog('CodeHelm Installer', '[Dependency] 所有缺失依赖已安装，准备拉起服务。\n');
      }

      // Now start the session
      signal.throwIfAborted();
      if (runnerShutdownRequested) throw new Error('Runner shutdown in progress');
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

  handle(IpcChannels.RUNNER_STOP_SESSION, async (_event, sessionId: string) => {
    await orchestrator.stopSession(sessionId);
    return { success: true };
  });

  handle(IpcChannels.RUNNER_STOP_SERVICE, async (_event, serviceSessionId: string) => {
    await orchestrator.stopService(serviceSessionId);
    return { success: true };
  });

  handle(IpcChannels.RUNNER_RESTART_SERVICE, async (_event, serviceSessionId: string) => {
    const newSession = await orchestrator.restartService(serviceSessionId);
    if (newSession.status !== 'RUNNING') {
      throw new Error(newSession.errorMessage || `服务重启未完成：${newSession.status}`);
    }
    return ServiceSessionDtoSchema.parse(newSession);
  });
}
