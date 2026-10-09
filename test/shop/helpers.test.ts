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

  it('are refused when none of them wrote: there was nothing to race for', async () => {
    // Two calls of one statement each, one after the other, look the same
    // as two side by side. Neither is a race.
    const once = async (database: D1Database): Promise<void> => {
      await database.prepare('SELECT 1').first();
    };

    await expect(atTheSameMoment([once, once])).rejects.toThrow(
      /no write to race for.*0\.0 1\.0/,
    );
  });

  it('take a function that reads twice before it writes, when told so', async () => {
    // Both readings sent together: the second trip of each is a reading
    // still, and comes after the other's first.
    const readsTwice = async (database: D1Database): Promise<string> => {
      await Promise.all([
        database.prepare('SELECT 1').first(),
        database.prepare('SELECT 2').first(),
      ]);
      await database.batch([database.prepare('SELECT 3')]);
      return 'done';
    };

    await expect(atTheSameMoment([readsTwice, readsTwice])).rejects.toThrow(
      /did not overlap/,
    );
    expect(
      fulfilledValues(
        await atTheSameMoment([readsTwice, readsTwice], { readings: 2 }),
      ),
    ).toEqual(['done', 'done']);
  });

  it('wait for the others when one throws before it has begun', async () => {
    let finished = false;
    const settled = await atTheSameMoment<string>([
      async (database) => {
        const answer = await readThenWrite(database);
        finished = true;
        return answer;
      },
      (() => {
        throw new Error('at once');
      }) as unknown as (database: D1Database) => Promise<string>,
      readThenWrite,
    ]).catch((error: unknown) => error);

    // The one that never went to the database is said to be late; what
    // matters here is that the first had finished by the time that was said.
    expect(String(settled)).toMatch(/did not overlap/);
    expect(finished).toBe(true);
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
