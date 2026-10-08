import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, createContent, ensureSite, ORIGIN } from '../shop/helpers.js';

/**
 * A kind the site serves without a list page.
 *
 * A site's owner decides each kind's address. Given an empty one, a kind's
 * items sit straight under the root, as pages do, and there is no page that
 * lists them. Mallok then leaves the kind out of `site.kinds`, and every link
 * the theme makes to "the list of these" has to go with it — a link printed
 * anyway would have no address.
 */

async function page(path: string): Promise<{ status: number; html: string }> {
  const response = await SELF.fetch(`${ORIGIN}${path}`);
  return { status: response.status, html: await response.text() };
}

function between(html: string, start: string, end: string): string {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from + start.length);
  return from === -1 ? '' : html.slice(from, to === -1 ? undefined : to);
}

describe('a site with no list of products', () => {
  beforeAll(async () => {
    await ensureSite();

    const settings = await api('PATCH', '/_mallok/api/settings', {
      kinds: {
        page: { base: '' },
        article: { base: 'news' },
        product: { base: '' },
        collection: { base: 'collections' },
        application: { base: 'industries' },
        case: { base: 'case-studies' },
        faq: { base: 'faq' },
        tool: { base: 'tools' },
      },
    });
    if (!settings.ok) {
      throw new Error(`Settings were refused: ${await settings.text()}`);
    }

    await createContent({
      kind: 'collection',
      title: 'Cap screws',
      slug: 'cap-screws',
    });
    await createContent({
      kind: 'product',
      title: 'Unlisted screw',
      slug: 'unlisted-screw',
      frontmatter: [
        'collection: cap-screws',
        'facets:',
        '  Thread: M5 × 0.8',
      ].join('\n'),
    });
  });

  it('serves the product under the root', async () => {
    expect((await page('/unlisted-screw')).status).toBe(200);
  });

  it('shows the finder on the home page, and no link to a catalogue that is not there', async () => {
    const { status, html } = await page('/');
    const finder = between(html, 'id="specification-finder"', '</section>');

    expect(status).toBe(200);
    expect(finder).toContain('href="/unlisted-screw"');
    expect(finder).not.toContain('class="finder-more"');
    expect(html).not.toMatch(/href=""/);
  });

  it('leads the product’s breadcrumb from home to its collection, with no step between', async () => {
    const { html } = await page('/unlisted-screw');
    const crumbs = between(html, '<nav class="crumbs"', '</nav>');
    const links = [...crumbs.matchAll(/<a href="([^"]*)">([^<]*)<\/a>/g)].map(
      (match) => `${match[1]} ${match[2]}`,
    );

    expect(links).toEqual(['/ Home', '/collections/cap-screws Cap screws']);
    expect(html).not.toMatch(/href=""/);
  });

  it('still leads a kind that has a list through it', async () => {
    const { html } = await page('/collections/cap-screws');

    expect(between(html, '<nav class="crumbs"', '</nav>')).toContain(
      '<a href="/collections">Product types</a>',
    );
  });
});
