import { StringDecoder } from 'node:string_decoder';

/** Exact configured secrets, including values split across UTF-8/output chunks. */
export class SecretRedactor {
  private decoder = new StringDecoder('utf8');
  private pending = '';
  private ended = false;
  private readonly secrets: string[];

  constructor(secrets: string[]) {
    this.secrets = [...new Set(secrets.filter(Boolean))].sort((a, b) => b.length - a.length);
  }

  write(chunk: Buffer): string {
    if (this.ended) return '';
    this.pending += this.decoder.write(chunk);
    return this.consume(false);
  }

  end(): string {
    if (this.ended) return '';
    this.ended = true;
    this.pending += this.decoder.end();
    return this.consume(true);
  }

  private consume(final: boolean): string {
    if (this.secrets.length === 0) {
      const text = this.pending;
      this.pending = '';
      return text;
    }
    const output: string[] = [];
    let i = 0;
    while (i < this.pending.length) {
      const match = this.secrets.find((secret) => this.pending.startsWith(secret, i));
      if (match) {
        output.push('[REDACTED]');
        i += match.length;
      } else if (this.secrets.some((secret) => secret.length > this.pending.length - i && secret.startsWith(this.pending.slice(i)))) {
        if (final) { output.push('[REDACTED]'); i = this.pending.length; }
        break;
      } else {
        output.push(this.pending[i++]);
      }
    }
    this.pending = this.pending.slice(i);
    return output.join('');
  }
}
