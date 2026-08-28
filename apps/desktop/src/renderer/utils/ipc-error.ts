/** Strip only Electron's CodeHelm transport wrapper; retain the actual failure reason. */
export function displayIpcError(error: unknown, fallback: string): string {
  let message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const wrapper = /^Error invoking remote method ['"]codehelm:[^'"\r\n]+['"]: (?:Error: )?/;
  while (wrapper.test(message)) message = message.replace(wrapper, '');
  return message.trim() || fallback;
}
