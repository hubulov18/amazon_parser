import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CrawlItemStatus, CrawlRunStatus, CrawlSourceScope, Product } from '@prisma/client';
import pLimit from 'p-limit';
import {
  CrawlCategoryInput,
  CrawlSummary,
  ParsedProductCard,
} from '../contracts/parser.types';
import { AmazonHttpClient } from '../../infrastructure/http/amazon-http.client';
import { AmazonHtmlParser } from '../../infrastructure/parsers/amazon-html.parser';
import { ParserPersistenceService } from '../../infrastructure/persistence/parser-persistence.service';
import { ReviewFetchService } from '../../infrastructure/reviews/review-fetch.service';
import { ProductSyncUseCase } from './product-sync.use-case';

@Injectable()
export class AmazonCrawlerService {
  private readonly logger = new Logger(AmazonCrawlerService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly httpClient: AmazonHttpClient,
    private readonly reviewFetchService: ReviewFetchService,
    private readonly htmlParser: AmazonHtmlParser,
    private readonly persistence: ParserPersistenceService,
    private readonly productSyncUseCase: ProductSyncUseCase,
  ) {}

  async crawlCategory(overrides: Partial<CrawlCategoryInput> = {}): Promise<CrawlSummary> {
    const input = this.resolveInput(overrides);
    this.validateInput(input);
    const startedAt = new Date();

    this.logger.log(
      `Starting crawl for category=${input.categorySlug}, url=${input.categoryUrl}, maxProducts=${input.maxProducts}`,
    );

    const marketplace = await this.persistence.ensureMarketplace(
      input.marketplaceCode,
      input.marketplaceDomain,
    );
    const category = await this.persistence.ensureCategory({
      marketplaceId: marketplace.id,
      slug: input.categorySlug,
      name: input.categoryName,
      sourceUrl: input.categoryUrl,
    });

    const crawlRun = await this.persistence.startCrawlRun({
      marketplaceId: marketplace.id,
      sourceScope: CrawlSourceScope.CATEGORY,
      sourceRef: input.categorySlug,
    });

    try {
      const productCards = await this.collectCategoryProducts({
        input,
        marketplaceId: marketplace.id,
        categoryId: category.id,
      });

      const persistedProducts: Product[] = [];
      for (let index = 0; index < productCards.length; index += 1) {
        const card = productCards[index];
        const product = await this.persistence.upsertProductFromListing(
          marketplace.id,
          card,
        );
        await this.persistence.linkProductToCategory(
          product.id,
          category.id,
          index + 1,
        );
        persistedProducts.push(product);
      }

      let failedProducts = 0;
      let blockedSignIn = 0;
      let blockedChallenge = 0;
      let createdReviews = 0;
      let updatedReviews = 0;
      let unchangedReviews = 0;

      const limit = pLimit(Math.max(1, input.productConcurrency));
      const tasks = persistedProducts.map((product) =>
        limit(async () => {
          try {
            const stats = await this.productSyncUseCase.syncProductAndReviews({
              marketplaceId: marketplace.id,
              marketplaceDomain: input.marketplaceDomain,
              product,
              maxReviewPages: input.maxReviewPages,
              reviewLookbackDays: input.reviewLookbackDays,
            });

            createdReviews += stats.created;
            updatedReviews += stats.updated;
            unchangedReviews += stats.unchanged;

            await this.persistence.appendRunItem({
              crawlRunId: crawlRun.id,
              status: CrawlItemStatus.SUCCESS,
              stage: 'PRODUCT_SYNC',
              productId: product.id,
              message: `reviews created=${stats.created}, updated=${stats.updated}, unchanged=${stats.unchanged}, pages=${stats.pagesFetched}`,
            });
          } catch (error) {
            failedProducts += 1;
            const message = error instanceof Error ? error.message : String(error);
            const blockReason = this.httpClient.classifyErrorMessage(message);
            if (blockReason === 'SIGN_IN') {
              blockedSignIn += 1;
            }
            if (blockReason === 'CHALLENGE') {
              blockedChallenge += 1;
            }

            await this.persistence.appendRunItem({
              crawlRunId: crawlRun.id,
              status: CrawlItemStatus.FAILED,
              stage: blockReason ? `PRODUCT_SYNC_BLOCKED_${blockReason}` : 'PRODUCT_SYNC',
              productId: product.id,
              message,
            });

            this.logger.error(`Product sync failed for ASIN=${product.asin}: ${message}`);
          }
        }),
      );

      await Promise.all(tasks);

      const finishedAt = new Date();
      const status =
        failedProducts > 0 ? CrawlRunStatus.PARTIAL : CrawlRunStatus.COMPLETED;

      const metrics = {
        scannedProducts: productCards.length,
        parsedProducts: persistedProducts.length,
        failedProducts,
        blockedSignIn,
        blockedChallenge,
        createdReviews,
        updatedReviews,
        unchangedReviews,
      };

      await this.persistence.finishCrawlRun({
        crawlRunId: crawlRun.id,
        status,
        metrics,
      });

      this.logger.log(
        `Crawl completed. products=${persistedProducts.length}, failed=${failedProducts}, blockedSignIn=${blockedSignIn}, blockedChallenge=${blockedChallenge}, createdReviews=${createdReviews}, updatedReviews=${updatedReviews}, reviewFetchMode=${this.reviewFetchService.fetchMode}`,
      );

      return {
        crawlRunId: crawlRun.id,
        categorySlug: input.categorySlug,
        scannedProducts: productCards.length,
        parsedProducts: persistedProducts.length,
        failedProducts,
        blockedSignIn,
        blockedChallenge,
        createdReviews,
        updatedReviews,
        unchangedReviews,
        startedAt,
        finishedAt,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.persistence.finishCrawlRun({
        crawlRunId: crawlRun.id,
        status: CrawlRunStatus.FAILED,
        metrics: {
          categorySlug: input.categorySlug,
        },
        errorMessage: message,
      });

      throw error;
    }
  }

  private async collectCategoryProducts(params: {
    input: CrawlCategoryInput;
    marketplaceId: string;
    categoryId: string;
  }): Promise<ParsedProductCard[]> {
    const uniqueByAsin = new Map<string, ParsedProductCard>();

    const normalizeCategoryUrl = (url: string): string => {
      const normalized = url.replace(/&amp;/g, '&').trim();

      try {
        const parsed = new URL(normalized);
        [
          'ref',
          'qid',
          'sr',
          'pd_rd_r',
          'pd_rd_w',
          'pd_rd_wg',
          'pf_rd_r',
          'pf_rd_p',
        ].forEach((param) => parsed.searchParams.delete(param));
        return parsed.toString();
      } catch {
        return normalized;
      }
    };

    const baseCategoryUrl = normalizeCategoryUrl(params.input.categoryUrl);
    const categoryCheckpointRef = this.buildCategoryCheckpointRef(
      params.input.categorySlug,
      baseCategoryUrl,
    );
    const categoryCheckpoint = params.input.ignoreCategoryCheckpoint
      ? null
      : await this.persistence.getCheckpoint({
          marketplaceId: params.marketplaceId,
          scope: CrawlSourceScope.CATEGORY,
          scopeRef: categoryCheckpointRef,
        });
    const checkpointUrl =
      categoryCheckpoint?.checkpointToken &&
      categoryCheckpoint.checkpointToken.startsWith('http')
        ? normalizeCategoryUrl(categoryCheckpoint.checkpointToken)
        : null;

    const queue: string[] = checkpointUrl
      ? [checkpointUrl, baseCategoryUrl]
      : [baseCategoryUrl];

    if (checkpointUrl) {
      this.logger.log(
        `Resuming category crawl from checkpoint: ${checkpointUrl}`,
      );
    }

    const visited = new Set<string>();
    let processedPages = 0;

    while (queue.length > 0 && processedPages < params.input.maxCategoryPages) {
      if (uniqueByAsin.size >= params.input.maxProducts) {
        break;
      }

      const pageUrl = normalizeCategoryUrl(queue.shift() as string);
      if (visited.has(pageUrl)) {
        continue;
      }

      visited.add(pageUrl);
      processedPages += 1;

      this.logger.log(
        `Fetching category page ${processedPages}/${params.input.maxCategoryPages}: ${pageUrl}`,
      );

      const html = await this.httpClient.getHtml(pageUrl);
      const cards = this.htmlParser.parseCategoryProducts(
        html,
        params.input.marketplaceDomain,
      );

      let checkpointToken = pageUrl;
      if (cards.length > 0) {
        for (const card of cards) {
          if (!uniqueByAsin.has(card.asin)) {
            uniqueByAsin.set(card.asin, card);
          }
        }

        const nextPageUrl = this.htmlParser.extractNextPageUrl(
          html,
          params.input.marketplaceDomain,
        );

        const normalizedNextPageUrl = nextPageUrl
          ? normalizeCategoryUrl(nextPageUrl)
          : null;
        if (
          normalizedNextPageUrl &&
          !visited.has(normalizedNextPageUrl) &&
          !queue.includes(normalizedNextPageUrl)
        ) {
          queue.push(normalizedNextPageUrl);
          checkpointToken = normalizedNextPageUrl;
        }
      } else {
        const candidates = this.htmlParser
          .extractListingCandidateUrls(html, params.input.marketplaceDomain)
          .map(normalizeCategoryUrl)
          .filter((url) => !visited.has(url) && !queue.includes(url))
          .slice(0, 4);

        if (candidates.length > 0) {
          this.logger.warn(
            `No product cards on page. Discovered ${candidates.length} listing candidates and continuing crawl.`,
          );
          queue.unshift(...candidates);
          checkpointToken = candidates[0];
        } else {
          this.logger.warn(
            'No product cards and no listing candidates found on current category page.',
          );
        }
      }

      await this.persistence.upsertCheckpoint({
        marketplaceId: params.marketplaceId,
        scope: CrawlSourceScope.CATEGORY,
        scopeRef: categoryCheckpointRef,
        checkpointToken,
        checkpointTime: new Date(),
        categoryId: params.categoryId,
      });
    }

    return Array.from(uniqueByAsin.values()).slice(0, params.input.maxProducts);
  }

  private resolveInput(overrides: Partial<CrawlCategoryInput>): CrawlCategoryInput {
    const categoryUrl =
      overrides.categoryUrl ??
      this.configService.get<string>(
        'amazon.categoryUrl',
        'https://www.amazon.com/s?i=electronics&rh=n%3A172541',
      );

    const categoryName =
      overrides.categoryName ??
      this.configService.get<string>('amazon.categoryName', 'Electronics > Headphones');

    const configuredCategorySlug = this.configService.get<string | undefined>(
      'amazon.categorySlug',
    );
    const derivedCategorySlug = this.deriveCategorySlugFromUrl(categoryUrl);
    const categorySlug =
      overrides.categorySlug ??
      (overrides.categoryUrl
        ? derivedCategorySlug ??
          configuredCategorySlug ??
          ParserPersistenceService.deriveCategorySlug(categoryName)
        : configuredCategorySlug ??
          derivedCategorySlug ??
          ParserPersistenceService.deriveCategorySlug(categoryName));

    const ignoreCategoryCheckpoint =
      overrides.ignoreCategoryCheckpoint ??
      this.configService.get<boolean>('amazon.ignoreCategoryCheckpoint', false);

    return {
      marketplaceCode:
        overrides.marketplaceCode ??
        this.configService.get<string>('amazon.marketplaceCode', 'US'),
      marketplaceDomain:
        overrides.marketplaceDomain ??
        this.configService.get<string>('amazon.marketplaceDomain', 'www.amazon.com'),
      categoryUrl,
      categorySlug,
      categoryName,
      maxProducts:
        overrides.maxProducts ??
        this.configService.get<number>('amazon.maxProducts', 30),
      maxCategoryPages:
        overrides.maxCategoryPages ??
        this.configService.get<number>('amazon.maxCategoryPages', 5),
      maxReviewPages:
        overrides.maxReviewPages ??
        this.configService.get<number>('amazon.maxReviewPages', 3),
      productConcurrency:
        overrides.productConcurrency ??
        this.configService.get<number>('amazon.productConcurrency', 1),
      reviewLookbackDays:
        overrides.reviewLookbackDays ??
        this.configService.get<number>('amazon.reviewLookbackDays', 14),
      ignoreCategoryCheckpoint,
    };
  }

  private validateInput(input: CrawlCategoryInput): void {
    const categoryUrl = input.categoryUrl.trim();
    if (!categoryUrl || categoryUrl === '...') {
      throw new Error(
        'Invalid categoryUrl: got placeholder "...". Pass a full Amazon category URL.',
      );
    }

    let parsed: URL;
    try {
      parsed = new URL(categoryUrl);
    } catch {
      throw new Error(
        `Invalid categoryUrl: ${categoryUrl}. Pass a full URL with http/https.`,
      );
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(
        `Unsupported protocol in categoryUrl: ${categoryUrl}. Use http or https.`,
      );
    }

    if (!parsed.hostname.toLowerCase().includes('amazon.')) {
      this.logger.warn(
        `categoryUrl host is not an Amazon domain: ${parsed.hostname}.`,
      );
    }
  }

  private buildCategoryCheckpointRef(
    categorySlug: string,
    categoryUrl: string,
  ): string {
    try {
      const parsed = new URL(categoryUrl);
      const relevantParams = ['i', 'rh', 'bbn', 'node']
        .map((key) => {
          const value = parsed.searchParams.get(key);
          return value ? `${key}=${value}` : null;
        })
        .filter((value): value is string => Boolean(value))
        .join('&');

      const signature = `${parsed.hostname}${parsed.pathname}${
        relevantParams ? `?${relevantParams}` : ''
      }`;
      return `${categorySlug}::${signature}`;
    } catch {
      return categorySlug;
    }
  }

  private deriveCategorySlugFromUrl(url: string): string | null {
    try {
      const parsed = new URL(url);
      const nodeFromRh = this.extractNodeIdFromRh(parsed.searchParams.get('rh'));
      const node =
        nodeFromRh ??
        this.extractNodeId(parsed.searchParams.get('node')) ??
        this.extractNodeId(parsed.searchParams.get('bbn'));

      const indexName = parsed.searchParams.get('i');
      const slugBase = indexName
        ? `${indexName}${node ? `-${node}` : ''}`
        : node
          ? `amazon-node-${node}`
          : parsed.pathname;

      const slug = ParserPersistenceService.deriveCategorySlug(slugBase);
      return slug || null;
    } catch {
      return null;
    }
  }

  private extractNodeIdFromRh(rh: string | null): string | null {
    if (!rh) {
      return null;
    }

    const decoded = decodeURIComponent(rh);
    const matches = [...decoded.matchAll(/(?:^|,)n:([0-9]{5,})(?:,|$)/g)];
    if (matches.length === 0) {
      return null;
    }

    return matches[matches.length - 1][1];
  }

  private extractNodeId(value: string | null): string | null {
    if (!value) {
      return null;
    }

    const trimmed = value.trim();
    return /^[0-9]{5,}$/.test(trimmed) ? trimmed : null;
  }
}
