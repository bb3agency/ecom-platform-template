const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectSource } = require('./sql-injection-guard.js');

test('flags Prisma unsafe raw APIs', () => {
  const source = `
    async function run(prisma) {
      await prisma.$executeRawUnsafe('SELECT 1');
    }
  `;

  const issues = inspectSource('x.js', source);
  assert.equal(issues.some((issue) => issue.rule === 'Prisma raw-unsafe API'), true);
});

test('flags Prisma.raw usage', () => {
  const source = `
    import { Prisma } from '@prisma/client';
    const x = Prisma.raw('id desc');
  `;

  const issues = inspectSource('x.ts', source);
  assert.equal(issues.some((issue) => issue.rule === 'Prisma.raw usage'), true);
});

test('passes safe parameterized Prisma SQL', () => {
  const source = `
    async function run(prisma, id) {
      await prisma.$queryRaw\`SELECT * FROM "Order" WHERE id = \${id}\`;
    }
  `;

  const issues = inspectSource('safe.ts', source);
  assert.deepEqual(issues, []);
});
