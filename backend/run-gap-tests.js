const { spawnSync } = require('child_process');
const fs = require('fs');

const result = spawnSync(
  'npx',
  [
    'vitest', 'run',
    'src/modules/products/products.service.admin-write.test.ts',
    'src/modules/orders/orders.service.admin-update-items.test.ts',
    'src/modules/orders/orders.service.admin-invoice.test.ts',
    '--reporter=verbose'
  ],
  {
    cwd: __dirname,
    encoding: 'utf8',
    shell: true
  }
);

const output = (result.stdout || '') + (result.stderr || '');
fs.writeFileSync('gap-tests-out.txt', output, 'utf8');
console.log('EXIT:', result.status);
console.log(output.slice(-3000));
