/**
 * Rule Engine — Birim ve Property Testleri
 *
 * Feature: rule-engine-audit
 * Test framework: Vitest + fast-check
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validateTransaction, rules, TRANSACTION_LIMIT } from './ruleEngine';
import type { DB, Product, KasaEntry, Sale, RuleViolation } from '@/types';

// ─── Test Yardımcıları ────────────────────────────────────────────────────────

function makeDB(overrides: Partial<DB> = {}): DB {
  const now = new Date().toISOString();
  return {
    _version: 1,
    products: [],
    sales: [],
    suppliers: [],
    orders: [],
    cari: [],
    kasa: [],
    kasalar: [{ id: 'nakit', name: 'Nakit', icon: '💵' }],
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
    company: { id: 'c1', createdAt: now },
    settings: {},
    pelletSettings: { gramaj: 14, kgFiyat: 6.5, cuvalKg: 15, critDays: 3 },
    ortakEmanetler: [],
    installments: [],
    partners: [],
    productCategories: [],
    notes: [],
    ...overrides,
  };
}

function makeProduct(overrides: Partial<Product> = {}): Product {
  const now = new Date().toISOString();
  return {
    id: 'p1',
    name: 'Test Ürün',
    category: 'soba',
    cost: 100,
    price: 150,
    stock: 10,
    minStock: 2,
    deleted: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeKasaEntry(overrides: Partial<KasaEntry> = {}): KasaEntry {
  const now = new Date().toISOString();
  return {
    id: 'k1',
    type: 'gelir',
    category: 'satis',
    amount: 500,
    kasa: 'nakit',
    deleted: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeSale(overrides: Partial<Sale> = {}): Sale {
  const now = new Date().toISOString();
  return {
    id: 's1',
    productName: 'Test Ürün',
    quantity: 1,
    unitPrice: 150,
    cost: 100,
    discount: 0,
    discountAmount: 0,
    subtotal: 150,
    total: 150,
    profit: 50,
    payment: 'nakit',
    status: 'tamamlandi',
    items: [],
    deleted: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ─── Birim Testleri ───────────────────────────────────────────────────────────

describe('negative_stock kuralı', () => {
  it('negatif stok → block ihlali üretir', () => {
    const prev = makeDB();
    const next = makeDB({ products: [makeProduct({ stock: -1 })] });
    const violations = validateTransaction(prev, next);
    expect(violations.some(v => v.ruleId === 'negative_stock' && v.severity === 'block')).toBe(true);
  });

  it('sıfır stok → ihlal üretmez', () => {
    const prev = makeDB();
    const next = makeDB({ products: [makeProduct({ stock: 0 })] });
    const violations = validateTransaction(prev, next);
    expect(violations.filter(v => v.ruleId === 'negative_stock')).toHaveLength(0);
  });

  it('pozitif stok → ihlal üretmez', () => {
    const prev = makeDB();
    const next = makeDB({ products: [makeProduct({ stock: 5 })] });
    const violations = validateTransaction(prev, next);
    expect(violations.filter(v => v.ruleId === 'negative_stock')).toHaveLength(0);
  });

  it('deleted ürün negatif stok → ihlal üretmez', () => {
    const prev = makeDB();
    const next = makeDB({ products: [makeProduct({ stock: -5, deleted: true })] });
    const violations = validateTransaction(prev, next);
    expect(violations.filter(v => v.ruleId === 'negative_stock')).toHaveLength(0);
  });
});

describe('negative_kasa kuralı', () => {
  it('negatif kasa bakiyesi → block ihlali üretir', () => {
    const prev = makeDB();
    // Sadece gider kaydı → bakiye negatif
    const next = makeDB({
      kasa: [makeKasaEntry({ id: 'k1', type: 'gider', amount: 1000, kasa: 'nakit' })],
    });
    const violations = validateTransaction(prev, next);
    expect(violations.some(v => v.ruleId === 'negative_kasa' && v.severity === 'block')).toBe(true);
  });

  it('gelir > gider → ihlal üretmez', () => {
    const prev = makeDB();
    const next = makeDB({
      kasa: [
        makeKasaEntry({ id: 'k1', type: 'gelir', amount: 2000, kasa: 'nakit' }),
        makeKasaEntry({ id: 'k2', type: 'gider', amount: 500, kasa: 'nakit' }),
      ],
    });
    const violations = validateTransaction(prev, next);
    expect(violations.filter(v => v.ruleId === 'negative_kasa')).toHaveLength(0);
  });

  it('deleted kasa kaydı bakiye hesabına dahil edilmez', () => {
    const prev = makeDB();
    const next = makeDB({
      kasa: [makeKasaEntry({ id: 'k1', type: 'gider', amount: 9999, kasa: 'nakit', deleted: true })],
    });
    const violations = validateTransaction(prev, next);
    expect(violations.filter(v => v.ruleId === 'negative_kasa')).toHaveLength(0);
  });
});

describe('duplicate_transaction kuralı', () => {
  it('60 saniye içinde aynı cariId+amount+kasa → warn ihlali üretir', () => {
    const now = new Date();
    const recentTime = new Date(now.getTime() - 30_000).toISOString(); // 30 saniye önce

    const existingEntry = makeKasaEntry({
      id: 'k_existing',
      cariId: 'cari1',
      amount: 500,
      kasa: 'nakit',
      createdAt: recentTime,
    });

    const prev = makeDB({ kasa: [existingEntry] });
    const newEntry = makeKasaEntry({
      id: 'k_new',
      cariId: 'cari1',
      amount: 500,
      kasa: 'nakit',
      createdAt: now.toISOString(),
    });
    const next = makeDB({ kasa: [existingEntry, newEntry] });

    const violations = validateTransaction(prev, next);
    expect(violations.some(v => v.ruleId === 'duplicate_transaction' && v.severity === 'warn')).toBe(true);
  });

  it('60 saniyeden eski kayıt → ihlal üretmez', () => {
    const now = new Date();
    const oldTime = new Date(now.getTime() - 120_000).toISOString(); // 2 dakika önce

    const existingEntry = makeKasaEntry({
      id: 'k_existing',
      cariId: 'cari1',
      amount: 500,
      kasa: 'nakit',
      createdAt: oldTime,
    });

    const prev = makeDB({ kasa: [existingEntry] });
    const newEntry = makeKasaEntry({
      id: 'k_new',
      cariId: 'cari1',
      amount: 500,
      kasa: 'nakit',
      createdAt: now.toISOString(),
    });
    const next = makeDB({ kasa: [existingEntry, newEntry] });

    const violations = validateTransaction(prev, next);
    expect(violations.filter(v => v.ruleId === 'duplicate_transaction')).toHaveLength(0);
  });

  it('warn ihlali işlemi engellemez (severity: warn)', () => {
    const now = new Date();
    const recentTime = new Date(now.getTime() - 10_000).toISOString();

    const existingEntry = makeKasaEntry({
      id: 'k_existing',
      cariId: 'cari1',
      amount: 500,
      kasa: 'nakit',
      createdAt: recentTime,
    });

    const prev = makeDB({ kasa: [existingEntry] });
    const newEntry = makeKasaEntry({
      id: 'k_new',
      cariId: 'cari1',
      amount: 500,
      kasa: 'nakit',
      createdAt: now.toISOString(),
    });
    const next = makeDB({ kasa: [existingEntry, newEntry] });

    const violations = validateTransaction(prev, next);
    const dupViolations = violations.filter(v => v.ruleId === 'duplicate_transaction');
    expect(dupViolations.every(v => v.severity === 'warn')).toBe(true);
    // Block ihlali yok → işlem devam eder
    expect(violations.some(v => v.severity === 'block')).toBe(false);
  });
});

describe('zero_amount kuralı', () => {
  it('KasaEntry.amount === 0 → block ihlali üretir', () => {
    const prev = makeDB();
    const next = makeDB({
      kasa: [makeKasaEntry({ id: 'k_new', amount: 0 })],
    });
    const violations = validateTransaction(prev, next);
    expect(violations.some(v => v.ruleId === 'zero_amount' && v.severity === 'block')).toBe(true);
  });

  it('KasaEntry.amount < 0 → block ihlali üretir', () => {
    const prev = makeDB();
    const next = makeDB({
      kasa: [makeKasaEntry({ id: 'k_new', amount: -100 })],
    });
    const violations = validateTransaction(prev, next);
    expect(violations.some(v => v.ruleId === 'zero_amount' && v.severity === 'block')).toBe(true);
  });

  it('Sale.total === 0 → block ihlali üretir', () => {
    const prev = makeDB();
    const next = makeDB({
      sales: [makeSale({ id: 's_new', total: 0 })],
    });
    const violations = validateTransaction(prev, next);
    expect(violations.some(v => v.ruleId === 'zero_amount' && v.severity === 'block')).toBe(true);
  });

  it('Sale.total < 0 → block ihlali üretir', () => {
    const prev = makeDB();
    const next = makeDB({
      sales: [makeSale({ id: 's_new', total: -50 })],
    });
    const violations = validateTransaction(prev, next);
    expect(violations.some(v => v.ruleId === 'zero_amount' && v.severity === 'block')).toBe(true);
  });

  it('mevcut kayıt (prevDB\'de var) → ihlal üretmez', () => {
    const existingEntry = makeKasaEntry({ id: 'k_existing', amount: 0 });
    const prev = makeDB({ kasa: [existingEntry] });
    const next = makeDB({ kasa: [existingEntry] }); // değişiklik yok
    const violations = validateTransaction(prev, next);
    expect(violations.filter(v => v.ruleId === 'zero_amount')).toHaveLength(0);
  });
});

describe('validateTransaction — genel davranış', () => {
  it('temiz DB → boş ihlal listesi döner', () => {
    const db = makeDB({ products: [makeProduct({ stock: 10 })] });
    const violations = validateTransaction(db, db);
    expect(violations).toHaveLength(0);
  });

  it('hata fırlatan kural diğer kuralları etkilemez (graceful degradation)', () => {
    // rules dizisine geçici olarak hata fırlatan kural ekle
    const faultyRule = {
      id: 'faulty_rule',
      name: 'Hatalı Kural',
      severity: 'block' as const,
      evaluate: () => { throw new Error('Kural hatası!'); },
    };
    rules.push(faultyRule);

    try {
      const prev = makeDB();
      const next = makeDB({ products: [makeProduct({ stock: -1 })] });
      // Hatalı kural olsa bile diğer kurallar çalışmalı
      const violations = validateTransaction(prev, next);
      expect(Array.isArray(violations)).toBe(true);
      // negative_stock kuralı hâlâ çalışmalı
      expect(violations.some(v => v.ruleId === 'negative_stock')).toBe(true);
    } finally {
      // Temizle
      const idx = rules.findIndex(r => r.id === 'faulty_rule');
      if (idx >= 0) rules.splice(idx, 1);
    }
  });

  it('exception fırlatmaz — her zaman dizi döner', () => {
    // null/undefined benzeri bozuk veri
    expect(() => validateTransaction(makeDB(), makeDB())).not.toThrow();
  });
});

// ─── Property-Based Testler ───────────────────────────────────────────────────

// Arbitrary: minimal geçerli DB
const arbDB = () => fc.record({
  _version: fc.integer({ min: 0, max: 100 }),
  products: fc.array(
    fc.record({
      id: fc.uuid(),
      name: fc.string({ minLength: 1, maxLength: 20 }),
      category: fc.constant('soba'),
      cost: fc.float({ min: 0, max: 10000, noNaN: true }),
      price: fc.float({ min: 0, max: 20000, noNaN: true }),
      stock: fc.integer({ min: -5, max: 100 }),
      minStock: fc.integer({ min: 0, max: 10 }),
      deleted: fc.boolean(),
      createdAt: fc.constant(new Date().toISOString()),
      updatedAt: fc.constant(new Date().toISOString()),
    }),
    { maxLength: 5 }
  ),
  sales: fc.array(
    fc.record({
      id: fc.uuid(),
      productName: fc.string({ minLength: 1, maxLength: 20 }),
      quantity: fc.integer({ min: 1, max: 10 }),
      unitPrice: fc.float({ min: 0, max: 5000, noNaN: true }),
      cost: fc.float({ min: 0, max: 5000, noNaN: true }),
      discount: fc.constant(0),
      discountAmount: fc.constant(0),
      subtotal: fc.float({ min: -100, max: 5000, noNaN: true }),
      total: fc.float({ min: -100, max: 5000, noNaN: true }),
      profit: fc.float({ min: -100, max: 5000, noNaN: true }),
      payment: fc.constant('nakit'),
      status: fc.constant('tamamlandi' as const),
      items: fc.constant([]),
      deleted: fc.boolean(),
      createdAt: fc.constant(new Date().toISOString()),
      updatedAt: fc.constant(new Date().toISOString()),
    }),
    { maxLength: 5 }
  ),
  kasa: fc.array(
    fc.record({
      id: fc.uuid(),
      type: fc.oneof(fc.constant('gelir' as const), fc.constant('gider' as const)),
      category: fc.constant('satis'),
      amount: fc.float({ min: -100, max: 10000, noNaN: true }),
      kasa: fc.constant('nakit'),
      deleted: fc.boolean(),
      createdAt: fc.constant(new Date().toISOString()),
      updatedAt: fc.constant(new Date().toISOString()),
    }),
    { maxLength: 5 }
  ),
}).map(partial => makeDB(partial as Partial<DB>));

// Arbitrary: en az bir negatif stoklu ürün içeren DB
const arbDBWithNegativeStock = () => fc.record({
  negativeProduct: fc.record({
    id: fc.uuid(),
    stock: fc.integer({ min: -100, max: -1 }),
  }),
}).map(({ negativeProduct }) =>
  makeDB({
    products: [makeProduct({ ...negativeProduct, deleted: false })],
  })
);

// Arbitrary: negatif bakiyeye düşecek kasa içeren DB
const arbDBWithNegativeKasa = () => fc.record({
  amount: fc.float({ min: 1, max: 10000, noNaN: true }),
}).map(({ amount }) =>
  makeDB({
    kasa: [makeKasaEntry({ id: 'k_neg', type: 'gider', amount, kasa: 'nakit', deleted: false })],
  })
);

// Property 1: validateTransaction her zaman geçerli RuleViolation[] döndürür
// Feature: rule-engine-audit, Property 1: validateTransaction never throws and always returns valid RuleViolation[]
describe('Property 1: validateTransaction never throws and always returns valid RuleViolation[]', () => {
  it('rastgele prevDB/nextDB çiftleri için her zaman geçerli dizi döner', () => {
    fc.assert(
      fc.property(arbDB(), arbDB(), (prevDB, nextDB) => {
        let result: RuleViolation[] = [];
        expect(() => { result = validateTransaction(prevDB, nextDB); }).not.toThrow();
        expect(Array.isArray(result)).toBe(true);
        for (const v of result) {
          expect(typeof v.ruleId).toBe('string');
          expect(typeof v.ruleName).toBe('string');
          expect(typeof v.message).toBe('string');
          expect(['block', 'warn']).toContain(v.severity);
        }
      }),
      { numRuns: 100 }
    );
  });
});

// Property 2: Negatif stok her zaman block ihlali üretir
// Feature: rule-engine-audit, Property 2: Negative stock always produces a block violation
describe('Property 2: Negative stock always produces a block violation', () => {
  it('en az bir negatif stoklu ürün → en az bir block ihlali', () => {
    fc.assert(
      fc.property(arbDBWithNegativeStock(), (nextDB) => {
        const prevDB = makeDB();
        const violations = validateTransaction(prevDB, nextDB);
        return violations.some(v => v.severity === 'block' && v.ruleId === 'negative_stock');
      }),
      { numRuns: 100 }
    );
  });
});

// Property 3: Negatif kasa bakiyesi her zaman block ihlali üretir
// Feature: rule-engine-audit, Property 3: Negative kasa balance always produces a block violation
describe('Property 3: Negative kasa balance always produces a block violation', () => {
  it('bakiyesi negatife düşen kasa → en az bir block ihlali', () => {
    fc.assert(
      fc.property(arbDBWithNegativeKasa(), (nextDB) => {
        const prevDB = makeDB();
        const violations = validateTransaction(prevDB, nextDB);
        return violations.some(v => v.severity === 'block' && v.ruleId === 'negative_kasa');
      }),
      { numRuns: 100 }
    );
  });
});

// Property 4: Sıfır veya negatif tutar her zaman block ihlali üretir
// Feature: rule-engine-audit, Property 4: Zero or negative amount always produces a block violation
describe('Property 4: Zero or negative amount always produces a block violation', () => {
  it('KasaEntry.amount <= 0 → block ihlali', () => {
    fc.assert(
      fc.property(fc.float({ min: -10000, max: 0, noNaN: true }), (amount) => {
        const prev = makeDB();
        const next = makeDB({
          kasa: [makeKasaEntry({ id: 'k_new', amount })],
        });
        const violations = validateTransaction(prev, next);
        return violations.some(v => v.severity === 'block' && v.ruleId === 'zero_amount');
      }),
      { numRuns: 100 }
    );
  });

  it('Sale.total <= 0 → block ihlali', () => {
    fc.assert(
      fc.property(fc.float({ min: -10000, max: 0, noNaN: true }), (total) => {
        const prev = makeDB();
        const next = makeDB({
          sales: [makeSale({ id: 's_new', total })],
        });
        const violations = validateTransaction(prev, next);
        return violations.some(v => v.severity === 'block' && v.ruleId === 'zero_amount');
      }),
      { numRuns: 100 }
    );
  });
});

// TRANSACTION_LIMIT sabitinin doğru değerde olduğunu doğrula
describe('TRANSACTION_LIMIT sabiti', () => {
  it('100_000 değerinde export edilir', () => {
    expect(TRANSACTION_LIMIT).toBe(100_000);
  });
});
