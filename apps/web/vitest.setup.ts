/**
 * Point the decision log somewhere disposable.
 *
 * Several of these tests write decisions, and demo reset deletes the log. Left
 * on the default path a test run would quietly wipe whatever a planner had
 * recorded locally — so every worker gets its own file under the OS temp
 * directory, and none of them can reach the real one.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll } from 'vitest';

let directory: string;

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'mrp-decisions-'));
  process.env.MRP_EVENT_LOG = join(directory, 'decisions.jsonl');
});

afterAll(() => {
  if (directory) rmSync(directory, { recursive: true, force: true });
});
