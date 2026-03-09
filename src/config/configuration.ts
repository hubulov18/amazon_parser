const parseNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

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

const parseString = (value: string | undefined): string | undefined => {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
};

const parseCsv = (value: string | undefined): string[] => {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
};

const parseReviewFetchMode = (
  value: string | undefined,
  fallback: 'http' | 'playwright',
): 'http' | 'playwright' => {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === 'playwright' ||
    normalized === 'puppeteer' ||
    normalized === 'browser'
  ) {
    return 'playwright';
  }
  if (normalized === 'http') {
    return 'http';
  }
  return fallback;
};

export default () => ({
  app: {
    port: parseNumber(process.env.APP_PORT, 3000),
    logLevel: process.env.LOG_LEVEL ?? 'log',
  },
  amazon: {
    marketplaceCode: process.env.AMAZON_MARKETPLACE_CODE ?? 'US',
    marketplaceDomain: process.env.AMAZON_MARKETPLACE_DOMAIN ?? 'www.amazon.com',
    categoryUrl:
      process.env.AMAZON_CATEGORY_URL ??
      'https://www.amazon.com/s?i=electronics&rh=n%3A172541',
    categorySlug: parseString(process.env.AMAZON_CATEGORY_SLUG),
    categoryName: process.env.AMAZON_CATEGORY_NAME ?? 'Electronics > Headphones',
    maxProducts: parseNumber(process.env.AMAZON_MAX_PRODUCTS, 30),
    maxCategoryPages: parseNumber(process.env.AMAZON_MAX_CATEGORY_PAGES, 5),
    maxReviewPages: parseNumber(process.env.AMAZON_MAX_REVIEW_PAGES, 3),
    requestTimeoutMs: parseNumber(process.env.AMAZON_REQUEST_TIMEOUT_MS, 15000),
    retryCount: parseNumber(process.env.AMAZON_RETRY_COUNT, 4),
    minRequestDelayMs: parseNumber(process.env.AMAZON_MIN_REQUEST_DELAY_MS, 2500),
    maxRequestDelayMs: parseNumber(process.env.AMAZON_MAX_REQUEST_DELAY_MS, 6000),
    enableCurlFallback: parseBoolean(
      process.env.AMAZON_ENABLE_CURL_FALLBACK,
      true,
    ),
    curlFallbackTimeoutMs: parseNumber(
      process.env.AMAZON_CURL_FALLBACK_TIMEOUT_MS,
      30000,
    ),
    authCookie: parseString(process.env.AMAZON_AUTH_COOKIE),
    proxyUrls: parseCsv(process.env.AMAZON_PROXY_URLS),
    reviewFetchMode: parseReviewFetchMode(
      process.env.AMAZON_REVIEW_FETCH_MODE,
      'playwright',
    ),
    playwrightStorageStatePath:
      parseString(process.env.AMAZON_PLAYWRIGHT_STORAGE_STATE_PATH) ??
      '.amazon-playwright-state.json',
    playwrightHeadless: parseBoolean(
      process.env.AMAZON_PLAYWRIGHT_HEADLESS,
      true,
    ),
    playwrightNavTimeoutMs: parseNumber(
      process.env.AMAZON_PLAYWRIGHT_NAV_TIMEOUT_MS,
      45000,
    ),
    playwrightRenderWaitMs: parseNumber(
      process.env.AMAZON_PLAYWRIGHT_RENDER_WAIT_MS,
      1200,
    ),
    playwrightAutoLogin: parseBoolean(
      process.env.AMAZON_PLAYWRIGHT_AUTO_LOGIN,
      true,
    ),
    loginUrl:
      parseString(process.env.AMAZON_LOGIN_URL) ??
      'https://www.amazon.com/ap/signin',
    loginEmail: parseString(process.env.AMAZON_LOGIN_EMAIL),
    loginPassword: parseString(process.env.AMAZON_LOGIN_PASSWORD),
    productConcurrency: parseNumber(process.env.AMAZON_PRODUCT_CONCURRENCY, 1),
    reviewLookbackDays: parseNumber(process.env.AMAZON_REVIEW_LOOKBACK_DAYS, 14),
    ignoreCategoryCheckpoint: parseBoolean(
      process.env.AMAZON_IGNORE_CATEGORY_CHECKPOINT,
      false,
    ),
  },
});
