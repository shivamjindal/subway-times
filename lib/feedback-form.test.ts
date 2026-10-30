import { describe, expect, it } from 'vitest';
import { resolveFeedbackForm } from './feedback-form';

const FORM = 'https://docs.google.com/forms/d/e/1FAIpQLSffVEZibvEzbnKWt9i2vN9KMDN3JyDQCDm_88Uq7BN_VbQjnQ/viewform';
const defaults = { src: `${FORM}?embedded=true`, href: FORM };

describe('resolveFeedbackForm', () => {
  it("embeds the user's form when the override is missing or not http(s)", () => {
    expect(resolveFeedbackForm(undefined)).toEqual(defaults);
    expect(resolveFeedbackForm('  ')).toEqual(defaults);
    expect(resolveFeedbackForm('javascript:alert(1)')).toEqual(defaults);
  });

  it('drops usp and normalizes embedded on a pasted viewform URL', () => {
    expect(resolveFeedbackForm(`${FORM}?usp=preview`)).toEqual(defaults);
    expect(resolveFeedbackForm(`${FORM}?embedded=true&usp=sf_link`)).toEqual(defaults);
  });

  it('uses any other http(s) URL as is', () => {
    const stub = 'http://127.0.0.1:4010/form';
    expect(resolveFeedbackForm(stub)).toEqual({ src: stub, href: stub });
  });
});
