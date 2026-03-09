import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from 'src/app.module';
import { CrawlCategoryInput } from './application/contracts/parser.types';
import { AmazonCrawlerService } from './application/use-cases/amazon-crawler.service';

const parseBooleanArg = (value: string): boolean | null => {
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return null;
};

const parseArgs = (argv: string[]): Partial<CrawlCategoryInput> => {
  const overrides: Partial<CrawlCategoryInput> = {};

  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      continue;
    }

    const [rawKey, ...urlValues] = arg.slice(2).split('=');
    const rawValue = urlValues.join('=').trim();
    if (!rawKey || !rawValue) {
      continue;
    }

    switch (rawKey) {
      case 'marketplaceCode':
        overrides.marketplaceCode = rawValue;
        break;
      case 'marketplaceDomain':
        overrides.marketplaceDomain = rawValue;
        break;
      case 'categoryUrl':
        overrides.categoryUrl = rawValue;
        break;
      case 'categorySlug':
        overrides.categorySlug = rawValue;
        break;
      case 'categoryName':
        overrides.categoryName = rawValue;
        break;
      case 'maxProducts':
        overrides.maxProducts = Number.parseInt(rawValue, 10);
        break;
      case 'maxCategoryPages':
        overrides.maxCategoryPages = Number.parseInt(rawValue, 10);
        break;
      case 'maxReviewPages':
        overrides.maxReviewPages = Number.parseInt(rawValue, 10);
        break;
      case 'productConcurrency':
        overrides.productConcurrency = Number.parseInt(rawValue, 10);
        break;
      case 'reviewLookbackDays':
        overrides.reviewLookbackDays = Number.parseInt(rawValue, 10);
        break;
      case 'ignoreCheckpoint': {
        const parsed = parseBooleanArg(rawValue);
        if (parsed !== null) {
          overrides.ignoreCategoryCheckpoint = parsed;
        }
        break;
      }
      default:
        break;
    }
  }

  return overrides;
};

async function bootstrap(): Promise<void> {
  const logger = new Logger('CategoryCrawlCLI');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const overrides = parseArgs(process.argv.slice(2));
    const crawler = app.get(AmazonCrawlerService);

    const summary = await crawler.crawlCategory(overrides);
    logger.log(`Crawl finished: ${JSON.stringify(summary)}`);
  } finally {
    await app.close();
  }
}

void bootstrap();
