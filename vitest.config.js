import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['tests/unit/**/*.test.js'],
    coverage: {
      provider: 'v8',
      include: ['js/i18n.js', 'js/util.js', 'js/github.js', 'js/tree.js', 'js/virtual.js', 'js/download.js'],
      reporter: ['text-summary', 'text'],
    },
  },
});
