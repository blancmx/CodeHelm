import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { RunnerExecutionMode } from '@codehelm/contracts';
import type { RunProfile } from '@codehelm/domain';
import { safeResolvePath } from '@codehelm/shared';
import type { DependencyInstallPlan } from './dependency-installer.js';

export const EXECUTION_CONFIRMATION_REQUIRED_MESSAGE =
  'Execution confirmation required or expired. Review the current run profile and confirm before starting.';
export const EXECUTION_ALREADY_IN_PROGRESS_MESSAGE =
  'A run is already in progress for this profile.';

const DEFAULT_APPROVAL_TTL_MS = 5 * 60 * 1000;
const DEPENDENCY_INPUT_FILENAMES = [
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'requirements.txt',
];
const EXECUTION_INPUT_EXTENSIONS = new Set([
  '.bat', '.cmd', '.cjs', '.exe', '.groovy', '.ini', '.java', '.js', '.json',
  '.kt', '.kts', '.mjs', '.py', '.ps1', '.properties', '.sh', '.toml', '.ts',
  '.tsx', '.yml', '.yaml',
]);

export interface ExecutionApprovalContext {
  profileId: string;
  mode: RunnerExecutionMode;
  configurationFingerprint: string;
  executionFingerprint: string;
}

interface ApprovalRecord {
  configurationFingerprint: string;
  executions: Map<RunnerExecutionMode, ExecutionApprovalContext>;
}

interface IssuedApproval {
  context: ExecutionApprovalContext;
  expiresAt: number;
}

interface ExecutionApprovalGuardOptions {
  now?: () => number;
  tokenFactory?: () => string;
  ttlMs?: number;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }
  return value;
}

function fingerprint(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function executionProfile(profile: RunProfile) {
  return {
    id: profile.id,
    projectId: profile.projectId,
    failurePolicy: profile.failurePolicy,
    services: profile.services,
  };
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function addInputPath(inputPaths: Set<string>, projectRoot: string, candidate: string): void {
  try {
    const absolute = safeResolvePath(projectRoot, candidate);
    if (isInside(projectRoot, absolute)) inputPaths.add(absolute);
  } catch {
    // Inputs that cross a physical symlink boundary are not approval inputs.
  }
}

function addServiceReference(
  inputPaths: Set<string>,
  projectRoot: string,
  serviceRoot: string,
  reference: string
): void {
  if (!reference || reference.startsWith('-')) return;
  const hasPath = reference.includes('/') || reference.includes('\\');
  if (!hasPath && !EXECUTION_INPUT_EXTENSIONS.has(path.extname(reference).toLowerCase())) return;
  addInputPath(inputPaths, projectRoot, path.resolve(serviceRoot, reference));
}

function executionInputPaths(
  profile: RunProfile,
  projectRoot: string,
  plans: DependencyInstallPlan[]
): string[] {
  const inputPaths = new Set<string>();
  for (const service of profile.services.filter((entry) => entry.enabled)) {
    let serviceRoot: string;
    try {
      serviceRoot = safeResolvePath(
        projectRoot,
        service.cwdRelative || service.moduleRelativePath || '.'
      );
    } catch {
      continue;
    }
    if (!isInside(projectRoot, serviceRoot)) continue;
    for (const filename of DEPENDENCY_INPUT_FILENAMES) {
      addInputPath(inputPaths, projectRoot, path.join(serviceRoot, filename));
    }
    addServiceReference(inputPaths, projectRoot, serviceRoot, service.executable);
    for (const argument of service.args) {
      addServiceReference(inputPaths, projectRoot, serviceRoot, argument);
    }
  }

  for (const plan of plans) {
    let planRoot: string;
    try {
      planRoot = safeResolvePath(projectRoot, plan.cwd);
    } catch {
      continue;
    }
    if (!isInside(projectRoot, planRoot)) continue;
    for (const filename of DEPENDENCY_INPUT_FILENAMES) {
      addInputPath(inputPaths, projectRoot, path.join(planRoot, filename));
    }
  }

  return [...inputPaths].sort((left, right) => left.localeCompare(right));
}

function executionInputFingerprints(
  profile: RunProfile,
  projectRoot: string,
  plans: DependencyInstallPlan[]
) {
  const normalizedRoot = path.normalize(path.resolve(projectRoot));
  return executionInputPaths(profile, normalizedRoot, plans).map((file) => {
    let digest = 'missing';
    try {
      const stat = fs.statSync(file);
      if (stat.isFile()) {
        digest = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      }
    } catch {
      digest = 'unreadable';
    }
    return {
      path: path.relative(normalizedRoot, file).replace(/\\/g, '/'),
      sha256: digest,
    };
  });
}

export function createExecutionConfigurationFingerprint(
  profile: RunProfile,
  projectRoot: string
): string {
  return fingerprint({
    projectRoot: path.normalize(path.resolve(projectRoot)),
    profile: executionProfile(profile),
    inputFiles: executionInputFingerprints(profile, projectRoot, []),
  });
}

export function createExecutionFingerprint(
  profile: RunProfile,
  projectRoot: string,
  mode: RunnerExecutionMode,
  plans: DependencyInstallPlan[]
): string {
  return fingerprint({
    configurationFingerprint: createExecutionConfigurationFingerprint(profile, projectRoot),
    mode,
    plans,
    inputFiles: executionInputFingerprints(profile, projectRoot, plans),
  });
}

function sameContext(left: ExecutionApprovalContext, right: ExecutionApprovalContext): boolean {
  return left.profileId === right.profileId
    && left.mode === right.mode
    && left.configurationFingerprint === right.configurationFingerprint
    && left.executionFingerprint === right.executionFingerprint;
}

export class ExecutionApprovalGuard {
  private readonly approvals = new Map<string, ApprovalRecord>();
  private readonly issuedApprovals = new Map<string, IssuedApproval>();
  private readonly now: () => number;
  private readonly tokenFactory: () => string;
  private readonly ttlMs: number;

  constructor(options: ExecutionApprovalGuardOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.tokenFactory = options.tokenFactory
      ?? (() => randomBytes(32).toString('base64url'));
    this.ttlMs = options.ttlMs ?? DEFAULT_APPROVAL_TTL_MS;
  }

  confirm(context: ExecutionApprovalContext): string {
    this.pruneExpiredApprovals();
    const previous = this.approvals.get(context.profileId);
    if (!previous || previous.configurationFingerprint !== context.configurationFingerprint) {
      this.approvals.set(context.profileId, {
        configurationFingerprint: context.configurationFingerprint,
        executions: new Map([[context.mode, context]]),
      });
    } else {
      previous.executions.set(context.mode, context);
    }

    this.invalidateIssuedApprovals(context.profileId);
    return this.issue(context);
  }

  reuse(context: ExecutionApprovalContext): string {
    this.pruneExpiredApprovals();
    const approval = this.approvals.get(context.profileId);
    const approvedExecution = approval?.executions.get(context.mode);
    if (
      !approval
      || approval.configurationFingerprint !== context.configurationFingerprint
      || !approvedExecution
      || !sameContext(approvedExecution, context)
    ) {
      if (approval && approval.configurationFingerprint !== context.configurationFingerprint) {
        this.approvals.delete(context.profileId);
        this.invalidateIssuedApprovals(context.profileId);
      }
      throw new Error(EXECUTION_CONFIRMATION_REQUIRED_MESSAGE);
    }
    return this.issue(context);
  }

  reuseConfiguration(
    profileId: string,
    mode: RunnerExecutionMode,
    configurationFingerprint: string
  ): string {
    this.pruneExpiredApprovals();
    const approval = this.approvals.get(profileId);
    const approvedExecution = approval?.executions.get(mode);
    if (
      !approval
      || approval.configurationFingerprint !== configurationFingerprint
      || !approvedExecution
    ) {
      if (approval && approval.configurationFingerprint !== configurationFingerprint) {
        this.approvals.delete(profileId);
        this.invalidateIssuedApprovals(profileId);
      }
      throw new Error(EXECUTION_CONFIRMATION_REQUIRED_MESSAGE);
    }
    return this.issue(approvedExecution);
  }

  assertConfiguration(
    token: string,
    expected: Pick<ExecutionApprovalContext, 'profileId' | 'mode' | 'configurationFingerprint'>
  ): void {
    this.pruneExpiredApprovals();
    const issued = this.issuedApprovals.get(token);
    const approval = this.approvals.get(expected.profileId);
    const approvedExecution = approval?.executions.get(expected.mode);
    if (
      !issued
      || issued.context.profileId !== expected.profileId
      || issued.context.mode !== expected.mode
      || issued.context.configurationFingerprint !== expected.configurationFingerprint
      || !approval
      || approval.configurationFingerprint !== expected.configurationFingerprint
      || !approvedExecution
      || !sameContext(approvedExecution, issued.context)
    ) {
      if (approval?.configurationFingerprint !== expected.configurationFingerprint) {
        this.approvals.delete(expected.profileId);
        this.invalidateIssuedApprovals(expected.profileId);
      }
      if (issued) this.issuedApprovals.delete(token);
      throw new Error(EXECUTION_CONFIRMATION_REQUIRED_MESSAGE);
    }
  }

  consume(context: ExecutionApprovalContext, token: string): void {
    this.pruneExpiredApprovals();
    const issued = this.issuedApprovals.get(token);
    if (!issued) {
      throw new Error(EXECUTION_CONFIRMATION_REQUIRED_MESSAGE);
    }

    const approval = this.approvals.get(context.profileId);
    const approvedExecution = approval?.executions.get(context.mode);
    if (
      !approval
      || approval.configurationFingerprint !== context.configurationFingerprint
      || !approvedExecution
      || !sameContext(approvedExecution, context)
    ) {
      if (approval?.configurationFingerprint !== context.configurationFingerprint) {
        this.approvals.delete(context.profileId);
        this.invalidateIssuedApprovals(context.profileId);
      }
      this.issuedApprovals.delete(token);
      throw new Error(EXECUTION_CONFIRMATION_REQUIRED_MESSAGE);
    }

    if (!sameContext(issued.context, context)) {
      this.issuedApprovals.delete(token);
      throw new Error(EXECUTION_CONFIRMATION_REQUIRED_MESSAGE);
    }

    this.issuedApprovals.delete(token);
  }

  private issue(context: ExecutionApprovalContext): string {
    let token = this.tokenFactory();
    for (let attempt = 0; this.issuedApprovals.has(token) && attempt < 10; attempt += 1) {
      token = this.tokenFactory();
    }
    if (this.issuedApprovals.has(token)) {
      throw new Error('Unable to issue a unique execution approval token.');
    }

    this.issuedApprovals.set(token, {
      context,
      expiresAt: this.now() + this.ttlMs,
    });
    return token;
  }

  private invalidateIssuedApprovals(profileId: string): void {
    for (const [token, issued] of this.issuedApprovals.entries()) {
      if (issued.context.profileId === profileId) this.issuedApprovals.delete(token);
    }
  }

  private pruneExpiredApprovals(): void {
    const now = this.now();
    for (const [token, issued] of this.issuedApprovals.entries()) {
      if (issued.expiresAt <= now) this.issuedApprovals.delete(token);
    }
  }
}

export class ExecutionSlotGuard {
  private readonly activeProfiles = new Set<string>();

  acquire(profileId: string): void {
    if (this.activeProfiles.has(profileId)) {
      throw new Error(EXECUTION_ALREADY_IN_PROGRESS_MESSAGE);
    }
    this.activeProfiles.add(profileId);
  }

  assertAvailable(profileId: string): void {
    if (this.activeProfiles.has(profileId)) {
      throw new Error(EXECUTION_ALREADY_IN_PROGRESS_MESSAGE);
    }
  }

  release(profileId: string): void {
    this.activeProfiles.delete(profileId);
  }
}
