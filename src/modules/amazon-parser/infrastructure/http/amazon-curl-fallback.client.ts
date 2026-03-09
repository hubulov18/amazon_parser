import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const execFileAsync = promisify(execFile);

@Injectable()
export class AmazonCurlFallbackClient {
  private readonly logger = new Logger(AmazonCurlFallbackClient.name);
  private readonly enabled: boolean;
  private readonly timeoutMs: number;
  private readonly cookieJarPath: string;

  constructor(private readonly configService: ConfigService) {
    this.enabled = this.configService.get<boolean>(
      'amazon.enableCurlFallback',
      true,
    );
    this.timeoutMs = this.configService.get<number>(
      'amazon.curlFallbackTimeoutMs',
      30000,
    );

    this.cookieJarPath = join(
      tmpdir(),
      `amazon-curl-fallback-${process.pid}-${randomUUID()}.txt`,
    );
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  async fetchHtml(
    url: string,
    requestHeaders: Record<string, string>,
    proxyUrl?: string,
  ): Promise<string | null> {
    if (!this.enabled) {
      return null;
    }

    const timeoutSeconds = Math.max(5, Math.ceil(this.timeoutMs / 1000));
    const args = [
      '-sS',
      '-L',
      '--compressed',
      '--http1.1',
      '--max-time',
      String(timeoutSeconds),
      '--connect-timeout',
      '10',
      '--retry',
      '1',
      '--retry-delay',
      '1',
      '--retry-all-errors',
      '--cookie',
      this.cookieJarPath,
      '--cookie-jar',
      this.cookieJarPath,
      '-A',
      requestHeaders['User-Agent'],
      '-H',
      `Accept: ${requestHeaders.Accept}`,
      '-H',
      `Accept-Language: ${requestHeaders['Accept-Language']}`,
      '-H',
      `Cache-Control: ${requestHeaders['Cache-Control']}`,
      '-H',
      `Pragma: ${requestHeaders.Pragma}`,
      '-H',
      `Connection: ${requestHeaders.Connection}`,
      '-H',
      `Upgrade-Insecure-Requests: ${requestHeaders['Upgrade-Insecure-Requests']}`,
      url,
    ];

    if (requestHeaders.Cookie) {
      args.splice(args.length - 1, 0, '-H', `Cookie: ${requestHeaders.Cookie}`);
    }

    if (proxyUrl) {
      args.splice(args.length - 1, 0, '--proxy', proxyUrl);
    }

    try {
      const { stdout } = await execFileAsync('curl', args, {
        timeout: this.timeoutMs + 5000,
        maxBuffer: 10 * 1024 * 1024,
      });

      const html = String(stdout ?? '');
      if (!html.trim()) {
        this.logger.warn(
          `curl fallback returned empty response for ${url}`,
        );
        return null;
      }

      return html;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`curl fallback failed for ${url}: ${message}`);
      return null;
    }
  }
}
