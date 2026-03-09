import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AmazonHttpClient } from '../http/amazon-http.client';
import { PlaywrightReviewClient } from './playwright-review.client';

type ReviewFetchMode = 'http' | 'playwright';

@Injectable()
export class ReviewFetchService {
  private readonly logger = new Logger(ReviewFetchService.name);
  private readonly mode: ReviewFetchMode;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpClient: AmazonHttpClient,
    private readonly playwrightReviewClient: PlaywrightReviewClient,
  ) {
    this.mode = this.resolveMode(
      this.configService.get<string>('amazon.reviewFetchMode', 'http'),
    );
  }

  get fetchMode(): ReviewFetchMode {
    return this.mode;
  }

  async getReviewHtml(url: string): Promise<string> {
    if (this.mode === 'http') {
      return this.httpClient.getHtml(url);
    }

    if (!this.playwrightReviewClient.isEnabled) {
      this.logger.warn(
        'AMAZON_REVIEW_FETCH_MODE=playwright, but Playwright client is not enabled. Falling back to http mode for reviews.',
      );
      return this.httpClient.getHtml(url);
    }

    return this.playwrightReviewClient.fetchReviewHtml(url);
  }

  private resolveMode(rawMode: string): ReviewFetchMode {
    const normalized = rawMode.trim().toLowerCase();
    if (
      normalized === 'playwright' ||
      normalized === 'browser' ||
      normalized === 'puppeteer'
    ) {
      return 'playwright';
    }
    return 'http';
  }
}
