-- CreateEnum
CREATE TYPE "CrawlRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'PARTIAL');

-- CreateEnum
CREATE TYPE "CrawlItemStatus" AS ENUM ('SUCCESS', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "CrawlSourceScope" AS ENUM ('CATEGORY', 'PRODUCT', 'REVIEWS');

-- CreateTable
CREATE TABLE "Marketplace" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Marketplace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "marketplaceId" TEXT NOT NULL,
    "externalId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "sourceUrl" TEXT,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Seller" (
    "id" TEXT NOT NULL,
    "marketplaceId" TEXT NOT NULL,
    "externalSellerId" TEXT,
    "displayName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "sellerUrl" TEXT,
    "rating" DOUBLE PRECISION,
    "ratingsCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Seller_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "marketplaceId" TEXT NOT NULL,
    "asin" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "normalizedTitle" TEXT NOT NULL,
    "productUrl" TEXT NOT NULL,
    "imageUrl" TEXT,
    "priceCents" INTEGER,
    "currencyCode" TEXT,
    "averageRating" DOUBLE PRECISION,
    "ratingsCount" INTEGER,
    "reviewsCount" INTEGER,
    "brandId" TEXT,
    "detailFingerprint" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReviewCrawlAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCategory" (
    "productId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "rankInCategory" INTEGER,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("productId","categoryId")
);

-- CreateTable
CREATE TABLE "ProductSeller" (
    "productId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "offerListingId" TEXT,
    "priceCents" INTEGER,
    "isBuyBox" BOOLEAN NOT NULL DEFAULT false,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductSeller_pkey" PRIMARY KEY ("productId","sellerId")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" BIGSERIAL NOT NULL,
    "marketplaceId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "externalReviewId" TEXT NOT NULL,
    "reviewUrl" TEXT,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL,
    "languageCode" TEXT,
    "authorName" TEXT,
    "authorProfileUrl" TEXT,
    "isVerifiedPurchase" BOOLEAN NOT NULL DEFAULT false,
    "isVineVoice" BOOLEAN NOT NULL DEFAULT false,
    "helpfulVotes" INTEGER NOT NULL DEFAULT 0,
    "reviewedAt" TIMESTAMP(3) NOT NULL,
    "scrapedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contentFingerprint" TEXT NOT NULL,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrawlRun" (
    "id" TEXT NOT NULL,
    "marketplaceId" TEXT NOT NULL,
    "sourceScope" "CrawlSourceScope" NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "status" "CrawlRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "metrics" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrawlRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrawlRunItem" (
    "id" TEXT NOT NULL,
    "crawlRunId" TEXT NOT NULL,
    "status" "CrawlItemStatus" NOT NULL,
    "stage" TEXT NOT NULL,
    "message" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "productId" TEXT,
    "reviewId" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrawlRunItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncCheckpoint" (
    "id" TEXT NOT NULL,
    "marketplaceId" TEXT NOT NULL,
    "scope" "CrawlSourceScope" NOT NULL,
    "scopeRef" TEXT NOT NULL,
    "checkpointTime" TIMESTAMP(3),
    "checkpointToken" TEXT,
    "categoryId" TEXT,
    "productId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Marketplace_code_key" ON "Marketplace"("code");

-- CreateIndex
CREATE INDEX "Category_marketplaceId_parentId_idx" ON "Category"("marketplaceId", "parentId");

-- CreateIndex
CREATE INDEX "Category_marketplaceId_path_idx" ON "Category"("marketplaceId", "path");

-- CreateIndex
CREATE INDEX "Category_marketplaceId_externalId_idx" ON "Category"("marketplaceId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Category_marketplaceId_slug_key" ON "Category"("marketplaceId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_normalizedName_key" ON "Brand"("normalizedName");

-- CreateIndex
CREATE INDEX "Seller_marketplaceId_rating_idx" ON "Seller"("marketplaceId", "rating");

-- CreateIndex
CREATE UNIQUE INDEX "Seller_marketplaceId_normalizedName_key" ON "Seller"("marketplaceId", "normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "Seller_marketplaceId_externalSellerId_key" ON "Seller"("marketplaceId", "externalSellerId");

-- CreateIndex
CREATE INDEX "Product_marketplaceId_reviewsCount_idx" ON "Product"("marketplaceId", "reviewsCount");

-- CreateIndex
CREATE INDEX "Product_marketplaceId_averageRating_idx" ON "Product"("marketplaceId", "averageRating");

-- CreateIndex
CREATE INDEX "Product_brandId_idx" ON "Product"("brandId");

-- CreateIndex
CREATE INDEX "Product_lastReviewCrawlAt_idx" ON "Product"("lastReviewCrawlAt");

-- CreateIndex
CREATE INDEX "Product_lastSeenAt_idx" ON "Product"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "Product_marketplaceId_asin_key" ON "Product"("marketplaceId", "asin");

-- CreateIndex
CREATE INDEX "ProductCategory_categoryId_rankInCategory_idx" ON "ProductCategory"("categoryId", "rankInCategory");

-- CreateIndex
CREATE INDEX "ProductCategory_capturedAt_idx" ON "ProductCategory"("capturedAt");

-- CreateIndex
CREATE INDEX "ProductSeller_sellerId_lastSeenAt_idx" ON "ProductSeller"("sellerId", "lastSeenAt");

-- CreateIndex
CREATE INDEX "ProductSeller_offerListingId_idx" ON "ProductSeller"("offerListingId");

-- CreateIndex
CREATE INDEX "Review_productId_reviewedAt_idx" ON "Review"("productId", "reviewedAt");

-- CreateIndex
CREATE INDEX "Review_productId_lastSeenAt_idx" ON "Review"("productId", "lastSeenAt");

-- CreateIndex
CREATE INDEX "Review_reviewedAt_idx" ON "Review"("reviewedAt");

-- CreateIndex
CREATE INDEX "Review_helpfulVotes_idx" ON "Review"("helpfulVotes");

-- CreateIndex
CREATE UNIQUE INDEX "Review_marketplaceId_externalReviewId_key" ON "Review"("marketplaceId", "externalReviewId");

-- CreateIndex
CREATE INDEX "CrawlRun_marketplaceId_startedAt_idx" ON "CrawlRun"("marketplaceId", "startedAt");

-- CreateIndex
CREATE INDEX "CrawlRun_status_startedAt_idx" ON "CrawlRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "CrawlRunItem_crawlRunId_stage_idx" ON "CrawlRunItem"("crawlRunId", "stage");

-- CreateIndex
CREATE INDEX "CrawlRunItem_productId_createdAt_idx" ON "CrawlRunItem"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "CrawlRunItem_reviewId_idx" ON "CrawlRunItem"("reviewId");

-- CreateIndex
CREATE INDEX "SyncCheckpoint_scope_checkpointTime_idx" ON "SyncCheckpoint"("scope", "checkpointTime");

-- CreateIndex
CREATE INDEX "SyncCheckpoint_productId_idx" ON "SyncCheckpoint"("productId");

-- CreateIndex
CREATE INDEX "SyncCheckpoint_categoryId_idx" ON "SyncCheckpoint"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "SyncCheckpoint_marketplaceId_scope_scopeRef_key" ON "SyncCheckpoint"("marketplaceId", "scope", "scopeRef");

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_marketplaceId_fkey" FOREIGN KEY ("marketplaceId") REFERENCES "Marketplace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Seller" ADD CONSTRAINT "Seller_marketplaceId_fkey" FOREIGN KEY ("marketplaceId") REFERENCES "Marketplace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_marketplaceId_fkey" FOREIGN KEY ("marketplaceId") REFERENCES "Marketplace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSeller" ADD CONSTRAINT "ProductSeller_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSeller" ADD CONSTRAINT "ProductSeller_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_marketplaceId_fkey" FOREIGN KEY ("marketplaceId") REFERENCES "Marketplace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlRun" ADD CONSTRAINT "CrawlRun_marketplaceId_fkey" FOREIGN KEY ("marketplaceId") REFERENCES "Marketplace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlRunItem" ADD CONSTRAINT "CrawlRunItem_crawlRunId_fkey" FOREIGN KEY ("crawlRunId") REFERENCES "CrawlRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlRunItem" ADD CONSTRAINT "CrawlRunItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlRunItem" ADD CONSTRAINT "CrawlRunItem_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncCheckpoint" ADD CONSTRAINT "SyncCheckpoint_marketplaceId_fkey" FOREIGN KEY ("marketplaceId") REFERENCES "Marketplace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncCheckpoint" ADD CONSTRAINT "SyncCheckpoint_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncCheckpoint" ADD CONSTRAINT "SyncCheckpoint_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
