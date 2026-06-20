import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./products.service', () => {
  class MockProductsService {
    constructor(_fastify: unknown) {}
  }

  return { ProductsService: MockProductsService };
});

import { registerProductsRoutes } from './products.routes';

describe('products routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers public and admin product routes with schema and guards', async () => {
    const app = Fastify();

    const routes: Array<{ method: string | string[]; url: string; schema?: unknown; preHandler?: unknown }> = [];
    app.addHook('onRoute', (routeOptions) => {
      routes.push({
        method: routeOptions.method,
        url: routeOptions.url,
        schema: routeOptions.schema,
        preHandler: routeOptions.preHandler
      });
    });

    await registerProductsRoutes(app);

    const listProducts = routes.find((route) => route.url === '/api/v1/products' && route.method === 'GET');
    expect(listProducts).toBeDefined();
    expect((listProducts?.schema as { response?: Record<number, unknown> }).response?.[200]).toBeDefined();

    const adminListProducts = routes.find((route) => route.url === '/api/v1/admin/products' && route.method === 'GET');
    expect(adminListProducts).toBeDefined();
    expect(adminListProducts?.preHandler).toBeDefined();

    const adminCreateProduct = routes.find((route) => route.url === '/api/v1/admin/products' && route.method === 'POST');
    expect(adminCreateProduct).toBeDefined();
    expect((adminCreateProduct?.schema as { body?: unknown }).body).toBeDefined();

    const adminImportCsv = routes.find((route) => route.url === '/api/v1/admin/products/import-csv' && route.method === 'POST');
    expect(adminImportCsv).toBeDefined();
    expect(adminImportCsv?.preHandler).toBeDefined();

    const adminCategories = routes.find((route) => route.url === '/api/v1/admin/categories' && route.method === 'GET');
    expect(adminCategories).toBeDefined();
    expect(adminCategories?.preHandler).toBeDefined();

    const adminGetProductById = routes.find((route) => route.url === '/api/v1/admin/products/:id' && route.method === 'GET');
    expect(adminGetProductById).toBeDefined();
    expect(adminGetProductById?.preHandler).toBeDefined();

    const adminUpdateProduct = routes.find((route) => route.url === '/api/v1/admin/products/:id' && route.method === 'PATCH');
    expect(adminUpdateProduct).toBeDefined();
    expect(adminUpdateProduct?.preHandler).toBeDefined();

    const adminDeleteProduct = routes.find((route) => route.url === '/api/v1/admin/products/:id' && route.method === 'DELETE');
    expect(adminDeleteProduct).toBeDefined();
    expect(adminDeleteProduct?.preHandler).toBeDefined();

    const adminHardDeleteProduct = routes.find((route) => route.url === '/api/v1/admin/products/:id/permanent' && route.method === 'DELETE');
    expect(adminHardDeleteProduct).toBeDefined();
    expect(adminHardDeleteProduct?.preHandler).toBeDefined();

    const adminCreateVariant = routes.find((route) => route.url === '/api/v1/admin/products/:id/variants' && route.method === 'POST');
    expect(adminCreateVariant).toBeDefined();
    expect(adminCreateVariant?.preHandler).toBeDefined();

    const adminUpdateVariant = routes.find((route) => route.url === '/api/v1/admin/products/:id/variants/:variantId' && route.method === 'PATCH');
    expect(adminUpdateVariant).toBeDefined();
    expect(adminUpdateVariant?.preHandler).toBeDefined();

    const adminDeleteVariant = routes.find((route) => route.url === '/api/v1/admin/products/:id/variants/:variantId' && route.method === 'DELETE');
    expect(adminDeleteVariant).toBeDefined();
    expect(adminDeleteVariant?.preHandler).toBeDefined();

    const adminCreateImage = routes.find((route) => route.url === '/api/v1/admin/products/:id/images' && route.method === 'POST');
    expect(adminCreateImage).toBeDefined();
    expect(adminCreateImage?.preHandler).toBeDefined();

    const adminUploadImage = routes.find(
      (route) => route.url === '/api/v1/admin/products/:id/images/upload' && route.method === 'POST'
    );
    expect(adminUploadImage).toBeDefined();
    expect(adminUploadImage?.preHandler).toBeDefined();

    const adminReorderImages = routes.find((route) => route.url === '/api/v1/admin/products/:id/images/reorder' && route.method === 'PATCH');
    expect(adminReorderImages).toBeDefined();
    expect(adminReorderImages?.preHandler).toBeDefined();

    const adminDeleteImage = routes.find((route) => route.url === '/api/v1/admin/products/:id/images/:imageId' && route.method === 'DELETE');
    expect(adminDeleteImage).toBeDefined();
    expect(adminDeleteImage?.preHandler).toBeDefined();

    const adminCreateCategory = routes.find((route) => route.url === '/api/v1/admin/categories' && route.method === 'POST');
    expect(adminCreateCategory).toBeDefined();
    expect(adminCreateCategory?.preHandler).toBeDefined();

    const adminUpdateCategory = routes.find((route) => route.url === '/api/v1/admin/categories/:id' && route.method === 'PATCH');
    expect(adminUpdateCategory).toBeDefined();
    expect(adminUpdateCategory?.preHandler).toBeDefined();

    const adminGetCategoryById = routes.find((route) => route.url === '/api/v1/admin/categories/:id' && route.method === 'GET');
    expect(adminGetCategoryById).toBeDefined();
    expect(adminGetCategoryById?.preHandler).toBeDefined();

    const adminDeleteCategory = routes.find((route) => route.url === '/api/v1/admin/categories/:id' && route.method === 'DELETE');
    expect(adminDeleteCategory).toBeDefined();
    expect(adminDeleteCategory?.preHandler).toBeDefined();

    await app.close();
  });

  it('has idempotencyPreHandler on all admin write routes', async () => {
    const app = Fastify();

    const routes: Array<{ method: string | string[]; url: string; preHandler?: unknown[] | undefined }> = [];
    app.addHook('onRoute', (routeOptions) => {
      routes.push({
        method: routeOptions.method,
        url: routeOptions.url,
        preHandler: routeOptions.preHandler as unknown[] | undefined
      });
    });

    await registerProductsRoutes(app);

    const writeRoutes = [
      { method: 'POST', url: '/api/v1/admin/products' },
      { method: 'PATCH', url: '/api/v1/admin/products/:id' },
      { method: 'DELETE', url: '/api/v1/admin/products/:id' },
      { method: 'POST', url: '/api/v1/admin/products/:id/variants' },
      { method: 'PATCH', url: '/api/v1/admin/products/:id/variants/:variantId' },
      { method: 'DELETE', url: '/api/v1/admin/products/:id/variants/:variantId' },
      { method: 'POST', url: '/api/v1/admin/products/:id/images' },
      { method: 'POST', url: '/api/v1/admin/products/:id/images/upload' },
      { method: 'PATCH', url: '/api/v1/admin/products/:id/images/reorder' },
      { method: 'DELETE', url: '/api/v1/admin/products/:id/images/:imageId' },
      { method: 'POST', url: '/api/v1/admin/products/import-csv' },
      { method: 'POST', url: '/api/v1/admin/categories' },
      { method: 'PATCH', url: '/api/v1/admin/categories/:id' },
      { method: 'DELETE', url: '/api/v1/admin/categories/:id' }
    ];

    for (const { method, url } of writeRoutes) {
      const route = routes.find((r) => r.url === url && r.method === method);
      expect(route, `route ${method} ${url} not found`).toBeDefined();
      const handlers = route?.preHandler ?? [];
      expect(handlers.length, `${method} ${url} should have ≥4 preHandlers`).toBeGreaterThanOrEqual(4);
    }

    await app.close();
  });
});
