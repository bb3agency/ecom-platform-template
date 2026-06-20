import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@modules': '/src/modules',
      '@common': '/src/common',
      '@config': '/src/config',
      '@queues': '/queues'
    }
  },
  test: {
    environment: 'node',
    pool: 'vmForks',
    include: ['src/**/*.security.test.ts'],
    coverage: {
      enabled: false
    }
  }
});
