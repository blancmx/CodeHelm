import { ENVIRONMENT_PREFLIGHT_ERROR } from '@codehelm/contracts';

/** Strip CodeHelm transport/routing markers; retain the actual failure reason. */
export function displayIpcError(error: unknown, fallback: string): string {
  let message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const wrapper = /^Error invoking remote method ['"]codehelm:[^'"\r\n]+['"]: (?:Error: )?/;
  while (wrapper.test(message)) message = message.replace(wrapper, '');
  if (message.startsWith(`${ENVIRONMENT_PREFLIGHT_ERROR}: `)) message = message.slice(ENVIRONMENT_PREFLIGHT_ERROR.length + 2);
  return message.trim() || fallback;
}
