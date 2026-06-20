$result = & npx vitest run `
  "src/modules/products/products.service.admin-write.test.ts" `
  "src/modules/orders/orders.service.admin-update-items.test.ts" `
  "src/modules/orders/orders.service.admin-invoice.test.ts" `
  "--reporter=verbose" 2>&1

$result | Out-File -FilePath "gap-tests-out.txt" -Encoding utf8
$result | Select-Object -Last 60
exit $LASTEXITCODE
