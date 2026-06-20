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
    pool: 'forks',
    env: { NODE_ENV: 'test' },
    include: ['src/**/*.test.ts', 'queues/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts', 'src/**/*.e2e.test.ts'],
    coverage: {
      enabled: true,
      provider: 'v8',
      reportsDirectory: './artifacts/coverage/unit',
      reporter: ['text-summary', 'json-summary', 'lcov'],
      thresholds: {
        lines: 43,
        functions: 47,
        branches: 37,
        statements: 43
      },
      include: [
        'src/common/**/*.ts',
        'src/modules/auth/**/*.ts',
        'src/modules/orders/**/*.ts',
        'src/modules/cart/**/*.ts',
        'src/modules/inventory/**/*.ts',
        'queues/workers/**/*.ts'
      ]
    }
  }
});
