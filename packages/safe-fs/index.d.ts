export function openRoot(rootPath: string, maxDirectories: number): string;
export function closeRoot(sessionId: string): void;
export function readFile(sessionId: string, relativePath: string, maxBytes: number): Buffer;
export function fileExists(sessionId: string, relativePath: string): boolean;
