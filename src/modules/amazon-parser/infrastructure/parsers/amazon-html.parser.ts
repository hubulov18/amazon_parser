import { Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';
import {
  ParsedProductCard,
  ParsedProductDetails,
  ParsedReview,
} from '../../application/contracts/parser.types';
import {
  extractFloat,
  extractInteger,
  normalizeWhitespace,
  toCents,
} from '../../shared/utils/normalizers';
import {
  buildAmazonProductUrl,
  toAbsoluteAmazonUrl,
} from '../../shared/utils/url-builder';

@Injectable()
export class AmazonHtmlParser {
  parseCategoryProducts(
    html: string,
    marketplaceDomain: string,
  ): ParsedProductCard[] {
    const $ = cheerio.load(html);
    const products: ParsedProductCard[] = [];
    const seenAsins = new Set<string>();

    $(
      [
        '[data-component-type="s-search-result"][data-asin]',
        'div.s-result-item[data-asin]',
        'div.sg-col-20-of-24.s-result-item[data-asin]',
      ].join(', '),
    ).each((_, element) => {
      const row = $(element);
      const asin = normalizeWhitespace(row.attr('data-asin'));

      if (!asin || asin.length !== 10 || seenAsins.has(asin)) {
        return;
      }

      const title = normalizeWhitespace(
        row.find('h2 a span').first().text() ||
          row.find('span.a-size-medium.a-color-base.a-text-normal').first().text() ||
          row.find('a.a-link-normal.s-underline-text.s-underline-link-text').first().text(),
      );
      if (!title) {
        return;
      }

      const priceRaw = normalizeWhitespace(
        row.find('.a-price .a-offscreen').first().text(),
      );

      const ratingRaw = normalizeWhitespace(
        row.find('.a-icon-alt').first().text(),
      );

      const ratingsRaw = normalizeWhitespace(
        row
          .find('span.a-size-base.s-underline-text, span[aria-label$="ratings"]')
          .first()
          .text(),
      );

      const imageUrl = row.find('img.s-image').first().attr('src');

      seenAsins.add(asin);
      products.push({
        asin,
        title,
        productUrl: buildAmazonProductUrl(marketplaceDomain, asin),
        imageUrl,
        priceCents: toCents(priceRaw),
        averageRating: extractFloat(ratingRaw),
        ratingsCount: extractInteger(ratingsRaw),
        reviewsCount: undefined,
      });
    });

    return products;
  }

  extractNextPageUrl(
    html: string,
    marketplaceDomain: string,
  ): string | null {
    const $ = cheerio.load(html);
    const rawHref =
      $('a.s-pagination-next:not(.s-pagination-disabled)').first().attr('href') ||
      $('a[aria-label*="Go to next page"]').first().attr('href') ||
      $('a[aria-label*="Next page"]').first().attr('href');

    if (!rawHref) {
      return null;
    }

    return toAbsoluteAmazonUrl(marketplaceDomain, rawHref);
  }

  extractListingCandidateUrls(
    html: string,
    marketplaceDomain: string,
  ): string[] {
    const $ = cheerio.load(html);
    const unique = new Set<string>();
    const blockedRefTokens = [
      'footer',
      'nav_cs_registry',
      'nav_footer',
      'amzn_nav_ftr',
      'nav_ftr',
      'global',
    ];

    const pushHref = (href: string | undefined): void => {
      if (!href) {
        return;
      }

      const normalized = href.trim();
      if (!normalized) {
        return;
      }

      if (
        !normalized.includes('/s?') &&
        !normalized.includes('/gp/browse.html')
      ) {
        return;
      }

      if (
        normalized.includes('customer-reviews') ||
        normalized.includes('/help/') ||
        normalized.includes('/gp/video')
      ) {
        return;
      }

      const absolute = toAbsoluteAmazonUrl(marketplaceDomain, normalized);
      try {
        const parsed = new URL(absolute);
        const pathname = parsed.pathname.toLowerCase();
        const refTag = (
          parsed.searchParams.get('ref_') ??
          parsed.searchParams.get('ref') ??
          ''
        ).toLowerCase();

        if (blockedRefTokens.some((token) => refTag.includes(token))) {
          return;
        }

        const isSearchListing = pathname === '/s';
        const isBrowseListing = pathname === '/gp/browse.html';
        if (!isSearchListing && !isBrowseListing) {
          return;
        }

        if (isSearchListing) {
          const hasCategoryQuery =
            parsed.searchParams.has('rh') ||
            parsed.searchParams.has('bbn') ||
            parsed.searchParams.has('node');
          if (!hasCategoryQuery) {
            return;
          }
        }

        if (isBrowseListing && !parsed.searchParams.has('node')) {
          return;
        }

        unique.add(parsed.toString());
      } catch {
        // ignore invalid candidate URLs
      }
    };

    $(
      [
        'a[href*="/s?i="]',
        'a[href*="/s?rh="]',
        'a[href*="/s?"][href*="rh="]',
        'a[href*="/gp/browse.html?node="]',
      ].join(', '),
    ).each((_, el) => {
      pushHref($(el).attr('href'));
    });

    return Array.from(unique);
  }

  parseProductDetails(
    html: string,
    marketplaceDomain: string,
  ): ParsedProductDetails {
    const $ = cheerio.load(html);

    const title = normalizeWhitespace($('#productTitle').text());
    const imageCandidate =
      $('#landingImage').attr('data-old-hires') ||
      $('#landingImage').attr('src') ||
      $('img#imgTagWrapperId img').attr('src');

    const byline = normalizeWhitespace($('#bylineInfo').text());

    const sellerAnchor = $('#sellerProfileTriggerId').closest('a');
    const merchantAnchor = $('#merchant-info a').first();
    const sellerName = normalizeWhitespace(
      sellerAnchor.text() || merchantAnchor.text(),
    );
    const sellerHref = sellerAnchor.attr('href') || merchantAnchor.attr('href');

    const priceRaw = normalizeWhitespace(
      $('#corePrice_feature_div .a-price .a-offscreen').first().text() ||
        $('span.a-price span.a-offscreen').first().text(),
    );

    const averageRatingRaw = normalizeWhitespace(
      $('#acrPopover').attr('title') ||
        $('span[data-hook="rating-out-of-text"]').first().text(),
    );

    const ratingsSummaryRaw = normalizeWhitespace(
      $('#acrCustomerReviewText').text() ||
        $('[data-hook="cr-filter-info-review-rating-count"]').first().text(),
    );
    const reviewsSummaryRaw = normalizeWhitespace(
      $('[data-hook="total-review-count"]').first().text() ||
        $('[data-hook="cr-filter-info-review-rating-count"]').first().text(),
    );

    return {
      title: title || undefined,
      imageUrl: imageCandidate,
      brandName: byline || undefined,
      sellerName: sellerName || undefined,
      sellerUrl: sellerHref
        ? toAbsoluteAmazonUrl(marketplaceDomain, sellerHref)
        : undefined,
      priceCents: toCents(priceRaw),
      averageRating: extractFloat(averageRatingRaw),
      ratingsCount: extractInteger(ratingsSummaryRaw),
      reviewsCount:
        this.extractReviewCount(reviewsSummaryRaw) ??
        this.extractReviewCount(ratingsSummaryRaw),
    };
  }

  parseReviews(html: string, marketplaceDomain: string): ParsedReview[] {
    const $ = cheerio.load(html);
    const reviews: ParsedReview[] = [];

    $('[data-hook="review"]').each((_, element) => {
      const row = $(element);

      const externalReviewId = normalizeWhitespace(row.attr('id'));
      if (!externalReviewId) {
        return;
      }

      const title = normalizeWhitespace(
        row.find('[data-hook="review-title"] span').last().text(),
      );
      const body = normalizeWhitespace(
        row.find('[data-hook="review-body"] span').text(),
      );
      const ratingRaw = normalizeWhitespace(
        row
          .find(
            '[data-hook="review-star-rating"] span, [data-hook="cmps-review-star-rating"] span',
          )
          .first()
          .text(),
      );
      const dateRaw = normalizeWhitespace(
        row.find('[data-hook="review-date"]').text(),
      );
      const helpfulRaw = normalizeWhitespace(
        row.find('[data-hook="helpful-vote-statement"]').text(),
      );
      const rating = extractFloat(ratingRaw);

      const authorName = normalizeWhitespace(row.find('.a-profile-name').text());
      const authorProfileHref = row.find('.a-profile').first().attr('href');

      const reviewTitleHref = row
        .find('[data-hook="review-title"]')
        .closest('a')
        .attr('href');

      if (!body || !rating) {
        return;
      }

      reviews.push({
        externalReviewId,
        reviewUrl: reviewTitleHref
          ? toAbsoluteAmazonUrl(marketplaceDomain, reviewTitleHref)
          : undefined,
        title: title || undefined,
        body,
        rating,
        languageCode: this.inferLanguageCode(dateRaw),
        authorName: authorName || undefined,
        authorProfileUrl: authorProfileHref
          ? toAbsoluteAmazonUrl(marketplaceDomain, authorProfileHref)
          : undefined,
        isVerifiedPurchase: row.find('[data-hook="avp-badge"]').length > 0,
        isVineVoice: row.find('[data-hook="vine-badge"]').length > 0,
        helpfulVotes: this.parseHelpfulVotes(helpfulRaw),
        reviewedAt: this.parseReviewDate(dateRaw),
        rawPayload: {
          ratingRaw,
          dateRaw,
          helpfulRaw,
        },
      });
    });

    return reviews;
  }

  private parseHelpfulVotes(input: string): number {
    if (!input) {
      return 0;
    }

    if (input.toLowerCase().includes('one person')) {
      return 1;
    }

    return extractInteger(input) ?? 0;
  }

  private parseReviewDate(input: string): Date {
    if (!input) {
      return new Date();
    }

    const onIndex = input.toLowerCase().lastIndexOf(' on ');
    const datePart = onIndex >= 0 ? input.slice(onIndex + 4).trim() : input;
    const parsed = new Date(datePart);

    if (Number.isNaN(parsed.getTime())) {
      return new Date();
    }

    return parsed;
  }

  private inferLanguageCode(input: string): string | undefined {
    if (!input) {
      return undefined;
    }

    const normalized = input.toLowerCase();
    if (normalized.includes('united states')) {
      return 'en-US';
    }
    if (normalized.includes('united kingdom')) {
      return 'en-GB';
    }

    return undefined;
  }

  private extractReviewCount(input: string | undefined): number | undefined {
    if (!input) {
      return undefined;
    }

    const normalized = normalizeWhitespace(input);
    if (!normalized) {
      return undefined;
    }

    const reviewTokenMatch = normalized.match(
      /([0-9][0-9,]*)\s+(?:global\s+)?reviews?/i,
    );
    if (reviewTokenMatch?.[1]) {
      return extractInteger(reviewTokenMatch[1]);
    }

    if (normalized.includes('|')) {
      const maybeReviewPart = normalized.split('|').at(-1);
      return extractInteger(maybeReviewPart);
    }

    if (normalized.toLowerCase().includes('review')) {
      return extractInteger(normalized);
    }

    return undefined;
  }
}
