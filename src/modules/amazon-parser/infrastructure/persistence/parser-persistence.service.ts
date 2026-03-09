import { Injectable } from '@nestjs/common';
import {
  CrawlItemStatus,
  CrawlRunStatus,
  CrawlSourceScope,
  Prisma,
  Product,
} from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  ParsedProductCard,
  ParsedProductDetails,
  ParsedReview,
} from '../../application/contracts/parser.types';
import {
  normalizeText,
  normalizeWhitespace,
  sha1,
  slugify,
} from '../../shared/utils/normalizers';

export type ReviewSyncResult = {
  status: 'created' | 'updated' | 'unchanged';
  reviewId: bigint;
};

@Injectable()
export class ParserPersistenceService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureMarketplace(code: string, domain: string) {
    const { currencyCode, locale } = this.marketplaceDefaults(code);

    return this.prisma.marketplace.upsert({
      where: { code },
      create: {
        code,
        domain,
        currencyCode,
        locale,
      },
      update: {
        domain,
        currencyCode,
        locale,
      },
    });
  }

  async ensureCategory(params: {
    marketplaceId: string;
    slug: string;
    name: string;
    sourceUrl: string;
  }) {
    const path = normalizeWhitespace(params.name);
    const level = path.split('>').map((part) => part.trim()).filter(Boolean).length;

    return this.prisma.category.upsert({
      where: {
        marketplaceId_slug: {
          marketplaceId: params.marketplaceId,
          slug: params.slug,
        },
      },
      create: {
        marketplaceId: params.marketplaceId,
        slug: params.slug,
        name: path,
        path,
        level: level || 1,
        sourceUrl: params.sourceUrl,
      },
      update: {
        name: path,
        path,
        level: level || 1,
        sourceUrl: params.sourceUrl,
      },
    });
  }

  async upsertProductFromListing(
    marketplaceId: string,
    card: ParsedProductCard,
  ): Promise<Product> {
    const normalizedTitle = normalizeText(card.title);
    const detailFingerprint = sha1(
      JSON.stringify({
        title: normalizedTitle,
        imageUrl: card.imageUrl,
        priceCents: card.priceCents,
        averageRating: card.averageRating,
        ratingsCount: card.ratingsCount,
        reviewsCount: card.reviewsCount,
      }),
    );

    const now = new Date();

    return this.prisma.product.upsert({
      where: {
        marketplaceId_asin: {
          marketplaceId,
          asin: card.asin,
        },
      },
      create: {
        marketplaceId,
        asin: card.asin,
        title: normalizeWhitespace(card.title),
        normalizedTitle,
        productUrl: card.productUrl,
        imageUrl: card.imageUrl,
        priceCents: card.priceCents,
        averageRating: card.averageRating,
        ratingsCount: card.ratingsCount,
        reviewsCount: card.reviewsCount,
        detailFingerprint,
        firstSeenAt: now,
        lastSeenAt: now,
      },
      update: {
        title: normalizeWhitespace(card.title),
        normalizedTitle,
        productUrl: card.productUrl,
        imageUrl: card.imageUrl,
        priceCents: card.priceCents,
        averageRating: card.averageRating,
        ratingsCount: card.ratingsCount,
        reviewsCount: card.reviewsCount,
        detailFingerprint,
        lastSeenAt: now,
      },
    });
  }

  async linkProductToCategory(
    productId: string,
    categoryId: string,
    rankInCategory?: number,
  ): Promise<void> {
    await this.prisma.productCategory.upsert({
      where: {
        productId_categoryId: {
          productId,
          categoryId,
        },
      },
      create: {
        productId,
        categoryId,
        isPrimary: true,
        rankInCategory,
      },
      update: {
        isPrimary: true,
        rankInCategory,
        capturedAt: new Date(),
      },
    });
  }

  async applyProductDetails(
    params: {
      productId: string;
      marketplaceId: string;
      productUrl: string;
    },
    details: ParsedProductDetails,
  ): Promise<Product> {
    const brandId = await this.ensureBrandId(details.brandName);

    let sellerId: string | null = null;
    if (details.sellerName) {
      const normalizedName = normalizeText(details.sellerName);
      const seller = await this.prisma.seller.upsert({
        where: {
          marketplaceId_normalizedName: {
            marketplaceId: params.marketplaceId,
            normalizedName,
          },
        },
        create: {
          marketplaceId: params.marketplaceId,
          normalizedName,
          displayName: normalizeWhitespace(details.sellerName),
          sellerUrl: details.sellerUrl,
        },
        update: {
          displayName: normalizeWhitespace(details.sellerName),
          sellerUrl: details.sellerUrl,
        },
      });

      sellerId = seller.id;
    }

    const normalizedTitle = normalizeText(details.title);
    const detailFingerprint = sha1(
      JSON.stringify({
        title: details.title,
        imageUrl: details.imageUrl,
        brandName: details.brandName,
        sellerName: details.sellerName,
        priceCents: details.priceCents,
        averageRating: details.averageRating,
        ratingsCount: details.ratingsCount,
        reviewsCount: details.reviewsCount,
      }),
    );

    const product = await this.prisma.product.update({
      where: { id: params.productId },
      data: {
        title: details.title ? normalizeWhitespace(details.title) : undefined,
        normalizedTitle: details.title ? normalizedTitle : undefined,
        productUrl: params.productUrl,
        imageUrl: details.imageUrl,
        priceCents: details.priceCents,
        averageRating: details.averageRating,
        ratingsCount: details.ratingsCount,
        reviewsCount: details.reviewsCount,
        brandId: details.brandName ? brandId : undefined,
        detailFingerprint,
        lastSeenAt: new Date(),
      },
    });

    if (sellerId) {
      await this.prisma.productSeller.upsert({
        where: {
          productId_sellerId: {
            productId: params.productId,
            sellerId,
          },
        },
        create: {
          productId: params.productId,
          sellerId,
          priceCents: details.priceCents,
          isBuyBox: true,
        },
        update: {
          priceCents: details.priceCents,
          isBuyBox: true,
          lastSeenAt: new Date(),
        },
      });
    }

    return product;
  }

  async upsertReview(params: {
    marketplaceId: string;
    productId: string;
    review: ParsedReview;
  }): Promise<ReviewSyncResult> {
    const review = params.review;
    const now = new Date();

    const contentFingerprint = sha1(
      JSON.stringify({
        title: review.title,
        body: review.body,
        rating: review.rating,
        helpfulVotes: review.helpfulVotes,
        isVerifiedPurchase: review.isVerifiedPurchase,
        isVineVoice: review.isVineVoice,
      }),
    );

    const existing = await this.prisma.review.findUnique({
      where: {
        marketplaceId_externalReviewId: {
          marketplaceId: params.marketplaceId,
          externalReviewId: review.externalReviewId,
        },
      },
      select: {
        id: true,
        contentFingerprint: true,
      },
    });

    if (!existing) {
      const created = await this.prisma.review.create({
        data: {
          marketplaceId: params.marketplaceId,
          productId: params.productId,
          externalReviewId: review.externalReviewId,
          reviewUrl: review.reviewUrl,
          title: review.title,
          body: review.body,
          rating: review.rating,
          languageCode: review.languageCode,
          authorName: review.authorName,
          authorProfileUrl: review.authorProfileUrl,
          isVerifiedPurchase: review.isVerifiedPurchase,
          isVineVoice: review.isVineVoice,
          helpfulVotes: review.helpfulVotes,
          reviewedAt: review.reviewedAt,
          scrapedAt: now,
          lastSeenAt: now,
          contentFingerprint,
          rawPayload: review.rawPayload as Prisma.InputJsonValue,
        },
      });

      return { status: 'created', reviewId: created.id };
    }

    if (existing.contentFingerprint !== contentFingerprint) {
      const updated = await this.prisma.review.update({
        where: { id: existing.id },
        data: {
          reviewUrl: review.reviewUrl,
          title: review.title,
          body: review.body,
          rating: review.rating,
          languageCode: review.languageCode,
          authorName: review.authorName,
          authorProfileUrl: review.authorProfileUrl,
          isVerifiedPurchase: review.isVerifiedPurchase,
          isVineVoice: review.isVineVoice,
          helpfulVotes: review.helpfulVotes,
          reviewedAt: review.reviewedAt,
          scrapedAt: now,
          lastSeenAt: now,
          contentFingerprint,
          rawPayload: review.rawPayload as Prisma.InputJsonValue,
        },
      });

      return { status: 'updated', reviewId: updated.id };
    }

    await this.prisma.review.update({
      where: { id: existing.id },
      data: {
        lastSeenAt: now,
        scrapedAt: now,
      },
    });

    return { status: 'unchanged', reviewId: existing.id };
  }

  async updateProductReviewCheckpoint(productId: string, at: Date): Promise<void> {
    await this.prisma.product.update({
      where: { id: productId },
      data: {
        lastReviewCrawlAt: at,
      },
    });
  }

  async upsertCheckpoint(params: {
    marketplaceId: string;
    scope: CrawlSourceScope;
    scopeRef: string;
    checkpointTime?: Date;
    checkpointToken?: string;
    categoryId?: string;
    productId?: string;
  }): Promise<void> {
    await this.prisma.syncCheckpoint.upsert({
      where: {
        marketplaceId_scope_scopeRef: {
          marketplaceId: params.marketplaceId,
          scope: params.scope,
          scopeRef: params.scopeRef,
        },
      },
      create: {
        marketplaceId: params.marketplaceId,
        scope: params.scope,
        scopeRef: params.scopeRef,
        checkpointTime: params.checkpointTime,
        checkpointToken: params.checkpointToken,
        categoryId: params.categoryId,
        productId: params.productId,
      },
      update: {
        checkpointTime: params.checkpointTime,
        checkpointToken: params.checkpointToken,
        categoryId: params.categoryId,
        productId: params.productId,
      },
    });
  }

  async getCheckpoint(params: {
    marketplaceId: string;
    scope: CrawlSourceScope;
    scopeRef: string;
  }) {
    return this.prisma.syncCheckpoint.findUnique({
      where: {
        marketplaceId_scope_scopeRef: {
          marketplaceId: params.marketplaceId,
          scope: params.scope,
          scopeRef: params.scopeRef,
        },
      },
    });
  }

  async startCrawlRun(params: {
    marketplaceId: string;
    sourceScope: CrawlSourceScope;
    sourceRef: string;
  }) {
    return this.prisma.crawlRun.create({
      data: {
        marketplaceId: params.marketplaceId,
        sourceScope: params.sourceScope,
        sourceRef: params.sourceRef,
        status: CrawlRunStatus.RUNNING,
      },
    });
  }

  async finishCrawlRun(params: {
    crawlRunId: string;
    status: CrawlRunStatus;
    metrics: Record<string, unknown>;
    errorMessage?: string;
  }): Promise<void> {
    await this.prisma.crawlRun.update({
      where: { id: params.crawlRunId },
      data: {
        status: params.status,
        metrics: params.metrics as Prisma.InputJsonValue,
        errorMessage: params.errorMessage,
        finishedAt: new Date(),
      },
    });
  }

  async appendRunItem(params: {
    crawlRunId: string;
    status: CrawlItemStatus;
    stage: string;
    message?: string;
    productId?: string;
    reviewId?: bigint;
  }): Promise<void> {
    await this.prisma.crawlRunItem.create({
      data: {
        crawlRunId: params.crawlRunId,
        status: params.status,
        stage: params.stage,
        message: params.message,
        productId: params.productId,
        reviewId: params.reviewId,
      },
    });
  }

  private async ensureBrandId(brandName?: string): Promise<string | null> {
    if (!brandName) {
      return null;
    }

    const name = normalizeWhitespace(brandName);
    if (!name) {
      return null;
    }

    const normalizedName = normalizeText(name);
    const brand = await this.prisma.brand.upsert({
      where: { normalizedName },
      create: {
        name,
        normalizedName,
      },
      update: {
        name,
      },
    });

    return brand.id;
  }

  private marketplaceDefaults(code: string): {
    currencyCode: string;
    locale: string;
  } {
    const upper = code.toUpperCase();

    if (upper === 'US') {
      return { currencyCode: 'USD', locale: 'en-US' };
    }

    if (upper === 'UK') {
      return { currencyCode: 'GBP', locale: 'en-GB' };
    }

    if (upper === 'DE') {
      return { currencyCode: 'EUR', locale: 'de-DE' };
    }

    return { currencyCode: 'USD', locale: 'en-US' };
  }

  static deriveCategorySlug(name: string): string {
    const candidate = slugify(name);
    return candidate || 'amazon-category';
  }
}
