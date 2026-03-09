import { Injectable } from '@nestjs/common';
import { Product } from '@prisma/client';
import { ProductReviewSyncStats } from '../contracts/parser.types';
import { AmazonHttpClient } from '../../infrastructure/http/amazon-http.client';
import { AmazonHtmlParser } from '../../infrastructure/parsers/amazon-html.parser';
import { ParserPersistenceService } from '../../infrastructure/persistence/parser-persistence.service';
import { buildAmazonProductUrl } from '../../shared/utils/url-builder';
import { ReviewSyncUseCase } from './review-sync.use-case';

@Injectable()
export class ProductSyncUseCase {
  constructor(
    private readonly httpClient: AmazonHttpClient,
    private readonly htmlParser: AmazonHtmlParser,
    private readonly persistence: ParserPersistenceService,
    private readonly reviewSyncUseCase: ReviewSyncUseCase,
  ) {}

  async syncProductAndReviews(params: {
    marketplaceId: string;
    marketplaceDomain: string;
    product: Product;
    maxReviewPages: number;
    reviewLookbackDays: number;
  }): Promise<ProductReviewSyncStats> {
    const productUrl =
      params.product.productUrl ||
      buildAmazonProductUrl(params.marketplaceDomain, params.product.asin);

    const productHtml = await this.httpClient.getHtml(productUrl);
    const details = this.htmlParser.parseProductDetails(
      productHtml,
      params.marketplaceDomain,
    );

    const refreshedProduct = await this.persistence.applyProductDetails(
      {
        productId: params.product.id,
        marketplaceId: params.marketplaceId,
        productUrl,
      },
      details,
    );

    return this.reviewSyncUseCase.syncProductReviews({
      marketplaceId: params.marketplaceId,
      marketplaceDomain: params.marketplaceDomain,
      product: refreshedProduct,
      maxReviewPages: params.maxReviewPages,
      reviewLookbackDays: params.reviewLookbackDays,
    });
  }
}
