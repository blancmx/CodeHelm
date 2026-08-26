import type { AnalysisSnapshot, ServiceConfig } from '@codehelm/domain';
import type { ProfileRepository } from '@codehelm/database';
import { generateId } from '@codehelm/shared';

export const AUTO_PROFILE_NAME = 'Default (Auto-Detected)';

export interface DetectedServicePortAllocator {
  allocate(
    projectId: string,
    services: ServiceConfig[],
    existingServices?: ServiceConfig[]
  ): Promise<ServiceConfig[]>;
}

function inferSimpleFrontendDependency(services: ServiceConfig[]): ServiceConfig[] {
  const enabledBackends = services.filter(
    (service) => service.enabled && service.type === 'backend'
  );
  if (enabledBackends.length !== 1) return services;

  const backendId = enabledBackends[0].id;
  return services.map((service) => (
    service.type === 'frontend' && service.dependsOn.length === 0
      ? { ...service, dependsOn: [backendId] }
      : service
  ));
}

export function buildDetectedServices(snapshot: AnalysisSnapshot): ServiceConfig[] {
  const services: ServiceConfig[] = [];
  const seen = new Set<string>();
  const runnableModulePaths = snapshot.modules
    .filter((module) => (module.suggestedCommands?.length ?? 0) > 0)
    .map((module) => module.relativePath);

  for (const module of snapshot.modules) {
    for (const command of module.suggestedCommands ?? []) {
      const prefix = module.relativePath === '.' ? '' : `${module.relativePath}/`;
      const hasRunnableChild = runnableModulePaths.some(
        (candidate) => candidate !== module.relativePath
          && (module.relativePath === '.' || candidate.startsWith(prefix))
      );
      // Workspace-level helper scripts commonly proxy into child apps. Prefer the
      // concrete child services so each one can receive its own runtime port.
      if (command.type === 'tool' && hasRunnableChild) continue;

      const key = `${module.relativePath}\u0000${command.executable}\u0000${command.args.join('\u0000')}`;
      if (seen.has(key)) continue;
      seen.add(key);

      services.push({
        id: generateId(),
        runProfileId: '',
        name: command.name,
        type: command.type,
        moduleRelativePath: module.relativePath,
        executable: command.executable,
        args: [...command.args],
        cwdRelative: module.relativePath === '.' ? '' : module.relativePath,
        env: [],
        port: command.port,
        dependsOn: [],
        enabled: true,
        source: 'detected',
        healthCheck: command.port
          ? { type: 'tcp', port: command.port }
          : undefined,
      });
    }
  }

  return inferSimpleFrontendDependency(services);
}

function serviceIdentity(service: ServiceConfig): string {
  return `${service.moduleRelativePath}\u0000${service.name}\u0000${service.type}`;
}

export function mergeDetectedServices(
  existingServices: ServiceConfig[],
  detectedServices: ServiceConfig[]
): ServiceConfig[] {
  const existingByIdentity = new Map(
    existingServices.map((service) => [serviceIdentity(service), service])
  );
  const merged = detectedServices.map((detected) => {
    const existing = existingByIdentity.get(serviceIdentity(detected));
    if (!existing) return detected;
    existingByIdentity.delete(serviceIdentity(detected));

    // Explicitly edited services belong to the user and are never overwritten.
    if (existing.source === 'manual') return existing;

    return {
      ...detected,
      id: existing.id,
      runProfileId: existing.runProfileId,
      enabled: existing.enabled,
    };
  });

  // Preserve manually added services that have no analyzer counterpart.
  for (const existing of existingByIdentity.values()) {
    if (existing.source === 'manual') merged.push(existing);
  }
  const validIds = new Set(merged.map((service) => service.id));
  const cleaned = merged.map((service) => ({
    ...service,
    dependsOn: service.dependsOn.filter((dependencyId) => validIds.has(dependencyId)),
  }));
  return inferSimpleFrontendDependency(cleaned);
}

export async function upsertAutoDetectedProfile(
  profileRepo: ProfileRepository,
  projectId: string,
  snapshot: AnalysisSnapshot,
  portAllocator?: DetectedServicePortAllocator
): Promise<void> {
  const profiles = profileRepo.findByProjectId(projectId);
  const autoProfile = profiles.find((profile) => profile.name === AUTO_PROFILE_NAME);

  // Never create a second default beside user-created profiles.
  if (!autoProfile && profiles.length > 0) return;

  let detectedServices = buildDetectedServices(snapshot);
  if (detectedServices.length === 0) return;
  if (portAllocator) {
    detectedServices = await portAllocator.allocate(
      projectId,
      detectedServices,
      autoProfile?.services ?? []
    );
  }
  const services = autoProfile
    ? mergeDetectedServices(autoProfile.services, detectedServices)
    : detectedServices;

  profileRepo.save({
    id: autoProfile?.id,
    projectId,
    name: AUTO_PROFILE_NAME,
    description: '自动基于模块级技术栈、真实脚本与入口文件生成的开发启动方案',
    isDefault: true,
    failurePolicy: 'block_dependents',
    services,
    userConfirmedAt: autoProfile?.userConfirmedAt,
  });
}
