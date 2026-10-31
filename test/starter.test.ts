import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { renderStarterDocuments } from '../scripts/starter-documents.mjs';

/**
 * The starter's list of documents is generated from `content/`. A bundle
 * added, renamed or translated there is in the starter only once the list is
 * written again.
 */
describe('the starter’s documents', () => {
  it('are every bundle in content/, as the generator writes them now', async () => {
    const written = await readFile(
      new URL('../src/starter/documents.generated.ts', import.meta.url),
      'utf8',
    );

    assert.equal(
      written,
      await renderStarterDocuments(),
      'run `node scripts/starter-documents.mjs` after changing content/',
    );
  });
});
