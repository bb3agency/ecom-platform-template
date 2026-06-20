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
    include: ['src/**/*.integration.test.ts', 'src/**/*.e2e.test.ts']
  }
});
