export const DEFAULT_FEEDBACK_FORM_URL =
  'https://docs.google.com/forms/d/e/1FAIpQLSffVEZibvEzbnKWt9i2vN9KMDN3JyDQCDm_88Uq7BN_VbQjnQ/viewform';

export type FeedbackFormLink = { src: string; href: string };

export function resolveFeedbackForm(override: string | undefined): FeedbackFormLink {
  let url: URL;
  try {
    url = new URL(override?.trim() || DEFAULT_FEEDBACK_FORM_URL);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('unsupported protocol');
  } catch {
    url = new URL(DEFAULT_FEEDBACK_FORM_URL);
  }
  if (url.hostname !== 'docs.google.com' || !url.pathname.endsWith('/viewform')) {
    return { src: url.toString(), href: url.toString() };
  }
  url.searchParams.delete('usp');
  url.searchParams.delete('embedded');
  const href = url.toString();
  url.searchParams.set('embedded', 'true');
  return { src: url.toString(), href };
}

// NEXT_PUBLIC_ values are inlined at build time only when referenced literally.
export const feedbackForm = resolveFeedbackForm(process.env.NEXT_PUBLIC_FEEDBACK_FORM_URL);
