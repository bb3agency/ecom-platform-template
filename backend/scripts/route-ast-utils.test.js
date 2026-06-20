const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFastifyRoutesFromAst, parseFastifyRouteConfigsFromAst } = require('./route-ast-utils.js');

test('parseFastifyRoutesFromAst extracts route method and path', () => {
  const routes = parseFastifyRoutesFromAst(`
    export async function register(fastify) {
      fastify.get('/api/v1/health', { schema: s }, async () => ({}));
      fastify.post('/api/v1/auth/login', { schema: s }, async () => ({}));
    }
  `);
  assert.deepEqual(routes, [
    { method: 'get', path: '/api/v1/health' },
    { method: 'post', path: '/api/v1/auth/login' }
  ]);
});

test('parseFastifyRouteConfigsFromAst extracts method path and config source', () => {
  const routes = parseFastifyRouteConfigsFromAst(`
    export async function register(fastify) {
      fastify.get('/api/v1/health', { schema: s }, async () => ({}));
      fastify.post('/api/v1/auth/login', { schema: s, preHandler: [idempotencyPreHandler] }, async () => ({}));
    }
  `);
  assert.deepEqual(routes, [
    { method: 'get', path: '/api/v1/health', configSource: '{ schema: s }' },
    { method: 'post', path: '/api/v1/auth/login', configSource: '{ schema: s, preHandler: [idempotencyPreHandler] }' }
  ]);
});
