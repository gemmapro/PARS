import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { parseBankDate, formatBankDate, calcMarkup, calcMargin } from './utils-tr';

// --- Birim Testler ---

describe('parseBankDate', () => {
  it("'15.03.2024' geçerli Date döndürmeli", () => {
    const result = parseBankDate('15.03.2024');
    expect(result).toBeInstanceOf(Date);
    expect(result!.getUTCFullYear()).toBe(2024);
    expect(result!.getUTCMonth()).toBe(2); // 0-indexed
    expect(result!.getUTCDate()).toBe(15);
  });

  it("'invalid' için null döndürmeli", () => {
    expect(parseBankDate('invalid')).toBeNull();
  });

  it("'' için null döndürmeli", () => {
    expect(parseBankDate('')).toBeNull();
  });
});

describe('formatBankDate', () => {
  it("2024-03-15 UTC tarihini '15.03.2024' olarak formatlamalı", () => {
    const date = new Date('2024-03-15T00:00:00.000Z');
    expect(formatBankDate(date)).toBe('15.03.2024');
  });
});

describe('calcMarkup', () => {
  it('calcMarkup(150, 100) → 50', () => {
    expect(calcMarkup(150, 100)).toBe(50);
  });

  it('calcMarkup(0, 0) → 0', () => {
    expect(calcMarkup(0, 0)).toBe(0);
  });
});

describe('calcMargin', () => {
  it('calcMargin(150, 100) → 33', () => {
    expect(calcMargin(150, 100)).toBe(33);
  });
});

// --- Property-Based Testler ---

/**
 * Özellik 4: Tarih Ayrıştırma Round-Trip
 * parseBankDate(formatBankDate(d)) orijinal tarihe (UTC timestamp) eşit olmalı
 * Validates: Requirements 4.5, 19.2, 19.4
 */
describe('Özellik 4: Tarih Ayrıştırma Round-Trip', () => {
  it('formatBankDate → parseBankDate round-trip UTC timestamp korumalı', () => {
    // 1970-01-01 ile 2099-12-31 arası geçerli UTC tarihleri
    const minMs = Date.UTC(1970, 0, 1);
    const maxMs = Date.UTC(2099, 11, 31);

    fc.assert(
      fc.property(
        fc.integer({ min: minMs, max: maxMs }).map((ms) => {
          // Günün başına yuvarla (saat 00:00:00 UTC)
          const d = new Date(ms);
          return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
        }),
        (date) => {
          const formatted = formatBankDate(date);
          const parsed = parseBankDate(formatted);
          expect(parsed).not.toBeNull();
          expect(parsed!.getTime()).toBe(date.getTime());
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Özellik 6: Markup ≥ Margin
 * price > cost > 0 için calcMarkup(price, cost) >= calcMargin(price, cost) her zaman doğru
 * Validates: Requirements 9.4
 */
describe('Özellik 6: Markup ≥ Margin', () => {
  it('price > cost > 0 için calcMarkup her zaman calcMargin\'e eşit veya büyük', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10000 }).chain((cost) =>
          fc.integer({ min: cost + 1, max: cost * 10 }).map((price) => ({ cost, price }))
        ),
        ({ cost, price }) => {
          const markup = calcMarkup(price, cost);
          const margin = calcMargin(price, cost);
          expect(markup).toBeGreaterThanOrEqual(margin);
        }
      ),
      { numRuns: 100 }
    );
  });
});
