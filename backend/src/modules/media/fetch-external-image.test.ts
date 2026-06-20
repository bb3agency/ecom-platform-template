import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchExternalImageResponse } from './fetch-external-image';

describe('fetchExternalImageResponse', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects redirect hops to private networks', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { location: 'https://127.0.0.1/secret.png' }
        })
      )
    );

    await expect(
      fetchExternalImageResponse('https://cdn.example.com/start.png')
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('follows safe redirects and returns the final response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: '/final.png' }
        })
      )
      .mockResolvedValueOnce(
        new Response(Buffer.from('ok'), {
          status: 200,
          headers: { 'content-type': 'image/png' }
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const response = await fetchExternalImageResponse('https://cdn.example.com/start.png');
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
