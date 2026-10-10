import {createRequire} from 'node:module';
import {describe, expect, it} from 'vitest';
const require = createRequire(import.meta.url);
const {matchesReadyServer} = require('../../scripts/launch-electron.cjs') as {
  matchesReadyServer(value: unknown, projectRoot: string, launchedAt: number): boolean;
};

describe('desktop development startup', () => {
  const root = '/project/desktop';
  const now = 100_000;
  it('accepts the project Vite started with the same dev invocation', () => {
    expect(
      matchesReadyServer({app: 'interview-desktop', root, startedAt: now - 1000}, root, now),
    ).toBe(true);
  });
  it('rejects a previous preview even when its port and project match', () => {
    expect(
      matchesReadyServer({app: 'interview-desktop', root, startedAt: now - 6000}, root, now),
    ).toBe(false);
  });
  it('rejects another application, checkout, or malformed readiness response', () => {
    for (const value of [
      null,
      {},
      {app: 'other', root, startedAt: now},
      {app: 'interview-desktop', root: '/another/project', startedAt: now},
      {app: 'interview-desktop', root, startedAt: '100000'},
    ]) {
      expect(matchesReadyServer(value, root, now)).toBe(false);
    }
  });
});
