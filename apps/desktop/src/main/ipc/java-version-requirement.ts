import { parseDiagnosticXml } from '@codehelm/analyzer';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Unsupported XML structure');
  return value as Record<string, unknown>;
}
const list = (value: unknown): unknown[] => value === undefined ? [] : Array.isArray(value) ? value : [value];

// Read only one explicit local enforce execution. No effective-POM evaluation.
export function readJavaRequirement(text: string): unknown {
  const project = object(object(parseDiagnosticXml(text)).project);
  if (project.parent !== undefined || project.profiles !== undefined) throw new Error('Inherited or conditional POM');
  if (project.build === undefined) return undefined;
  const build = object(project.build);
  if (build.pluginManagement !== undefined) throw new Error('Managed plugin configuration');
  if (build.plugins === undefined) return undefined;
  const plugins = list(object(build.plugins).plugin).map(object).filter(plugin => plugin.artifactId === 'maven-enforcer-plugin');
  if (!plugins.length) return undefined;
  if (plugins.length !== 1) throw new Error('Multiple enforcer plugins');
  const plugin = plugins[0];
  if (plugin.groupId !== undefined && plugin.groupId !== 'org.apache.maven.plugins') throw new Error('Different plugin');
  if (plugin.configuration !== undefined) throw new Error('Merged configuration unsupported');
  if (plugin.executions === undefined) return undefined;
  const executions = list(object(plugin.executions).execution);
  if (executions.length !== 1) throw new Error('Multiple executions');
  const execution = object(executions[0]);
  const goals = list(object(execution.goals).goal);
  if (goals.length !== 1 || goals[0] !== 'enforce') throw new Error('Uncertain execution');
  if (execution.phase !== undefined && execution.phase !== 'validate') throw new Error('Conditional lifecycle');
  const configuration = object(execution.configuration);
  if (Object.keys(configuration).some(key => key !== 'rules')) throw new Error('Enforcer options unsupported');
  const rules = object(configuration.rules);
  if (rules.requireJavaVersion === undefined) return undefined;
  const rule = object(rules.requireJavaVersion);
  if (Object.keys(rule).some(key => key !== 'version' && key !== 'message')) throw new Error('Custom rule options');
  return rule.version;
}

export function parseJavaRequirement(value: unknown): ((actual: string) => boolean | null) | null {
  if (typeof value !== 'string' || value.length > 64) return null;
  const input = value.trim();
  const major = '(?:9|[1-9]\\d{1,3})';
  let lower: number | undefined;
  let upper: number | undefined;
  let lowerInclusive = true;
  let upperInclusive = true;
  if (new RegExp(`^${major}$`).test(input)) lower = Number(input);
  else {
    const exact = new RegExp(`^\\[(${major})\\]$`).exec(input);
    const range = new RegExp(`^([[(])(${major})?,(${major})?([)\\]])$`).exec(input);
    if (exact) { lower = upper = Number(exact[1]); }
    else if (range) {
      lower = range[2] ? Number(range[2]) : undefined;
      upper = range[3] ? Number(range[3]) : undefined;
      lowerInclusive = range[1] === '[';
      upperInclusive = range[4] === ']';
      if ((lower === undefined && (lowerInclusive || upper === undefined)) || (upper === undefined && upperInclusive)) return null;
      if (lower !== undefined && upper !== undefined && (lower > upper || (lower === upper && (!lowerInclusive || !upperInclusive)))) return null;
    } else return null;
  }
  return actual => {
    // Include the fourth (emergency patch) component; retain integer-bound semantics.
    // [21] means 21.0.0.0, not all 21.x. Pre-release/build suffixes stay unsupported.
    if (!/^(?:9|[1-9]\d{1,3})(?:\.\d{1,8}){0,3}$/.test(actual)) return null;
    const parts = actual.split('.').map(Number);
    const feature = parts[0];
    const nonZeroTail = parts.slice(1).some(part => part > 0);
    const compare = (bound: number) => feature - bound || (nonZeroTail ? 1 : 0);
    return (lower === undefined || (lowerInclusive ? compare(lower) >= 0 : compare(lower) > 0))
      && (upper === undefined || (upperInclusive ? compare(upper) <= 0 : compare(upper) < 0));
  };
}
