import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosProxyConfig, AxiosResponse } from 'axios';
import { AmazonCurlFallbackClient } from './amazon-curl-fallback.client';
import { sleep } from '../../shared/utils/normalizers';

export type AmazonBlockReason = 'SIGN_IN' | 'CHALLENGE';

@Injectable()
export class AmazonHttpClient {
  private readonly logger = new Logger(AmazonHttpClient.name);
  private readonly axiosClient: AxiosInstance;
  private readonly retryCount: number;
  private readonly minRequestDelayMs: number;
  private readonly maxRequestDelayMs: number;
  private readonly authCookie?: string;
  private readonly proxyUrls: string[];
  private proxyCursor = 0;

  private readonly userAgents = [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  ];

  constructor(
    private readonly configService: ConfigService,
    private readonly curlFallbackClient: AmazonCurlFallbackClient,
  ) {
    const timeout = this.configService.get<number>(
      'amazon.requestTimeoutMs',
      15000,
    );

    this.retryCount = this.configService.get<number>('amazon.retryCount', 4);
    this.minRequestDelayMs = this.configService.get<number>(
      'amazon.minRequestDelayMs',
      1000,
    );
    this.maxRequestDelayMs = this.configService.get<number>(
      'amazon.maxRequestDelayMs',
      2500,
    );
    this.authCookie = this.configService.get<string | undefined>(
      'amazon.authCookie',
    );
    this.proxyUrls = this.configService.get<string[]>(
      'amazon.proxyUrls',
      [],
    );

    this.axiosClient = axios.create({
      timeout,
      maxRedirects: 5,
      validateStatus: () => true,
    });
  }

  async getHtml(url: string): Promise<string> {
    this.assertValidHttpUrl(url);
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.retryCount + 1; attempt += 1) {
      await sleep(this.randomDelay());
      const headers = this.buildHeaders();
      const proxyUrl = this.pickProxyUrl();

      try {
        const response = await this.axiosClient.get<string>(url, {
          headers,
          proxy: this.toAxiosProxy(proxyUrl),
          responseType: 'text',
        });
        const effectiveUrl = this.extractEffectiveUrl(response);

        if (this.isSignInRedirectUrl(effectiveUrl)) {
          const message = this.authCookie
            ? `Amazon redirected to sign-in page (cookie might be expired): source=${url}, redirected=${effectiveUrl}`
            : `Amazon redirected to sign-in page (authorization required): source=${url}, redirected=${effectiveUrl}`;
          this.logger.warn(message);
          lastError = new Error(message);
          break;
        }

        if (response.status >= 200 && response.status < 300) {
          if (this.isSignInPage(response.data)) {
            const message = `Amazon sign-in page received (authorization required): ${url}`;
            this.logger.warn(message);
            lastError = new Error(message);
            break;
          }

          if (this.isAntiBotPage(response.data)) {
            const message = `Amazon anti-bot challenge page received: ${url}`;
            lastError = new Error(message);
            if (attempt > this.retryCount) {
              break;
            }

            this.logger.warn(`${message}. Retry attempt ${attempt}/${this.retryCount}`);
            await sleep(this.backoffDelay(attempt));
            continue;
          }

          return response.data;
        }

        const retryable = [403, 408, 429, 500, 502, 503, 504].includes(
          response.status,
        );
        const message = `Request failed (${response.status}) for ${url}. Body preview: ${String(response.data).slice(0, 300)}`;
        lastError = new Error(message);
        if (!retryable || attempt > this.retryCount) {
          break;
        }

        this.logger.warn(
          `Retryable status ${response.status} for ${url}. Attempt ${attempt}/${this.retryCount}`,
        );
        await sleep(this.backoffDelay(attempt));
      } catch (error) {
        if (this.isInvalidUrlError(error)) {
          throw new Error(
            `Invalid URL passed to AmazonHttpClient.getHtml: ${url}. Provide full URL with http/https.`,
          );
        }

        const requestError = this.toError(error);
        lastError = requestError;
        if (attempt > this.retryCount) {
          break;
        }

        this.logger.warn(
          `Network error for ${url}: ${requestError.message}. Retry attempt ${attempt}/${this.retryCount}`,
        );
        await sleep(this.backoffDelay(attempt));
      }
    }

    if (this.curlFallbackClient.isEnabled) {
      const fallbackHeaders = this.buildHeaders();
      const fallbackProxy = this.pickProxyUrl();
      const fallbackHtml = await this.curlFallbackClient.fetchHtml(
        url,
        fallbackHeaders,
        fallbackProxy,
      );
      if (
        fallbackHtml &&
        !this.isAntiBotPage(fallbackHtml) &&
        !this.isSignInPage(fallbackHtml)
      ) {
        this.logger.warn(`Fetched ${url} via curl fallback channel.`);
        return fallbackHtml;
      }

      if (fallbackHtml && this.isAntiBotPage(fallbackHtml)) {
        lastError = new Error(
          `curl fallback also received anti-bot challenge for ${url}`,
        );
      }

      if (fallbackHtml && this.isSignInPage(fallbackHtml)) {
        lastError = new Error(
          `curl fallback received sign-in page (authorization required) for ${url}`,
        );
      }
    }

    throw (
      lastError ?? new Error(`Unable to fetch URL after retries: ${url}`)
    );
  }

  detectBlockReason(html: string): AmazonBlockReason | null {
    if (this.isSignInPage(html)) {
      return 'SIGN_IN';
    }

    if (this.isAntiBotPage(html)) {
      return 'CHALLENGE';
    }

    return null;
  }

  classifyErrorMessage(message: string): AmazonBlockReason | null {
    const lower = message.toLowerCase();

    if (
      lower.includes('sign-in') ||
      lower.includes('authorization required') ||
      lower.includes('/ap/signin')
    ) {
      return 'SIGN_IN';
    }

    if (
      lower.includes('anti-bot') ||
      lower.includes('challenge') ||
      lower.includes('captcha') ||
      lower.includes('robot')
    ) {
      return 'CHALLENGE';
    }

    return null;
  }

  private buildHeaders(): Record<string, string> {
    const userAgent =
      this.userAgents[Math.floor(Math.random() * this.userAgents.length)];

    const headers: Record<string, string> = {
      'User-Agent': userAgent,
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
      Connection: 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
    };

    if (this.authCookie) {
      headers.Cookie = this.authCookie;
    }

    return headers;
  }

  private randomDelay(): number {
    if (this.maxRequestDelayMs <= this.minRequestDelayMs) {
      return this.minRequestDelayMs;
    }

    return (
      this.minRequestDelayMs +
      Math.floor(
        Math.random() * (this.maxRequestDelayMs - this.minRequestDelayMs + 1),
      )
    );
  }

  private backoffDelay(attempt: number): number {
    const exponential = 500 * 2 ** (attempt - 1);
    const jitter = Math.floor(Math.random() * 250);
    return exponential + jitter;
  }

  private isAntiBotPage(html: string): boolean {
    const lower = html.toLowerCase();
    return (
      lower.includes('api-services-support@amazon.com') ||
      lower.includes('<title>sorry! something went wrong!</title>') ||
      lower.includes('enter the characters you see below') ||
      lower.includes('to discuss automated access to amazon data please contact') ||
      lower.includes('sorry, we just need to make sure you\'re not a robot') ||
      lower.includes('type the characters you see in this image') ||
      lower.includes('captcha') ||
      lower.includes('robot check')
    );
  }

  private isSignInPage(html: string): boolean {
    const lower = html.toLowerCase();
    return (
      (lower.includes('/ap/signin') &&
        lower.includes('amazon sign-in')) ||
      lower.includes('ap_signin_form') ||
      lower.includes('authportal-main-section') ||
      lower.includes('enter your email or mobile phone number') ||
      lower.includes('enter your mobile number or email') ||
      lower.includes('enter the characters as they are shown in the image') ||
      (lower.includes('amazon sign in') && lower.includes('name=\"password\"'))
    );
  }

  private toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
  }

  private isInvalidUrlError(error: unknown): boolean {
    if (error && typeof error === 'object' && 'code' in error) {
      const code = (error as { code?: unknown }).code;
      if (code === 'ERR_INVALID_URL') {
        return true;
      }
    }

    const message = this.toError(error).message.toLowerCase();
    return message.includes('invalid url');
  }

  private extractEffectiveUrl(response: AxiosResponse<string>): string | undefined {
    const rawRequest = response.request as
      | { res?: { responseUrl?: string } }
      | undefined;

    return rawRequest?.res?.responseUrl;
  }

  private isSignInRedirectUrl(url: string | undefined): boolean {
    if (!url) {
      return false;
    }

    const lower = url.toLowerCase();
    return (
      lower.includes('/ap/signin') ||
      lower.includes('/gp/sign-in.html') ||
      lower.includes('/ap/register')
    );
  }

  private pickProxyUrl(): string | undefined {
    if (this.proxyUrls.length === 0) {
      return undefined;
    }

    const proxyUrl = this.proxyUrls[this.proxyCursor % this.proxyUrls.length];
    this.proxyCursor += 1;
    return proxyUrl;
  }

  private toAxiosProxy(proxyUrl: string | undefined): AxiosProxyConfig | undefined {
    if (!proxyUrl) {
      return undefined;
    }

    try {
      const parsed = new URL(proxyUrl);
      const protocol = parsed.protocol.replace(':', '').toLowerCase();
      if (protocol === 'socks5' || protocol === 'socks4') {
        this.logger.warn(
          `SOCKS proxy is not supported by axios native proxy config: ${proxyUrl}`,
        );
        return undefined;
      }

      const port = parsed.port
        ? Number.parseInt(parsed.port, 10)
        : protocol === 'https'
          ? 443
          : 80;
      const proxy: AxiosProxyConfig = {
        protocol,
        host: parsed.hostname,
        port,
      };

      if (parsed.username || parsed.password) {
        proxy.auth = {
          username: decodeURIComponent(parsed.username),
          password: decodeURIComponent(parsed.password),
        };
      }

      return proxy;
    } catch {
      this.logger.warn(`Invalid proxy URL ignored: ${proxyUrl}`);
      return undefined;
    }
  }

  private assertValidHttpUrl(url: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(
        `Invalid URL passed to AmazonHttpClient.getHtml: ${url}. Provide full URL with http/https.`,
      );
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(
        `Unsupported protocol in URL passed to AmazonHttpClient.getHtml: ${url}`,
      );
    }
  }
}
