import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

export class HealthChecker {
  /**
   * Checks whether a TCP port is currently occupied by trying to bind to it.
   */
  static async checkPortInUse(port: number, host: string = '127.0.0.1'): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.unref();

      server.on('error', () => {
        resolve(true); // Port in use
      });

      server.listen(port, host, () => {
        server.close(() => {
          resolve(false); // Port available
        });
      });
    });
  }

  /**
   * Polls until a TCP port accepts connections (server is ready) or timeout expires.
   */
  static async waitForPortOpen(
    port: number,
    timeoutMs: number = 10000,
    intervalMs: number = 200,
    host?: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const startTime = Date.now();
    const hosts = host ? [host] : ['127.0.0.1', '::1'];

    while (!signal?.aborted && Date.now() - startTime < timeoutMs) {
      const attempts = await Promise.all(hosts.map((candidateHost) => (
        new Promise<boolean>((resolve) => {
          const socket = new net.Socket();
          let settled = false;
          const finish = (open: boolean) => {
            if (settled) return;
            settled = true;
            signal?.removeEventListener('abort', onAbort);
            socket.destroy();
            resolve(open);
          };
          const onAbort = () => finish(false);
          signal?.addEventListener('abort', onAbort, { once: true });
          if (signal?.aborted) { finish(false); return; }
          socket.setTimeout(500);
          socket.once('connect', () => finish(true));
          socket.once('timeout', () => finish(false));
          socket.once('error', () => finish(false));
          socket.connect(port, candidateHost);
        })
      )));
      const isOpen = attempts.some(Boolean);

      if (isOpen && !signal?.aborted) {
        return true;
      }

      await delay(intervalMs, undefined, { signal }).catch(() => {});
    }

    return false;
  }

  /**
   * Polls an HTTP endpoint until the expected HTTP status is received or timeout expires.
   */
  static async waitForHttp(
    url: string,
    expectedStatus: number = 200,
    timeoutMs: number = 10000,
    intervalMs: number = 300,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const startTime = Date.now();

    while (!signal?.aborted && Date.now() - startTime < timeoutMs) {
      try {
        const timeout = AbortSignal.timeout(Math.max(1, timeoutMs - (Date.now() - startTime)));
        const requestSignal = AbortSignal.any([timeout, AbortSignal.timeout(1000), ...(signal ? [signal] : [])]);
        const res = await fetch(url, { method: 'GET', signal: requestSignal });
        const ready = res.status === expectedStatus || (expectedStatus === 200 && res.status < 400);
        await res.body?.cancel();
        if (ready && !signal?.aborted) {
          return true;
        }
      } catch {
        // Not ready yet
      }

      await delay(intervalMs, undefined, { signal }).catch(() => {});
    }

    return false;
  }
}
