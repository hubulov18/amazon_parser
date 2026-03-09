import { createHash } from 'node:crypto';

const INT4_MAX = 2_147_483_647;

export const normalizeWhitespace = (input: string | undefined | null): string =>
  (input ?? '').replace(/\s+/g, ' ').trim();

export const normalizeText = (input: string | undefined | null): string =>
  normalizeWhitespace(input).toLowerCase();

export const slugify = (input: string): string =>
  normalizeText(input)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const toCents = (priceRaw: string | undefined): number | undefined => {
  if (!priceRaw) {
    return undefined;
  }

  const compact = normalizeWhitespace(priceRaw).replace(/\s+/g, '');
  const digitsAndSeparators = compact.replace(/[^0-9.,]/g, '');
  if (!digitsAndSeparators) {
    return undefined;
  }

  const lastDot = digitsAndSeparators.lastIndexOf('.');
  const lastComma = digitsAndSeparators.lastIndexOf(',');
  const hasSeparator = lastDot !== -1 || lastComma !== -1;
  const decimalSeparator = lastDot > lastComma ? '.' : ',';

  let normalizedNumericString: string;
  if (hasSeparator) {
    const separatorIndex = digitsAndSeparators.lastIndexOf(decimalSeparator);
    const integerPart = digitsAndSeparators
      .slice(0, separatorIndex)
      .replace(/[.,]/g, '');
    const fractionRaw = digitsAndSeparators
      .slice(separatorIndex + 1)
      .replace(/[.,]/g, '');

    const hasCents = fractionRaw.length > 0 && fractionRaw.length <= 2;
    if (hasCents) {
      const normalizedInteger = integerPart || '0';
      const normalizedFraction = fractionRaw.padEnd(2, '0').slice(0, 2);
      normalizedNumericString = `${normalizedInteger}.${normalizedFraction}`;
    } else {
      normalizedNumericString = digitsAndSeparators.replace(/[.,]/g, '');
    }
  } else {
    normalizedNumericString = digitsAndSeparators;
  }

  const numeric = Number.parseFloat(normalizedNumericString);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }

  const cents = Math.round(numeric * 100);
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > INT4_MAX) {
    return undefined;
  }

  return cents;
};

export const extractInteger = (input: string | undefined): number | undefined => {
  if (!input) {
    return undefined;
  }

  const normalized = input.replace(/[^0-9]/g, '');
  if (!normalized) {
    return undefined;
  }

  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > INT4_MAX) {
    return undefined;
  }

  return parsed;
};

export const extractFloat = (input: string | undefined): number | undefined => {
  if (!input) {
    return undefined;
  }

  const match = input.replace(',', '.').match(/\d+(?:\.\d+)?/);
  if (!match) {
    return undefined;
  }

  const parsed = Number.parseFloat(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const sha1 = (value: string): string =>
  createHash('sha1').update(value).digest('hex');

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
