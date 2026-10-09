import { beforeAll, describe, expect, it } from 'vitest';
import { atTheSameMoment, db, ensureSite, fulfilledValues } from './helpers.js';

/**
 * The helper the tests of a race stand on, tested itself: a check that the
 * calls overlapped is worth nothing unless it fails when they did not.
 */
describe('calls made at the same moment', () => {
  beforeAll(ensureSite);

  /** Reads, then writes: the shape of everything a race is tested on. */
  const readThenWrite = async (database: D1Database): Promise<string> => {
    await database.prepare('SELECT 1').first();
    await database.batch([database.prepare('SELECT 2')]);
    return 'done';
  };

  it('are let through when each has read before any writes', async () => {
    const settled = await atTheSameMoment([readThenWrite, readThenWrite]);

    expect(fulfilledValues(settled)).toEqual(['done', 'done']);
  });

  it('are refused when one had finished before another began', async () => {
    // The second waits on the database, with a database that is not the one
    // it was given, before its own reading: a sequence dressed as a race.
    const late = async (database: D1Database): Promise<string> => {
      await db().prepare('SELECT 0').first();
      await db().prepare('SELECT 0').first();
      return readThenWrite(database);
    };

    await expect(atTheSameMoment([readThenWrite, late])).rejects.toThrow(
      /did not overlap.*0\.0 0\.1 1\.0 1\.1/,
    );
  });

  it('are refused when one never went to the database it was given', async () => {
    await expect(
      atTheSameMoment([readThenWrite, async () => 'elsewhere']),
    ).rejects.toThrow(/did not overlap/);
  });

  it('hand back a call that failed as failed, and say so when none may', async () => {
    const settled = await atTheSameMoment<string>([
      readThenWrite,
      async (database) => {
        await database.prepare('SELECT 1').first();
        throw new Error('refused');
      },
    ]);

    expect(settled.map((result) => result.status)).toEqual([
      'fulfilled',
      'rejected',
    ]);
    expect(() => fulfilledValues(settled)).toThrow('refused');
  });
});
