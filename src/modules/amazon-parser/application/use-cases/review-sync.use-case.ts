import { Injectable, Logger } from '@nestjs/common';
import { CrawlSourceScope, Product } from '@prisma/client';
import { ProductReviewSyncStats } from '../contracts/parser.types';
import { AmazonHtmlParser } from '../../infrastructure/parsers/amazon-html.parser';
import { ParserPersistenceService } from '../../infrastructure/persistence/parser-persistence.service';
import { ReviewFetchService } from '../../infrastructure/reviews/review-fetch.service';
import { buildAmazonReviewUrl } from '../../shared/utils/url-builder';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ReviewSyncUseCase {
  private readonly logger = new Logger(ReviewSyncUseCase.name);

  constructor(
    private readonly reviewFetchService: ReviewFetchService,
    private readonly htmlParser: AmazonHtmlParser,
    private readonly persistence: ParserPersistenceService,
  ) {}

  async syncProductReviews(params: {
    marketplaceId: string;
    marketplaceDomain: string;
    product: Product;
    maxReviewPages: number;
    reviewLookbackDays: number;
  }): Promise<ProductReviewSyncStats> {
    const stats: ProductReviewSyncStats = {
      created: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      pagesFetched: 0,
    };

    const cutoff = params.product.lastReviewCrawlAt
      ? new Date(
          params.product.lastReviewCrawlAt.getTime() -
            params.reviewLookbackDays * DAY_MS,
        )
      : null;

    for (let page = 1; page <= params.maxReviewPages; page += 1) {
      const reviewUrl = buildAmazonReviewUrl(
        params.marketplaceDomain,
        params.product.asin,
        page,
      );

      const html = await this.reviewFetchService.getReviewHtml(reviewUrl);
      const reviews = this.htmlParser.parseReviews(html, params.marketplaceDomain);
      if (reviews.length === 0) {
        break;
      }

      stats.pagesFetched = page;
      let staleUnchangedCount = 0;

      for (const review of reviews) {
        if (!review.externalReviewId) {
          stats.skipped += 1;
          continue;
        }

        const result = await this.persistence.upsertReview({
          marketplaceId: params.marketplaceId,
          productId: params.product.id,
          review,
        });

        if (result.status === 'created') {
          stats.created += 1;
        }
        if (result.status === 'updated') {
          stats.updated += 1;
        }
        if (result.status === 'unchanged') {
          stats.unchanged += 1;
        }

        if (
          cutoff &&
          review.reviewedAt < cutoff &&
          result.status === 'unchanged'
        ) {
          staleUnchangedCount += 1;
        }
      }

      const stopByLookback =
        Boolean(cutoff) && staleUnchangedCount === reviews.length;
      if (stopByLookback) {
        this.logger.debug(
          `Stopping reviews for ASIN=${params.product.asin}. Old unchanged page detected at page=${page}.`,
        );
        break;
      }
    }

    await this.persistence.updateProductReviewCheckpoint(
      params.product.id,
      new Date(),
    );

    await this.persistence.upsertCheckpoint({
      marketplaceId: params.marketplaceId,
      scope: CrawlSourceScope.REVIEWS,
      scopeRef: params.product.asin,
      checkpointTime: new Date(),
      productId: params.product.id,
    });

    return stats;
  }
}
