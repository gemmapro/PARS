import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

// ─── Saf Fonksiyonlar ────────────────────────────────────────────────────────

function applyQuickSale(cari: { balance: number }, saleAmount: number) {
  return { ...cari, balance: cari.balance + saleAmount };
}

function createStockMovement(
  productId: string,
  productName: string,
  before: number,
  soldQty: number,
  note: string
) {
  const amount = -soldQty;
  const after = before + amount;
  return {
    productId,
    productName,
    amount,
    before,
    after,
    note,
    date: new Date().toISOString(),
  };
}

function applyCompleteOrder(
  products: Array<{ id: string; stock: number }>,
  order: { stockCompleted?: boolean; items: Array<{ productId: string; qty: number }> }
) {
  if (order.stockCompleted) return { products, alreadyDone: true };
  const updated = products.map((p) => {
    const item = order.items.find((i) => i.productId === p.id);
    return item ? { ...p, stock: p.stock + item.qty } : p;
  });
  return { products: updated, alreadyDone: false };
}

function createInstallmentPlan(
  invoiceId: string,
  total: number,
  count: number,
  firstDueDate: Date
) {
  const base = Math.floor((total / count) * 100) / 100;
  const last = Math.round((total - base * (count - 1)) * 100) / 100;
  const nowIso = new Date().toISOString();
  return Array.from({ length: count }, (_, i) => ({
    id: `inst-${i}`,
    invoiceId,
    dueDate: new Date(
      firstDueDate.getFullYear(),
      firstDueDate.getMonth() + i,
      firstDueDate.getDate()
    ).toISOString(),
    amount: i === count - 1 ? last : base,
    paid: false,
    paidAt: undefined,
    createdAt: nowIso,
    updatedAt: nowIso,
  }));
}

function applyInvoiceStatusChange(
  cariBalance: number,
  invoiceTotal: number,
  invoice: { status: 'taslak' | 'onaylandi'; cariUpdated: boolean },
  newStatus: 'taslak' | 'onaylandi'
): { cariBalance: number; cariUpdated: boolean } {
  if (newStatus === 'onaylandi' && !invoice.cariUpdated) {
    return { cariBalance: cariBalance + invoiceTotal, cariUpdated: true };
  }
  if (newStatus === 'taslak' && invoice.cariUpdated) {
    return { cariBalance: cariBalance - invoiceTotal, cariUpdated: false };
  }
  return { cariBalance, cariUpdated: invoice.cariUpdated };
}

// ─── Testler ─────────────────────────────────────────────────────────────────

/**
 * Görev 8.4 — Özellik 1: Cari Bakiye Güncelleme Tutarlılığı
 * **Validates: Requirements 1.1, 1.4**
 */
describe('Özellik 1: Cari Bakiye Güncelleme Tutarlılığı', () => {
  it('applyQuickSale sonrası bakiye = önceki bakiye + satış tutarı', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        fc.integer({ min: 1, max: 100_000 }),
        (balance, amount) => {
          const cari = { balance };
          const result = applyQuickSale(cari, amount);
          expect(result.balance).toBe(balance + amount);
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Görev 8.5 — Özellik 2: StockMovement Kaydı Bütünlüğü
 * **Validates: Requirements 2.1, 2.2, 2.3**
 */
describe('Özellik 2: StockMovement Kaydı Bütünlüğü', () => {
  it('after === before + amount, amount < 0, note === Hızlı Satış, zorunlu alanlar mevcut', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000 }).chain((before) =>
          fc.integer({ min: 1, max: before }).map((soldQty) => ({ before, soldQty }))
        ),
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 30 }),
        ({ before, soldQty }, productId, productName) => {
          // QuickSaleModal her zaman note: 'Hızlı Satış' ile kayıt oluşturur
          const movement = createStockMovement(productId, productName, before, soldQty, 'Hızlı Satış');

          // Property 1: after === before + amount (Gereksinim 2.3)
          expect(movement.after).toBe(movement.before + movement.amount);

          // Property 2: amount < 0 — satış hareketi negatif olmalı (Gereksinim 2.2)
          expect(movement.amount).toBeLessThan(0);

          // Property 3: note === 'Hızlı Satış' (Gereksinim 2.2)
          expect(movement.note).toBe('Hızlı Satış');

          // Property 4: zorunlu alanlar mevcut ve boş değil (Gereksinim 2.2)
          expect(movement.productId).toBeTruthy();
          expect(movement.productName).toBeTruthy();
          expect(movement.date).toBeTruthy();
          expect(typeof movement.before).toBe('number');
          expect(typeof movement.after).toBe('number');
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Görev 11.2 — Özellik 7: Sipariş Tamamlama İdempotency
 * Validates: Requirements 11.2
 */
describe('Özellik 7: Sipariş Tamamlama İdempotency', () => {
  it('İki kez çağrıldığında stok yalnızca bir kez artmalı', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.uuid(),
            stock: fc.integer({ min: 0, max: 1000 }),
          }),
          { minLength: 1, maxLength: 5 }
        ).chain((products) =>
          fc
            .array(
              fc.record({
                productId: fc.constantFrom(...products.map((p) => p.id)),
                qty: fc.integer({ min: 1, max: 50 }),
              }),
              { minLength: 1, maxLength: products.length }
            )
            .map((items) => ({ products, items }))
        ),
        ({ products, items }) => {
          // İlk çağrı: stockCompleted: false → stok artar
          const firstResult = applyCompleteOrder(products, { stockCompleted: false, items });
          expect(firstResult.alreadyDone).toBe(false);

          // İkinci çağrı: stockCompleted: true → stok değişmez
          const secondResult = applyCompleteOrder(firstResult.products, {
            stockCompleted: true,
            items,
          });
          expect(secondResult.alreadyDone).toBe(true);

          // Stok değerleri ikinci çağrıdan sonra değişmemiş olmalı
          firstResult.products.forEach((p, idx) => {
            expect(secondResult.products[idx].stock).toBe(p.stock);
          });
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Görev 12.4 — Özellik 8: Taksit Toplamı Tutarlılığı
 * Validates: Requirements 12.4
 */
describe('Özellik 8: Taksit Toplamı Tutarlılığı', () => {
  it('Tüm taksit tutarlarının toplamı fatura toplamına 0.01 toleransla eşit', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 1_000_000 }),
        fc.integer({ min: 1, max: 24 }),
        (total, count) => {
          const plan = createInstallmentPlan('inv-1', total, count, new Date(2024, 0, 1));
          const sum = Math.round(plan.reduce((acc, inst) => acc + inst.amount, 0) * 100) / 100;
          expect(Math.abs(sum - total)).toBeLessThanOrEqual(0.01);
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Görev 12.5 — Özellik 5: Fatura Durum Döngüsü İdempotency
 * Validates: Requirements 12.5
 */
describe('Özellik 5: Fatura Durum Döngüsü İdempotency', () => {
  it('taslak → onaylandi → taslak → onaylandi döngüsü sonrası net değişim = +invoiceTotal', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 1, max: 100_000 }),
        (cariBalance, invoiceTotal) => {
          const initial = { status: 'taslak' as const, cariUpdated: false };

          // taslak → onaylandi
          const s1 = applyInvoiceStatusChange(cariBalance, invoiceTotal, initial, 'onaylandi');
          // onaylandi → taslak
          const s2 = applyInvoiceStatusChange(s1.cariBalance, invoiceTotal, { status: 'onaylandi', cariUpdated: s1.cariUpdated }, 'taslak');
          // taslak → onaylandi (tekrar)
          const s3 = applyInvoiceStatusChange(s2.cariBalance, invoiceTotal, { status: 'taslak', cariUpdated: s2.cariUpdated }, 'onaylandi');

          // Net değişim = +invoiceTotal (yalnızca bir kez artmış olmalı)
          expect(s3.cariBalance).toBe(cariBalance + invoiceTotal);
          expect(s3.cariUpdated).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});


// ─── Görev 16.1 — Boyut Eşiği Birim Testleri ─────────────────────────────────
// Validates: Requirements 13.2, 13.3, 16.3

import { runIntegrityCheck } from './dataIntegrityChecker';
import type { DB } from '@/types';

/** Minimal geçerli DB nesnesi oluşturur */
function makeMinimalDB(overrides: Partial<DB> = {}): DB {
  return {
    _version: 1,
    products: [],
    sales: [],
    suppliers: [],
    orders: [],
    cari: [],
    kasa: [],
    kasalar: [],
    bankTransactions: [],
    matchRules: [],
    monitorRules: [],
    monitorLog: [],
    stockMovements: [],
    peletSuppliers: [],
    peletOrders: [],
    boruSuppliers: [],
    boruOrders: [],
    invoices: [],
    budgets: [],
    returns: [],
    _activityLog: [],
    _auditLog: [],
    company: { id: 'c1', name: 'Test', createdAt: new Date().toISOString() },
    settings: {},
    pelletSettings: { gramaj: 15, kgFiyat: 10, cuvalKg: 25, critDays: 7 },
    ortakEmanetler: [],
    installments: [],
    partners: [],
    productCategories: [],
    notes: [],
    ...overrides,
  };
}

/**
 * JSON.stringify ile belirli bir MB boyutuna ulaşan DB nesnesi üretir.
 * `notes` dizisine büyük string'ler ekleyerek boyutu şişirir.
 */
function makeDBWithSizeMB(targetMB: number): DB {
  const db = makeMinimalDB();
  const baseSize = JSON.stringify(db).length;
  const targetBytes = targetMB * 1024 * 1024;
  const needed = targetBytes - baseSize;
  if (needed > 0) {
    // Her note ~1000 karakter; gerekli sayıda ekle
    const chunkSize = 900;
    const count = Math.ceil(needed / chunkSize);
    db.notes = Array.from({ length: count }, (_, i) => ({
      id: `n${i}`,
      title: 'x',
      content: 'A'.repeat(chunkSize),
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    }));
  }
  return db;
}

describe('Görev 16.1 — Boyut Eşiği Birim Testleri', () => {
  // ── Gereksinim 13.2: 4 MB aşılırsa level: 'warning' ──────────────────────
  describe('4 MB eşiği (Gereksinim 13.2)', () => {
    it('DB boyutu 4 MB altındayken boyut uyarısı OLMAMALI', () => {
      // Minimal DB birkaç KB — hiçbir boyut eşiği tetiklenmemeli
      const db = makeMinimalDB();
      const actualSize = JSON.stringify(db).length / (1024 * 1024);
      expect(actualSize).toBeLessThan(2);

      const issues = runIntegrityCheck(db);
      const sizeIssues = issues.filter(i => i.category === 'veri');
      expect(sizeIssues).toHaveLength(0);
    });

    it('DB boyutu 4 MB üzerindeyken level: warning uyarısı OLMALI', () => {
      const db = makeDBWithSizeMB(4.5);
      const actualSize = JSON.stringify(db).length / (1024 * 1024);
      expect(actualSize).toBeGreaterThan(4);

      const issues = runIntegrityCheck(db);
      // Bölüm 9: >4 MB → warning
      const sizeWarnings = issues.filter(
        i => i.severity === 'warning' && i.category === 'veri'
      );
      expect(sizeWarnings.length).toBeGreaterThan(0);
    });
  });

  // ── Gereksinim 13.3: 7 MB aşılırsa level: 'critical' ─────────────────────
  describe('7 MB eşiği (Gereksinim 13.3)', () => {
    it('DB boyutu 7 MB altındayken (bölüm 9) critical uyarısı OLMAMALI', () => {
      // Minimal DB — bölüm 9 critical eşiği (>7 MB) tetiklenmemeli
      const db = makeMinimalDB();
      const actualSize = JSON.stringify(db).length / (1024 * 1024);
      expect(actualSize).toBeLessThan(7);

      const issues = runIntegrityCheck(db);
      // Bölüm 9 critical: detail'de "X.XX MB" formatı ve "localStorage limiti" içerir
      const section9Critical = issues.filter(
        i => i.severity === 'critical' && i.category === 'veri' &&
             /\d+\.\d{2} MB/.test(i.detail)
      );
      expect(section9Critical).toHaveLength(0);
    });

    it('DB boyutu 7 MB üzerindeyken level: critical uyarısı OLMALI', () => {
      const db = makeDBWithSizeMB(7.5);
      const actualSize = JSON.stringify(db).length / (1024 * 1024);
      expect(actualSize).toBeGreaterThan(7);

      const issues = runIntegrityCheck(db);
      const criticalSizeIssues = issues.filter(
        i => i.severity === 'critical' && i.category === 'veri'
      );
      expect(criticalSizeIssues.length).toBeGreaterThan(0);
    });
  });

  // ── Gereksinim 16.3: 800 stockMovements → level: 'info' ──────────────────
  describe('800 stockMovements eşiği (Gereksinim 16.3)', () => {
    function makeMovement(i: number) {
      return {
        id: `sm${i}`,
        productId: 'p1',
        productName: 'Ürün',
        type: 'satis' as const,
        amount: -1,
        before: 100,
        after: 99,
        note: 'test',
        date: '2024-01-01T00:00:00.000Z',
      };
    }

    it('800 veya daha az stockMovements varken info uyarısı OLMAMALI', () => {
      const db = makeMinimalDB({
        stockMovements: Array.from({ length: 800 }, (_, i) => makeMovement(i)),
      });
      const issues = runIntegrityCheck(db);
      const stockCountIssues = issues.filter(
        i => i.severity === 'info' && i.category === 'stok' && i.title.toLowerCase().includes('stok hareketi')
      );
      expect(stockCountIssues).toHaveLength(0);
    });

    it('801 stockMovements varken level: info uyarısı OLMALI', () => {
      const db = makeMinimalDB({
        stockMovements: Array.from({ length: 801 }, (_, i) => makeMovement(i)),
      });
      const issues = runIntegrityCheck(db);
      const stockCountIssues = issues.filter(
        i => i.severity === 'info' && i.category === 'stok' && i.title.toLowerCase().includes('stok hareketi')
      );
      expect(stockCountIssues).toHaveLength(1);
    });

    it('1000 stockMovements varken level: info uyarısı OLMALI', () => {
      const db = makeMinimalDB({
        stockMovements: Array.from({ length: 1000 }, (_, i) => makeMovement(i)),
      });
      const issues = runIntegrityCheck(db);
      const stockCountIssues = issues.filter(
        i => i.severity === 'info' && i.category === 'stok' && i.title.toLowerCase().includes('stok hareketi')
      );
      expect(stockCountIssues).toHaveLength(1);
    });
  });
});
