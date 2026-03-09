import { Module } from '@nestjs/common';
import { AmazonCrawlerService } from './application/use-cases/amazon-crawler.service';
import { ProductSyncUseCase } from './application/use-cases/product-sync.use-case';
import { ReviewSyncUseCase } from './application/use-cases/review-sync.use-case';
import { AmazonCurlFallbackClient } from './infrastructure/http/amazon-curl-fallback.client';
import { AmazonHttpClient } from './infrastructure/http/amazon-http.client';
import { AmazonHtmlParser } from './infrastructure/parsers/amazon-html.parser';
import { ParserPersistenceService } from './infrastructure/persistence/parser-persistence.service';
import { PlaywrightReviewClient } from './infrastructure/reviews/playwright-review.client';
import { ReviewFetchService } from './infrastructure/reviews/review-fetch.service';

@Module({
  providers: [
    AmazonCrawlerService,
    ProductSyncUseCase,
    ReviewSyncUseCase,
    AmazonCurlFallbackClient,
    AmazonHtmlParser,
    AmazonHttpClient,
    PlaywrightReviewClient,
    ParserPersistenceService,
    ReviewFetchService,
  ],
  exports: [AmazonCrawlerService],
})
export class AmazonParserModule {}
