import { readChartAccounts } from './chart-accounts.js';
import Excel from 'exceljs';
import type { AuthContext, AuthService } from '../auth/service.js';
import { ApiError } from '../errors.js';
import { requireOwnerPin, requireBusiness } from './access.js';

const maxRows = 25_000;
const maxBytes = 20 * 1024 * 1024;
const tooLarge = () => new ApiError(413, 'BACKUP_TOO_LARGE', 'The business exceeds the download limit');

function serialize(value: unknown) {
  return JSON.stringify(value, (_key, item: unknown) => typeof item === 'bigint' ? item.toString() : item);
}

export async function exportBusinessBackup(auth: AuthService, ctx: AuthContext, businessId: string, format: 'json' | 'xlsx') {
  const snapshot = await auth.transaction(async tx => {
    const access = await requireBusiness(auth, tx, ctx, businessId, 'business.edit');
    const { business, membership } = access;
    requireOwnerPin(access);
    if (membership.role !== 'OWNER') throw new ApiError(403, 'FORBIDDEN', 'Only a business owner may export this backup');

    let remaining = maxRows;
    let bytes = 0;
    const query = () => ({ where: { businessId }, orderBy: { id: 'asc' as const }, take: remaining + 1 });
    async function collect<T extends object>(read: () => Promise<T[]>) {
      const rows = await read();
      remaining -= rows.length;
      if (remaining < 0) throw tooLarge();
      const json = serialize(rows);
      bytes += Buffer.byteLength(json);
      if (bytes > maxBytes) throw tooLarge();
      return JSON.parse(json) as Record<string, unknown>[];
    }
    const tables = {
      Locations: await collect(() => tx.location.findMany(query())),
      Products: await collect(() => tx.product.findMany(query())),
      CategoriesAndUnits: await collect(() => tx.catalogueReference.findMany(query())),
      Barcodes: await collect(() => tx.productBarcode.findMany(query())),
      ProductPacks: await collect(() => tx.productPack.findMany(query())),
      ChartAccounts: await collect(() => readChartAccounts(tx, businessId)),
      Partners: await collect(() => tx.partner.findMany(query())),
      PartnerTransactions: await collect(() => tx.partnerTransaction.findMany(query())),
      Suppliers: await collect(() => tx.supplier.findMany(query())),
      Customers: await collect(() => tx.customer.findMany(query())),
      LoyaltyVisits: await collect(() => tx.loyaltyVisit.findMany(query())),
      LoyaltyRewards: await collect(() => tx.loyaltyReward.findMany(query())),
      Sales: await collect(() => tx.sale.findMany(query())),
      SaleLines: await collect(() => tx.saleLine.findMany(query())),
      SalePayments: await collect(() => tx.salePayment.findMany(query())),
      Purchases: await collect(() => tx.purchaseDocument.findMany(query())),
      PlannedPurchaseItems: await collect(() => tx.purchasePlanItem.findMany(query())),
      PurchaseLines: await collect(() => tx.purchaseLine.findMany(query())),
      StockBalances: await collect(() => tx.stockBalance.findMany(query())),
      StockMovements: await collect(() => tx.stockMovement.findMany(query())),
      InventoryCostLayers: await collect(() => tx.fifoLayer.findMany(query())),
      Transfers: await collect(() => tx.stockTransfer.findMany(query())),
      TransferLines: await collect(() => tx.transferLine.findMany(query())),
      TransferEvents: await collect(() => tx.transferEvent.findMany(query())),
      TransferEventLines: await collect(() => tx.transferEventLine.findMany(query())),
      Adjustments: await collect(() => tx.adjustment.findMany(query())),
      AdjustmentLines: await collect(() => tx.adjustmentLine.findMany(query())),
      CashEntries: await collect(() => tx.moneyEntry.findMany(query())),
      CashClosings: await collect(() => tx.cashClose.findMany(query())),
    };
    const { id, name, countryCode, baseCurrency, timezone, dateFormat, numberFormat, salesTaxRate } = business;
    return {
      schemaVersion: 1, exportedAt: new Date().toISOString(),
      business: { loyaltyProgram:business.loyaltyProgram,id, name, countryCode, baseCurrency, timezone, dateFormat, numberFormat, salesTaxRate: salesTaxRate.toString() },
      tables,
    };
  });

  if (format === 'json') return Buffer.from(serialize(snapshot));
  const workbook = new Excel.Workbook();
  const tables = {
    Business: [{ ...snapshot.business, exportedAt: snapshot.exportedAt, schemaVersion: snapshot.schemaVersion }],
    ...snapshot.tables,
  };
  for (const [name, rows] of Object.entries(tables)) {
    const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    if (!rows.length) continue;
    const headers = [...new Set(rows.flatMap(row => Object.keys(row)))];
    sheet.columns = headers.map(header => ({ header, key: header, width: Math.max(16, header.length + 2) }));
    sheet.getRow(1).font = { bold: true };
    for (const row of rows) {
      sheet.addRow(headers.map(key => {
        const value = (row as Record<string, unknown>)[key];
        if (value == null) return null;
        const cell = typeof value === 'object' ? serialize(value) : value;
        if (typeof cell === 'string' && cell.length > 32_767) {
          throw new ApiError(422, 'BACKUP_EXCEL_CELL_TOO_LARGE', 'A value is too large for Excel. Download JSON instead');
        }
        return cell as string | number | boolean;
      }));
    }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
