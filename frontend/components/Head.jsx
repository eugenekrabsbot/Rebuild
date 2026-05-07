import NextHead from 'next/head';
import { getPageMeta, defaultMeta } from '../lib/seo';

export default function Head({ page, title, description, children }) {
  // Get metadata from page key or use provided title/description
  const meta = page ? getPageMeta(page) : { title, description };
  const finalTitle = meta.title || defaultMeta.title;
  const finalDescription = meta.description || defaultMeta.description;

  return (
    <NextHead>
      <title>{finalTitle}</title>
      <meta name="description" content={finalDescription} />
      {meta.keywords && <meta name="keywords" content={meta.keywords} />}

      {/* Open Graph */}
      <meta property="og:title" content={finalTitle} />
      <meta property="og:description" content={finalDescription} />
      <meta property="og:url" content={defaultMeta.url} />
      <meta property="og:image" content={defaultMeta.image} />

      {/* Twitter Card */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:site" content="@AhoyVPN" />
      <meta name="twitter:title" content={finalTitle} />
      <meta name="twitter:description" content={finalDescription} />
      <meta name="twitter:image" content={defaultMeta.image} />

      {/* Canonical */}
      <link rel="canonical" href={defaultMeta.url} />

      {children}
    </NextHead>
  );
}
