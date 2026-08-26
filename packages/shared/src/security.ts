export interface EnvVarItem {
  key: string;
  value: string;
  isSecret?: boolean;
}

export function maskSecretValue(value: string): string {
  if (!value) return '';
  if (value.length <= 4) return '••••';
  if (value.length <= 8) return `${value.slice(0, 1)}••••${value.slice(-1)}`;
  return `${value.slice(0, 2)}••••••••${value.slice(-2)}`;
}

export function sanitizeEnvVars<T extends EnvVarItem>(vars: T[]): T[] {
  return vars.map((v) => {
    if (v.isSecret) {
      return {
        ...v,
        value: maskSecretValue(v.value),
      };
    }
    return { ...v };
  });
}
