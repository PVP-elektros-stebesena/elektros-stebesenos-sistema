import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests share a SQLite database — run files sequentially
    // to prevent race conditions on cleanup / seeding.
    fileParallelism: false,
  },
});
