import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DaemonLog } from './daemon-log.js';

const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true });
});

describe('DaemonLog', () => {
  it('keeps one rotated file when the size limit is reached', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'figma-daemon-log-'));
    directories.push(directory);
    const path = join(directory, 'bridge.log');
    const log = new DaemonLog(path, 120);
    await log.initialize();
    log.write({ event: 'first', value: 'a'.repeat(80) });
    log.write({ event: 'second', value: 'b'.repeat(80) });
    await log.close();

    await expect(stat(`${path}.1`)).resolves.toBeDefined();
    expect(await readFile(path, 'utf8')).toContain('second');
  });
});
