import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 60000,
    hookTimeout: 90000,
    fileParallelism: false,
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    globals: true,
  },
});
