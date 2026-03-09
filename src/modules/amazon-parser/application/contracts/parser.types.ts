export interface CrawlCategoryInput {
  marketplaceCode: string;
  marketplaceDomain: string;
  categoryUrl: string;
  categorySlug: string;
  categoryName: string;
  maxProducts: number;
  maxCategoryPages: number;
  maxReviewPages: number;
  productConcurrency: number;
  reviewLookbackDays: number;
  ignoreCategoryCheckpoint: boolean;
}

export interface ParsedProductCard {
  asin: string;
  title: string;
  productUrl: string;
  imageUrl?: string;
  priceCents?: number;
  averageRating?: number;
  ratingsCount?: number;
  reviewsCount?: number;
}

export interface ParsedProductDetails {
  title?: string;
  imageUrl?: string;
  brandName?: string;
  sellerName?: string;
  sellerUrl?: string;
  priceCents?: number;
  averageRating?: number;
  ratingsCount?: number;
  reviewsCount?: number;
}

export interface ParsedReview {
  externalReviewId: string;
  reviewUrl?: string;
  title?: string;
  body: string;
  rating: number;
  languageCode?: string;
  authorName?: string;
  authorProfileUrl?: string;
  isVerifiedPurchase: boolean;
  isVineVoice: boolean;
  helpfulVotes: number;
  reviewedAt: Date;
  rawPayload: Record<string, unknown>;
}

export interface ProductReviewSyncStats {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  pagesFetched: number;
}

export interface CrawlSummary {
  crawlRunId: string;
  categorySlug: string;
  scannedProducts: number;
  parsedProducts: number;
  failedProducts: number;
  blockedSignIn: number;
  blockedChallenge: number;
  createdReviews: number;
  updatedReviews: number;
  unchangedReviews: number;
  startedAt: Date;
  finishedAt: Date;
}
