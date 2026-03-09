import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { access, mkdir } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { AmazonHttpClient } from '../http/amazon-http.client';

type BrowserLike = {
  newContext: (options?: Record<string, unknown>) => Promise<BrowserContextLike>;
  close: () => Promise<void>;
};

type BrowserContextLike = {
  newPage: () => Promise<PageLike>;
  storageState: (options?: { path?: string }) => Promise<unknown>;
  close: () => Promise<void>;
};

type PageLike = {
  goto: (
    url: string,
    options?: { waitUntil?: 'domcontentloaded' | 'load'; timeout?: number },
  ) => Promise<unknown>;
  content: () => Promise<string>;
  waitForTimeout: (timeoutMs: number) => Promise<void>;
  waitForSelector: (
    selector: string,
    options?: { timeout?: number },
  ) => Promise<unknown>;
  fill: (selector: string, text: string) => Promise<void>;
  click: (selector: string) => Promise<void>;
  locator: (selector: string) => { count: () => Promise<number> };
};

type PlaywrightLike = {
  chromium: {
    launch: (options?: Record<string, unknown>) => Promise<BrowserLike>;
  };
};

@Injectable()
export class PlaywrightReviewClient implements OnModuleDestroy {
  private readonly logger = new Logger(PlaywrightReviewClient.name);
  private readonly enabled: boolean;
  private readonly headless: boolean;
  private readonly navTimeoutMs: number;
  private readonly renderWaitMs: number;
  private readonly autoLogin: boolean;
  private readonly loginUrl: string;
  private readonly loginEmail?: string;
  private readonly loginPassword?: string;
  private readonly storageStatePath: string;
  private readonly resolvedStorageStatePath: string;

  private browserPromise: Promise<BrowserLike> | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpClient: AmazonHttpClient,
  ) {
    const reviewFetchMode = (
      this.configService.get<string>('amazon.reviewFetchMode', 'http') ?? 'http'
    )
      .trim()
      .toLowerCase();

    this.enabled = reviewFetchMode === 'playwright';
    this.headless = this.configService.get<boolean>(
      'amazon.playwrightHeadless',
      true,
    );
    this.navTimeoutMs = this.configService.get<number>(
      'amazon.playwrightNavTimeoutMs',
      45000,
    );
    this.renderWaitMs = this.configService.get<number>(
      'amazon.playwrightRenderWaitMs',
      1200,
    );
    this.autoLogin = this.configService.get<boolean>(
      'amazon.playwrightAutoLogin',
      true,
    );
    this.loginUrl = this.configService.get<string>(
      'amazon.loginUrl',
      'https://www.amazon.com/ap/signin',
    );
    this.loginEmail = this.configService.get<string | undefined>(
      'amazon.loginEmail',
    );
    this.loginPassword = this.configService.get<string | undefined>(
      'amazon.loginPassword',
    );
    this.storageStatePath = this.configService.get<string>(
      'amazon.playwrightStorageStatePath',
      '.amazon-playwright-state.json',
    );
    this.resolvedStorageStatePath = resolve(this.storageStatePath);
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  async fetchReviewHtml(url: string): Promise<string> {
    const browser = await this.getBrowser();
    const context = await browser.newContext(await this.buildContextOptions());
    const page = await context.newPage();

    try {
      await this.gotoAndWait(page, url);
      await this.resolveContinueGate(page, url);
      let html = await page.content();
      let blockReason = this.httpClient.detectBlockReason(html);

      if (blockReason === 'SIGN_IN') {
        await this.tryAutoLogin(page, context);
        await this.gotoAndWait(page, url);
        html = await page.content();
        blockReason = this.httpClient.detectBlockReason(html);
      }

      if (blockReason === 'SIGN_IN') {
        throw new Error(
          `Playwright review fetch received sign-in page (authorization required) for ${url}`,
        );
      }

      if (blockReason === 'CHALLENGE') {
        throw new Error(
          `Playwright review fetch received anti-bot challenge for ${url}`,
        );
      }

      return html;
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  private async resolveContinueGate(page: PageLike, sourceUrl: string): Promise<void> {
    const continueSelectors = [
      'input#continue',
      'button#continue',
      'input[name="continue"]',
      'button[name="continue"]',
      'input[type="submit"][value*="Continue"]',
      'input[type="submit"][value*="continue"]',
      'input[type="submit"][value*="Continue shopping"]',
      'button:has-text("Continue")',
      'button:has-text("Continue shopping")',
      'a:has-text("Continue")',
      'a:has-text("Continue shopping")',
    ];

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const clicked = await this.clickFirstExistingIfPresent(page, continueSelectors);
      if (!clicked) {
        return;
      }

      this.logger.warn(
        `Playwright continue gate detected for ${sourceUrl}. Clicking Continue (attempt ${attempt}/2).`,
      );
      await page.waitForTimeout(1200);
      await this.gotoAndWait(page, sourceUrl);
    }
  }

  private async tryAutoLogin(
    page: PageLike,
    context: BrowserContextLike,
  ): Promise<void> {
    if (!this.autoLogin) {
      return;
    }

    if (!this.loginEmail || !this.loginPassword) {
      throw new Error(
        'Playwright auto-login requires AMAZON_LOGIN_EMAIL and AMAZON_LOGIN_PASSWORD',
      );
    }

    this.logger.log('Sign-in page detected. Attempting Playwright auto-login...');
    await this.gotoAndWait(page, this.loginUrl);

    const passwordFieldCount = await page
      .locator('input[name="password"]')
      .count();
    if (passwordFieldCount === 0) {
      await page.waitForSelector('input[name="email"], input#ap_email', {
        timeout: this.navTimeoutMs,
      });
      await page.fill('input[name="email"], input#ap_email', this.loginEmail);
      await this.clickFirstExisting(page, [
        'input#continue',
        'input.a-button-input[type="submit"]',
      ]);
      await page.waitForTimeout(700);
    }

    await page.waitForSelector('input[name="password"]', {
      timeout: this.navTimeoutMs,
    });
    await page.fill('input[name="password"]', this.loginPassword);
    await this.clickFirstExisting(page, [
      'input#signInSubmit',
      'input.a-button-input[type="submit"]',
    ]);
    await page.waitForTimeout(2500);

    const html = await page.content();
    const lower = html.toLowerCase();
    if (
      lower.includes('authentication required') ||
      lower.includes('enter verification code') ||
      lower.includes('two-step verification') ||
      lower.includes('otp')
    ) {
      throw new Error(
        'Playwright auto-login reached 2FA/OTP step. Complete login manually via review:login',
      );
    }

    if (this.httpClient.detectBlockReason(html) === 'SIGN_IN') {
      throw new Error(
        'Playwright auto-login failed (still on sign-in page). Check credentials/captcha.',
      );
    }

    await this.persistStorageState(context);
    this.logger.log('Playwright auto-login completed and storage state updated.');
  }

  private async clickFirstExisting(
    page: PageLike,
    selectors: string[],
  ): Promise<void> {
    const clicked = await this.clickFirstExistingIfPresent(page, selectors);
    if (clicked) {
      return;
    }

    throw new Error(`Unable to find clickable selector. Tried: ${selectors.join(', ')}`);
  }

  private async clickFirstExistingIfPresent(
    page: PageLike,
    selectors: string[],
  ): Promise<boolean> {
    for (const selector of selectors) {
      const count = await page.locator(selector).count();
      if (count === 0) {
        continue;
      }
      await page.click(selector);
      return true;
    }
    return false;
  }

  private async gotoAndWait(page: PageLike, url: string): Promise<void> {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: this.navTimeoutMs,
    });

    if (this.renderWaitMs > 0) {
      await page.waitForTimeout(this.renderWaitMs);
    }
  }

  private async getBrowser(): Promise<BrowserLike> {
    if (!this.browserPromise) {
      this.browserPromise = this.launchBrowser();
    }
    return this.browserPromise;
  }

  private async launchBrowser(): Promise<BrowserLike> {
    const playwright = await this.loadPlaywright();
    this.logger.log(`Launching Playwright browser for reviews. headless=${this.headless}`);

    return playwright.chromium.launch({
      headless: this.headless,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
  }

  private async buildContextOptions(): Promise<Record<string, unknown>> {
    const options: Record<string, unknown> = {};
    const hasStorage = await this.hasStorageStateFile();
    if (hasStorage) {
      options.storageState = this.resolvedStorageStatePath;
    }
    return options;
  }

  private async hasStorageStateFile(): Promise<boolean> {
    try {
      await access(this.resolvedStorageStatePath, fsConstants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  private async persistStorageState(context: BrowserContextLike): Promise<void> {
    await mkdir(dirname(this.resolvedStorageStatePath), { recursive: true });
    await context.storageState({ path: this.resolvedStorageStatePath });
  }

  private async loadPlaywright(): Promise<PlaywrightLike> {
    try {
      const moduleName = 'playwright';
      const loaded = (await import(moduleName)) as unknown as Record<
        string,
        unknown
      >;
      const playwright = (loaded.default ?? loaded) as PlaywrightLike;
      if (!playwright?.chromium?.launch) {
        throw new Error('playwright module does not expose chromium.launch');
      }
      return playwright;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Playwright is not available. Install it first: npm i -D playwright && npx playwright install chromium. Details: ${message}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.browserPromise) {
      return;
    }

    try {
      const browser = await this.browserPromise;
      await browser.close().catch(() => undefined);
      this.logger.log('Playwright browser closed on module destroy.');
    } catch {
      // ignore browser initialization/close errors during shutdown
    } finally {
      this.browserPromise = null;
    }
  }
}
