import 'reflect-metadata';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { access, mkdir, readFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Logger } from '@nestjs/common';

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
  waitForSelector: (
    selector: string,
    options?: { timeout?: number },
  ) => Promise<unknown>;
  fill: (selector: string, text: string) => Promise<void>;
  click: (selector: string) => Promise<void>;
  waitForTimeout: (timeoutMs: number) => Promise<void>;
  locator: (selector: string) => { count: () => Promise<number> };
};

type PlaywrightLike = {
  chromium: {
    launch: (options?: Record<string, unknown>) => Promise<BrowserLike>;
  };
};

const logger = new Logger('ReviewLoginCLI');

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
};

const parseNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseString = (value: string | undefined): string | undefined => {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
};

const tryLoadDotEnvFile = async (path: string): Promise<void> => {
  try {
    const content = await readFile(path, 'utf8');
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }

      const separatorIndex = line.indexOf('=');
      if (separatorIndex <= 0) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      if (!key || process.env[key] !== undefined) {
        continue;
      }

      let value = line.slice(separatorIndex + 1).trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      if (value.startsWith("'") && value.endsWith("'")) {
        value = value.slice(1, -1);
      }

      process.env[key] = value;
    }
  } catch {
    // ignore missing .env files
  }
};

const loadEnv = async (): Promise<void> => {
  await tryLoadDotEnvFile('.env');
  await tryLoadDotEnvFile('.env.local');
};

const loadPlaywright = async (): Promise<PlaywrightLike> => {
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
};

const clickIfExists = async (
  page: PageLike,
  selectors: string[],
): Promise<boolean> => {
  for (const selector of selectors) {
    const count = await page.locator(selector).count();
    if (count === 0) {
      continue;
    }
    await page.click(selector);
    return true;
  }
  return false;
};

const resolveContinueGate = async (
  page: PageLike,
  sourceUrl: string,
): Promise<void> => {
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
    const clicked = await clickIfExists(page, continueSelectors);
    if (!clicked) {
      return;
    }

    logger.warn(
      `Continue gate detected for ${sourceUrl}. Clicking Continue (attempt ${attempt}/2).`,
    );
    await page.waitForTimeout(1200);
    await page.goto(sourceUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
  }
};

const runAutoCredentialStep = async (
  page: PageLike,
  email: string,
  password: string,
  timeoutMs: number,
): Promise<void> => {
  const hasPasswordField = await page.locator('input[name="password"]').count();
  if (hasPasswordField === 0 || await page.locator('input[name="email"], input#ap_email').count() > 0) {
    await page.waitForSelector('input[name="email"], input#ap_email', {
      timeout: timeoutMs,
    });
    await page.fill('input[type="email"]', email);
    await clickIfExists(page, [
      'input#continue',
      'input.a-button-input[type="submit"]',
    ]);
    await page.waitForTimeout(700);
  }

  await page.waitForSelector('input[name="password"]', { timeout: timeoutMs });
  await page.fill('input[name="password"]', password);
  await clickIfExists(page, [
    'input#signInSubmit',
    'input.a-button-input[type="submit"]',
  ]);
  await page.waitForTimeout(2500);
};

async function bootstrap(): Promise<void> {
  await loadEnv();

  const loginUrl = parseString(process.env.AMAZON_LOGIN_URL) ??
    'https://www.amazon.com/ap/signin';
  const storageStatePath =
    parseString(process.env.AMAZON_PLAYWRIGHT_STORAGE_STATE_PATH) ??
    '.amazon-playwright-state.json';
  const timeoutMs = parseNumber(process.env.AMAZON_REVIEW_LOGIN_TIMEOUT_MS, 600000);
  const autoFill = parseBoolean(process.env.AMAZON_PLAYWRIGHT_AUTO_LOGIN, true);
  const loginEmail = parseString(process.env.AMAZON_LOGIN_EMAIL);
  const loginPassword = parseString(process.env.AMAZON_LOGIN_PASSWORD);
  const resolvedStorageStatePath = resolve(storageStatePath);

  await mkdir(dirname(resolvedStorageStatePath), { recursive: true });

  const playwright = await loadPlaywright();
  const browser = await playwright.chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  let context: BrowserContextLike | null = null;
  try {
    const contextOptions: Record<string, unknown> = {};
    try {
      await access(resolvedStorageStatePath, fsConstants.R_OK);
      contextOptions.storageState = resolvedStorageStatePath;
    } catch {
      // no storage state yet
    }

    context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    await page.goto(loginUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await resolveContinueGate(page, loginUrl);

    if (autoFill && loginEmail && loginPassword) {
      logger.log('Trying automatic credentials fill via Playwright...');
      await runAutoCredentialStep(page, loginEmail, loginPassword, 30000);
      await resolveContinueGate(page, loginUrl);
    }

    logger.log(
      'Finish Amazon login in opened browser (captcha/otp if needed), then return to terminal.',
    );
    const rl = createInterface({ input, output });
    const timeoutHandle = setTimeout(() => {
      rl.close();
    }, timeoutMs);

    try {
      await rl.question('When login is completed, press Enter: ');
    } finally {
      clearTimeout(timeoutHandle);
      rl.close();
    }

    await context.storageState({ path: resolvedStorageStatePath });
    logger.log(`Saved Playwright storage state: ${resolvedStorageStatePath}`);
    logger.log(
      'Use AMAZON_REVIEW_FETCH_MODE=playwright and this storage-state path in crawler env.',
    );
  } finally {
    if (context) {
      await context.close().catch(() => undefined);
    }
    await browser.close().catch(() => undefined);
  }
}

void bootstrap();
