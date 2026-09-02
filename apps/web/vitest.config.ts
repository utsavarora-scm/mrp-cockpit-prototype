/**
 * Tests for the app's own composition.
 *
 * The engines are tested against hand-built fixtures, which is right and is not
 * enough: the worked examples reach a screen through the data pack, the run
 * context and a projection module, and every one of those is a place the
 * numbers can quietly stop being the numbers. A fixture that is correct beside
 * an app that is fed something else is exactly how the packaging hero came to
 * open on 300,837 pieces while its unit test opened on 260,000.
 *
 * Node environment: everything under `lib/server` is server-only and pure.
 */

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = fileURLToPath(new URL('.', import.meta.url));
const packages = fileURLToPath(new URL('../../packages', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@/': `${here}`,
      '@repo/domain': `${packages}/domain/src/index.ts`,
      '@repo/planning-engine': `${packages}/planning-engine/src/index.ts`,
      '@repo/data-packs': `${packages}/data-packs/src/index.ts`,
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['lib/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 60_000,
  },
});
