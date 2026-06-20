#!/usr/bin/env node

/**
 * Flash-Sale Fixture Seeder
 *
 * Seeds deterministic product + variant rows into the database and writes
 * the variant IDs to a `.env.flash-sale-fixtures` file that can be sourced
 * before running flash-sale stress tests.
 *
 * Usage:
 *   node scripts/seed-flash-sale-fixtures.js
 *
 * Reads DATABASE_URL from the environment (or .env via dotenv).
 * Idempotent — re-running upserts the same rows.
 *
 * Output:
 *   - artifacts/flash-sale/fixtures.json        — machine-readable fixture IDs
 *   - artifacts/flash-sale/.env.fixtures         — sourceable env overrides
 *   - stdout summary
 */

const { randomUUID } = require('crypto');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('./lib/logger');

// ── Deterministic UUIDs for idempotent seeding ──────────────────────────────
// These are fixed UUIDs so re-runs always upsert the same rows.
const FIXTURES = [
  {
    productId: 'f1a00000-0000-4000-8000-000000000001',
    productName: 'Flash Sale — Limited Edition Sneaker',
    sku: 'FLASH-SNKR-001',
    variants: [
      {
        variantId: 'f1a00000-0000-4000-8000-0000000000a1',
        sku: 'FLASH-SNKR-001-S',
        name: 'Size S',
        pricePaise: 299900,
        stock: 50
      },
      {
        variantId: 'f1a00000-0000-4000-8000-0000000000a2',
        sku: 'FLASH-SNKR-001-M',
        name: 'Size M',
        pricePaise: 299900,
        stock: 100
      }
    ]
  },
  {
    productId: 'f1a00000-0000-4000-8000-000000000002',
    productName: 'Flash Sale — Collector Watch',
    sku: 'FLASH-WTCH-001',
    variants: [
      {
        variantId: 'f1a00000-0000-4000-8000-0000000000b1',
        sku: 'FLASH-WTCH-001-BLK',
        name: 'Black',
        pricePaise: 1499900,
        stock: 25
      },
      {
        variantId: 'f1a00000-0000-4000-8000-0000000000b2',
        sku: 'FLASH-WTCH-001-SLV',
        name: 'Silver',
        pricePaise: 1599900,
        stock: 25
      }
    ]
  }
];

const FLASH_CATEGORY_ID = 'f1a00000-0000-4000-8000-00000000c001';

function getAllVariantIds() {
  return FIXTURES.flatMap((p) => p.variants.map((v) => v.variantId));
}

function loadDatabaseUrlFromDotEnv() {
  try {
    const envPath = path.join(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return undefined;
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      if (!trimmed.startsWith('DATABASE_URL=')) continue;
      return trimmed.slice('DATABASE_URL='.length).trim();
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function main() {
  // ── 1. Check DATABASE_URL ──────────────────────────────────────────────
  const databaseUrl = process.env.DATABASE_URL || loadDatabaseUrlFromDotEnv();
  if (!databaseUrl) {
    logger.error('DATABASE_URL is not set. Cannot seed fixtures.');
    process.exit(1);
  }
  process.env.DATABASE_URL = databaseUrl;

  logger.section('Flash-Sale Fixture Seeder');

  // ── 2. Generate Prisma client if needed ────────────────────────────────
  try {
    execSync('npx prisma generate', { stdio: 'pipe' });
  } catch {
    logger.warn('prisma generate failed — assuming client already exists');
  }

  // ── 3. Seed using raw SQL for portability ──────────────────────────────
  let prisma;
  try {
    const { PrismaClient } = require('@prisma/client');
    prisma = new PrismaClient();
    await prisma.$connect();
  } catch (error) {
    logger.error('Failed to connect to database', { error: error.message });
    logger.info('Writing fixture IDs anyway (for CI env-file usage)...');
    writeArtifacts();
    process.exit(0);
  }

  try {
    await prisma.$executeRaw`
      INSERT INTO "Category" (id, name, slug, "isActive", "createdAt", "updatedAt")
      VALUES (${FLASH_CATEGORY_ID}, ${'Flash Sale'}, ${'flash-sale'}, true, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE
      SET
        name = EXCLUDED.name,
        slug = EXCLUDED.slug,
        "isActive" = true,
        "updatedAt" = NOW()
    `;

    for (const product of FIXTURES) {
      // Upsert product
      await prisma.$executeRaw`
        INSERT INTO "Product" (id, name, description, slug, "categoryId", tags, "isActive", "isFeatured", "createdAt", "updatedAt")
        VALUES (
          ${product.productId},
          ${product.productName},
          ${`Fixture product for flash-sale stress testing. SKU: ${product.sku}`},
          ${product.sku.toLowerCase()},
          ${FLASH_CATEGORY_ID},
          ARRAY['flash-sale','stress-test']::text[],
          true,
          false,
          NOW(),
          NOW()
        )
        ON CONFLICT (id) DO UPDATE
        SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          slug = EXCLUDED.slug,
          "categoryId" = EXCLUDED."categoryId",
          tags = EXCLUDED.tags,
          "isActive" = true,
          "isFeatured" = false,
          "updatedAt" = NOW()
      `;

      for (const variant of product.variants) {
        // Upsert variant
        await prisma.$executeRaw`
          INSERT INTO "ProductVariant" (id, "productId", sku, name, price, "isActive", "createdAt", "updatedAt")
          VALUES (
            ${variant.variantId},
            ${product.productId},
            ${variant.sku},
            ${variant.name},
            ${variant.pricePaise},
            true,
            NOW(),
            NOW()
          )
          ON CONFLICT (id) DO UPDATE
          SET
            sku = EXCLUDED.sku,
            name = EXCLUDED.name,
            price = EXCLUDED.price,
            "isActive" = true,
            "updatedAt" = NOW()
        `;

        // Upsert inventory so cart-service availability checks can pass in API stress mode.
        await prisma.$executeRaw`
          INSERT INTO "Inventory" (id, "variantId", quantity, "lowStockThreshold", "lowStockAlerted", "updatedAt")
          VALUES (${randomUUID()}, ${variant.variantId}, ${variant.stock}, 5, false, NOW())
          ON CONFLICT ("variantId") DO UPDATE
          SET
            quantity = EXCLUDED.quantity,
            "updatedAt" = NOW()
        `;
      }

      logger.success(product.productName);
      for (const v of product.variants) {
        logger.info(`  └─ ${v.name}: ${v.variantId} (stock: ${v.stock})`);
      }
    }

    logger.success('All fixtures seeded successfully.');
  } catch (error) {
    logger.error('Database seeding failed', { error: error.message });
    logger.info('Writing fixture IDs for env-file usage...');
  } finally {
    await prisma.$disconnect();
  }

  // ── 4. Write artifacts ─────────────────────────────────────────────────
  writeArtifacts();
}

function writeArtifacts() {
  const variantIds = getAllVariantIds();
  const outputDir = path.join(process.cwd(), 'artifacts', 'flash-sale');
  fs.mkdirSync(outputDir, { recursive: true });

  logger.section('Artifact Generation');

  // Machine-readable JSON
  const fixturesJson = {
    timestamp: new Date().toISOString(),
    products: FIXTURES.map((p) => ({
      productId: p.productId,
      name: p.productName,
      sku: p.sku,
      variants: p.variants.map((v) => ({
        variantId: v.variantId,
        sku: v.sku,
        name: v.name,
        stock: v.stock
      }))
    })),
    allVariantIds: variantIds,
    envLine: `HOT_SKU_VARIANT_IDS=${variantIds.join(',')}`
  };
  const jsonPath = path.join(outputDir, 'fixtures.json');
  fs.writeFileSync(jsonPath, JSON.stringify(fixturesJson, null, 2));

  // Sourceable env file
  const envContent = [
    '# Auto-generated by scripts/seed-flash-sale-fixtures.js',
    `# Generated at: ${new Date().toISOString()}`,
    '#',
    '# Source this file before running flash-sale stress tests:',
    '#   export $(cat artifacts/flash-sale/.env.fixtures | xargs)',
    '#',
    `HOT_SKU_VARIANT_IDS=${variantIds.join(',')}`,
    `FLASH_SALE_VARIANT_ID=${variantIds[0]}`,
    ''
  ].join('\n');
  const envPath = path.join(outputDir, '.env.fixtures');
  fs.writeFileSync(envPath, envContent);

  logger.info(`Fixtures JSON:   ${jsonPath}`);
  logger.info(`Env overrides:   ${envPath}`);
  logger.info(`HOT_SKU_VARIANT_IDS=${variantIds.join(',')}`);
  logger.info(`Total variants: ${variantIds.length}`);
}

main().catch((err) => {
  logger.fatal('Fatal error during fixture seeding', { error: err.message, stack: err.stack });
});
