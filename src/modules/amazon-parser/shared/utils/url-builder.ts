export const buildAmazonProductUrl = (domain: string, asin: string): string =>
  `https://${domain}/dp/${asin}`;

export const buildAmazonReviewUrl = (
  domain: string,
  asin: string,
  page: number,
): string => {
  const url = new URL(`https://${domain}/product-reviews/${asin}`);
  url.searchParams.set('pageNumber', String(page));
  url.searchParams.set('sortBy', 'recent');
  return url.toString();
};

export const toAbsoluteAmazonUrl = (domain: string, href: string): string => {
  if (href.startsWith('http://') || href.startsWith('https://')) {
    return href;
  }

  return `https://${domain}${href.startsWith('/') ? '' : '/'}${href}`;
};
