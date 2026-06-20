import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { registerResponseEnvelopeHook } from './response-envelope.hook';

describe('response envelope hook', () => {
  it('wraps plain success payloads in { success, data }', async () => {
    const app = Fastify();
    await registerResponseEnvelopeHook(app);

    app.get('/plain', async () => ({ hello: 'world' }));

    const response = await app.inject({ method: 'GET', url: '/plain' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.json()).toEqual({
      success: true,
      data: { hello: 'world' }
    });

    await app.close();
  });

  it('keeps already wrapped payloads unchanged', async () => {
    const app = Fastify();
    await registerResponseEnvelopeHook(app);

    app.get('/wrapped', async () => ({ success: true, data: { ok: true } }));

    const response = await app.inject({ method: 'GET', url: '/wrapped' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true, data: { ok: true } });

    await app.close();
  });

  it('extracts pagination meta and returns items as data', async () => {
    const app = Fastify();
    await registerResponseEnvelopeHook(app);

    app.get('/paged', async () => ({
      items: [{ id: 1 }, { id: 2 }],
      meta: {
        page: 1,
        limit: 20,
        total: 2,
        totalPages: 1
      }
    }));

    const response = await app.inject({ method: 'GET', url: '/paged' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: [{ id: 1 }, { id: 2 }],
      meta: {
        page: 1,
        limit: 20,
        total: 2,
        totalPages: 1
      }
    });

    await app.close();
  });

  it('does not wrap non-json responses', async () => {
    const app = Fastify();
    await registerResponseEnvelopeHook(app);

    app.get('/text', async (_request, reply) => {
      reply.type('text/plain');
      return 'ok';
    });

    const response = await app.inject({ method: 'GET', url: '/text' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('ok');

    await app.close();
  });
});
