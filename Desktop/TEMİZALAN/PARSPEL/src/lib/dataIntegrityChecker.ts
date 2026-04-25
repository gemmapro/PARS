/**
 * Veri Bütünlüğü Denetçisi
 * Tüm muhasebe kurallarını ve veri tutarlılığını otomatik kontrol eder.
 */
import type { DB, KasaEntry } from '@/types';
import { formatMoney } from './utils-tr';
import { TRANSACTION_LIMIT } from './ruleEngine';

export type IssueSeverity = 'critical' | 'warning' | 'info';
export type IssueCategory = 'stok' | 'kasa' | 'cari' | 'satis' | 'siparis' | 'fatura' | 'veri' | 'referans' | 'anomali';

export interface IntegrityIssue {
  id: string;
  severity: IssueSeverity;
  category: IssueCategory;
  title: string;
  detail: string;
  suggestion?: string;
  relatedIds?: string[];
}

// ── Ana denetim fonksiyonu ──
export function runIntegrityCheck(db: DB): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  let issueIdx = 0;
  const addIssue = (severity: IssueSeverity, category: IssueCategory, title: string, detail: string, suggestion?: string, relatedIds?: string[]) => {
    issues.push({ id: `issue_${++issueIdx}`, severity, category, title, detail, suggestion, relatedIds });
  };

  // ═══════════════════════════════════════
  // 1. STOK TUTARLILIĞI
  // ═══════════════════════════════════════
  const activeProducts = db.products.filter(p => !p.deleted);

  // 1a. Negatif stok kontrolü
  activeProducts.forEach(p => {
    if (p.stock < 0) {
      addIssue('critical', 'stok', 'Negatif stok', `"${p.name}" stoğu ${p.stock} — negatif olamaz.`, 'Stok hareketlerini kontrol edin.', [p.id]);
    }
  });

  // 1b. Maliyet sıfır veya negatif
  activeProducts.forEach(p => {
    if (p.cost < 0) {
      addIssue('warning', 'stok', 'Negatif maliyet', `"${p.name}" maliyeti ${formatMoney(p.cost)} — negatif.`, 'Ürün maliyetini düzeltin.', [p.id]);
    }
    if (p.cost === 0 && p.stock > 0) {
      addIssue('info', 'stok', 'Sıfır maliyet', `"${p.name}" maliyeti ₺0 ama ${p.stock} adet stokta.`, 'Maliyet girilmemiş olabilir.', [p.id]);
    }
  });

  // 1c. Fiyat maliyetin altında
  activeProducts.forEach(p => {
    if (p.price > 0 && p.cost > 0 && p.price < p.cost) {
      addIssue('warning', 'stok', 'Zararına fiyat', `"${p.name}" fiyatı (${formatMoney(p.price)}) maliyetinin (${formatMoney(p.cost)}) altında.`, 'Fiyatı güncelleyin.', [p.id]);
    }
  });

  // ═══════════════════════════════════════
  // 2. KASA TUTARLILIĞI
  // ═══════════════════════════════════════
  const activeKasa = db.kasa.filter(k => !k.deleted);

  // 2a. Negatif kasa bakiyesi
  const kasaMap = new Map<string, number>();
  activeKasa.forEach(k => {
    const cur = kasaMap.get(k.kasa) || 0;
    kasaMap.set(k.kasa, cur + (k.type === 'gelir' ? k.amount : -k.amount));
  });
  kasaMap.forEach((balance, kasaId) => {
    if (balance < -0.01) {
      addIssue('critical', 'kasa', 'Negatif kasa bakiyesi', `"${kasaId}" kasası bakiyesi ${formatMoney(balance)} — negatif.`, 'Kasa hareketlerini kontrol edin.');
    }
  });

  // 2b. Tutarı sıfır veya negatif olan kasa kaydı
  activeKasa.forEach(k => {
    if (k.amount <= 0) {
      addIssue('warning', 'kasa', 'Geçersiz kasa tutarı', `Kasa kaydı "${k.description || k.id}" tutarı ${formatMoney(k.amount)}.`, 'Tutar pozitif olmalı.', [k.id]);
    }
  });

  // ═══════════════════════════════════════
  // 3. CARİ TUTARLILIĞI
  // ═══════════════════════════════════════
  const activeCari = db.cari.filter(c => !c.deleted);

  // 3a. Müşteri negatif bakiye (normalden fazla ödeme?)
  activeCari.filter(c => c.type === 'musteri').forEach(c => {
    if ((c.balance || 0) < -0.01) {
      addIssue('info', 'cari', 'Müşteri negatif bakiye', `"${c.name}" bakiyesi ${formatMoney(c.balance || 0)} — fazla ödeme yapılmış olabilir.`, 'Tahsilat ve satış kayıtlarını kontrol edin.', [c.id]);
    }
  });

  // ═══════════════════════════════════════
  // 4. SATIŞ TUTARLILIĞI
  // ═══════════════════════════════════════
  const activeSales = db.sales.filter(s => !s.deleted);

  // 4a. Satış - kasa eşleşmesi (tamamlanan satışlarda kasa kaydı olmalı)
  activeSales.filter(s => s.status === 'tamamlandi').forEach(s => {
    const relatedKasa = activeKasa.filter(k => k.relatedId === s.id && k.type === 'gelir');
    const tahsilEdilen = relatedKasa.reduce((sum, k) => sum + k.amount, 0);
    const beklenen = s.payment === 'cari' ? 0 : s.total;

    // Cari ödeme değilse ve tahsilat yoksa uyar
    if (s.payment !== 'cari' && tahsilEdilen < beklenen - 0.01 && s.total > 0) {
      addIssue('warning', 'satis', 'Eksik kasa kaydı', `Satış "${s.productName}" (${formatMoney(s.total)}) için kasa kaydı eksik veya tutarsız. Kasa: ${formatMoney(tahsilEdilen)}.`, 'Kasa hareketlerini kontrol edin.', [s.id]);
    }
  });

  // 4b. Müşterisiz satış
  activeSales.forEach(s => {
    if (!s.customerId && !s.cariId) {
      addIssue('info', 'satis', 'Müşterisiz satış', `Satış "${s.productName}" (${formatMoney(s.total)}) müşteri bilgisi yok.`, 'Eski kayıt olabilir.', [s.id]);
    }
  });

  // 4c. Satış - müşteri referans bozuk
  activeSales.forEach(s => {
    const cariId = s.cariId || s.customerId;
    if (cariId && !db.cari.find(c => c.id === cariId)) {
      addIssue('warning', 'referans', 'Bozuk müşteri referansı', `Satış "${s.productName}" müşteri ID "${cariId}" veritabanında bulunamadı.`, 'Müşteri silinmiş olabilir.', [s.id]);
    }
  });

  // 4d. Negatif tutar/kâr kontrolü
  activeSales.filter(s => s.status === 'tamamlandi').forEach(s => {
    if (s.total < 0) {
      addIssue('critical', 'satis', 'Negatif satış tutarı', `"${s.productName}" tutarı ${formatMoney(s.total)}.`, 'Satış verisini kontrol edin.', [s.id]);
    }
  });

  // ═══════════════════════════════════════
  // 5. SİPARİŞ TUTARLILIĞI
  // ═══════════════════════════════════════
  const activeOrders = db.orders.filter(o => !o.deleted);

  // 5a. Tedarikçi referans bozuk
  activeOrders.forEach(o => {
    if (o.supplierId && !db.suppliers.find(s => s.id === o.supplierId)) {
      addIssue('warning', 'referans', 'Bozuk tedarikçi referansı', `Sipariş "${o.items.map(i => i.productName).join(', ')}" tedarikçi bulunamadı.`, 'Tedarikçi silinmiş olabilir.', [o.id]);
    }
  });

  // 5b. Tamamlanmış sipariş ama ödenmemiş
  activeOrders.filter(o => o.status === 'tamamlandi').forEach(o => {
    if (o.remainingAmount > 0.01) {
      addIssue('info', 'siparis', 'Ödenmemiş sipariş', `Sipariş (${formatMoney(o.amount)}) tamamlandı ama ${formatMoney(o.remainingAmount)} ödenmemiş.`, 'Ödeme yapılmalı.', [o.id]);
    }
  });

  // ═══════════════════════════════════════
  // 6. FATURA TUTARLILIĞI
  // ═══════════════════════════════════════
  const activeInvoices = (db.invoices || []).filter(f => !f.deleted);

  // 6a. Taksit toplamı fatura tutarıyla eşleşmiyor
  activeInvoices.forEach(inv => {
    const invInstallments = (db.installments || []).filter((t: { invoiceId?: string }) => t.invoiceId === inv.id);
    if (invInstallments.length > 0) {
      const taksitToplam = invInstallments.reduce((s: number, t: { amount: number }) => s + t.amount, 0);
      if (Math.abs(taksitToplam - inv.total) > 0.01) {
        addIssue('critical', 'fatura', 'Taksit-fatura uyumsuzluğu', `Fatura #${inv.invoiceNo || inv.id} toplam: ${formatMoney(inv.total)}, taksitler: ${formatMoney(taksitToplam)}.`, 'Taksit tutarlarını düzeltin.', [inv.id]);
      }
    }
  });

  // ═══════════════════════════════════════
  // 7. VERİ KALİTESİ
  // ═══════════════════════════════════════

  // 7a. localStorage boyut kontrolü
  try {
    const usage = JSON.stringify(db).length;
    if (usage > 4 * 1024 * 1024) {
      addIssue('critical', 'veri', 'Kritik veri boyutu', `Veritabanı boyutu ${(usage / 1024 / 1024).toFixed(1)}MB — localStorage limiti aşılabilir.`, 'Eski stok hareketlerini veya log kayıtlarını temizleyin.');
    } else if (usage > 2 * 1024 * 1024) {
      addIssue('warning', 'veri', 'Büyük veri boyutu', `Veritabanı boyutu ${(usage / 1024 / 1024).toFixed(1)}MB — yakında sorun çıkabilir.`, 'Stok hareketleri ve aktivite loglarını temizlemeyi düşünün.');
    }
  } catch { /* ignore */ }

  // 7b. Tarih formatı kontrolü (ISO string olmalı)
  activeSales.forEach(s => {
    if (s.createdAt && !/^\d{4}-\d{2}-\d{2}T/.test(s.createdAt)) {
      addIssue('info', 'veri', 'Geçersiz tarih formatı', `Satış "${s.productName}" tarihi "${s.createdAt}" — ISO formatında değil.`, 'Tarih düzeltilmeli.', [s.id]);
    }
  });

  // 7c. Soft-delete tutarlılığı (deleted kayıtlarda hâlâ işlem olmamalı)
  const deletedSaleIds = new Set(db.sales.filter(s => s.deleted).map(s => s.id));
  activeKasa.forEach(k => {
    if (k.relatedId && deletedSaleIds.has(k.relatedId)) {
      addIssue('warning', 'veri', 'Silinmiş satışa bağlı kasa kaydı', `Kasa "${k.description || k.id}" silinmiş bir satışa bağlı.`, 'Kasa kaydı da soft-delete edilmeli.', [k.id]);
    }
  });

  // 7d. Yetim stok hareketi (ürün bulunamıyor)
  (db.stockMovements || []).forEach(sm => {
    if (sm.productId && !db.products.find(p => p.id === sm.productId)) {
      addIssue('info', 'referans', 'Yetim stok hareketi', `Stok hareketi "${sm.productName || sm.productId}" ürünü bulunamadı.`);
    }
  });

  // ═══════════════════════════════════════
  // 8. PLANLANAN ÖZELLİKLER (Hatırlatma)
  // ═══════════════════════════════════════

  // 8a. Taksit takip
  const unpaidInstallments = (db.installments || []).filter(t => !t.paid);
  if (unpaidInstallments.length > 0) {
    addIssue('info', 'fatura', 'Ödenmemiş taksitler', `${unpaidInstallments.length} ödenmemiş taksit var.`, 'Fatura detayından taksit ödemelerini takip edin.');
  }

  // ═══════════════════════════════════════
  // 9. LOCALSTORAGE BOYUT İZLEME
  // ═══════════════════════════════════════
  try {
    const dbStr = JSON.stringify(db);
    const sizeMB = dbStr.length / (1024 * 1024);
    if (sizeMB > 7) {
      addIssue('critical', 'veri', 'Kritik veri boyutu', `Veritabanı boyutu ${sizeMB.toFixed(2)} MB — localStorage limiti aşılabilir!`, 'Eski stok hareketlerini veya aktivite loglarını temizleyin.');
    } else if (sizeMB > 4) {
      addIssue('warning', 'veri', 'Büyük veri boyutu', `Veritabanı boyutu ${sizeMB.toFixed(2)} MB — dikkat edilmesi önerilir.`, 'Yedek alın ve gereksiz verileri temizleyin.');
    }
  } catch { /* ignore */ }

  // 9a. StockMovements boyut uyarısı
  if ((db.stockMovements || []).length > 800) {
    addIssue('info', 'stok', 'Çok fazla stok hareketi', `${db.stockMovements.length} stok hareketi kaydı var (limit: 1000).`, 'Otomatik temizleme yakında devreye girecek.');
  }

  return [...issues, ...detectAnomalies(db)];
}

// ── Anomali Tespiti ──────────────────────────────────────────────────────────

/**
 * Proaktif anomali tespiti.
 * Yalnızca runIntegrityCheck çağrıldığında çalışır (interval/timer yok).
 * 100ms timeout korumalı — aşılırsa boş dizi döner.
 *
 * Kurallar:
 * 1. Günlük satış anomalisi: aynı cariId'ye aynı günde toplam satış > 30 günlük ort. × 5
 * 2. Kasa hareketi anomalisi: tek KasaEntry.amount > kasa 30 günlük ort. × 10
 * 3. Uzun süreli alacak: balance > 0 ve lastTransaction > 60 gün önce
 * 4. TRANSACTION_LIMIT aşımı: KasaEntry.amount > 100_000
 */
export function detectAnomalies(db: DB): IntegrityIssue[] {
  const startTime = performance.now();
  const TIMEOUT_MS = 100;

  try {
    const issues: IntegrityIssue[] = [];
    let issueIdx = 0;
    const addIssue = (
      severity: IssueSeverity,
      title: string,
      detail: string,
      suggestion?: string,
      relatedIds?: string[]
    ) => {
      issues.push({
        id: `anomali_${++issueIdx}`,
        severity,
        category: 'anomali',
        title,
        detail,
        suggestion,
        relatedIds,
      });
    };

    const now = Date.now();
    const MS_PER_DAY = 86_400_000;
    const activeSales = db.sales.filter(s => !s.deleted && s.status === 'tamamlandi');
    const activeKasa = db.kasa.filter(k => !k.deleted);

    // ── Kural 1: Günlük satış anomalisi ──────────────────────────────────────
    // Aynı cariId'ye aynı takvim günü toplam satış > 30 günlük ort. × 5
    // Min 3 işlem şartı (son 30 günde)
    if (performance.now() - startTime < TIMEOUT_MS) {
      const thirtyDaysAgo = now - 30 * MS_PER_DAY;

      // Her cari için son 30 günlük satışları grupla
      const cariSalesMap = new Map<string, { date: string; total: number }[]>();
      for (const s of activeSales) {
        const cariId = s.cariId || s.customerId;
        if (!cariId) continue;
        const saleTime = new Date(s.createdAt).getTime();
        if (saleTime < thirtyDaysAgo) continue;
        if (!cariSalesMap.has(cariId)) cariSalesMap.set(cariId, []);
        cariSalesMap.get(cariId)!.push({
          date: s.createdAt.slice(0, 10), // YYYY-MM-DD
          total: s.total,
        });
      }

      for (const [cariId, salesList] of cariSalesMap) {
        if (salesList.length < 3) continue; // min 3 işlem şartı

        // Günlük toplamları hesapla
        const dailyTotals = new Map<string, number>();
        for (const { date, total } of salesList) {
          dailyTotals.set(date, (dailyTotals.get(date) ?? 0) + total);
        }

        // 30 günlük günlük ortalama
        const totalAmount = salesList.reduce((s, e) => s + e.total, 0);
        const uniqueDays = dailyTotals.size;
        const dailyAvg = uniqueDays > 0 ? totalAmount / 30 : 0; // 30 günlük ort.

        if (dailyAvg <= 0) continue;

        // Eşiği aşan günleri tespit et
        for (const [date, dayTotal] of dailyTotals) {
          if (dayTotal > dailyAvg * 5) {
            const cari = db.cari.find(c => c.id === cariId);
            const cariName = cari?.name ?? cariId;
            addIssue(
              'warning',
              'Günlük Satış Anomalisi',
              `"${cariName}" için ${date} tarihinde günlük satış (${formatMoney(dayTotal)}) 30 günlük ortalamanın (${formatMoney(dailyAvg)}) 5 katını aştı.`,
              'Olağandışı satış hareketini kontrol edin.',
              [cariId]
            );
          }
        }
      }
    }

    // ── Kural 2: Kasa hareketi anomalisi ─────────────────────────────────────
    // Tek KasaEntry.amount > kasa 30 günlük ort. × 10
    // Min 3 işlem şartı (son 30 günde)
    if (performance.now() - startTime < TIMEOUT_MS) {
      const thirtyDaysAgo = now - 30 * MS_PER_DAY;

      // Her kasa için son 30 günlük hareketleri grupla
      const kasaEntriesMap = new Map<string, KasaEntry[]>();
      for (const k of activeKasa) {
        const entryTime = new Date(k.createdAt).getTime();
        if (entryTime < thirtyDaysAgo) continue;
        if (!kasaEntriesMap.has(k.kasa)) kasaEntriesMap.set(k.kasa, []);
        kasaEntriesMap.get(k.kasa)!.push(k);
      }

      for (const [kasaId, entries] of kasaEntriesMap) {
        if (entries.length < 3) continue; // min 3 işlem şartı

        // 30 günlük günlük ortalama hareket
        const totalAmount = entries.reduce((s, e) => s + e.amount, 0);
        const dailyAvg = totalAmount / 30;

        if (dailyAvg <= 0) continue;

        // Tek işlem eşiği aşıyor mu?
        for (const entry of entries) {
          if (entry.amount > dailyAvg * 10) {
            addIssue(
              'warning',
              'Kasa Hareketi Anomalisi',
              `"${kasaId}" kasasında tek işlem tutarı (${formatMoney(entry.amount)}) 30 günlük günlük ortalamanın (${formatMoney(dailyAvg)}) 10 katını aştı.`,
              'Olağandışı kasa hareketini kontrol edin.',
              [entry.id]
            );
          }
        }
      }
    }

    // ── Kural 3: Uzun süreli alacak ──────────────────────────────────────────
    // balance > 0 ve lastTransaction > 60 gün önce
    if (performance.now() - startTime < TIMEOUT_MS) {
      const sixtyDaysAgo = now - 60 * MS_PER_DAY;
      const activeCari = db.cari.filter(c => !c.deleted && c.type === 'musteri');

      for (const c of activeCari) {
        if ((c.balance ?? 0) <= 0) continue;
        if (!c.lastTransaction) continue;
        const lastTxTime = new Date(c.lastTransaction).getTime();
        if (lastTxTime < sixtyDaysAgo) {
          const daysSince = Math.floor((now - lastTxTime) / MS_PER_DAY);
          addIssue(
            'info',
            'Uzun Süreli Alacak',
            `"${c.name}" müşterisinin ${formatMoney(c.balance)} alacağı var ve son işlem ${daysSince} gün önce yapıldı.`,
            'Tahsilat yapılması önerilir.',
            [c.id]
          );
        }
      }
    }

    // ── Kural 4: TRANSACTION_LIMIT aşımı ─────────────────────────────────────
    // Tek KasaEntry.amount > 100_000 (TRANSACTION_LIMIT)
    if (performance.now() - startTime < TIMEOUT_MS) {
      for (const k of activeKasa) {
        if (k.amount > TRANSACTION_LIMIT) {
          addIssue(
            'warning',
            'İşlem Limiti Aşımı',
            `Kasa kaydı "${k.description || k.id}" tutarı (${formatMoney(k.amount)}) işlem limitini (${formatMoney(TRANSACTION_LIMIT)}) aşıyor.`,
            'Yüksek tutarlı işlemleri doğrulayın.',
            [k.id]
          );
        }
      }
    }

    return issues;
  } catch {
    // Hata durumunda boş dizi döndür — uygulama çökmez
    return [];
  }
}

// ── Özet istatistikleri ──
export function getIntegritySummary(issues: IntegrityIssue[]) {
  return {
    total: issues.length,
    critical: issues.filter(i => i.severity === 'critical').length,
    warning: issues.filter(i => i.severity === 'warning').length,
    info: issues.filter(i => i.severity === 'info').length,
    byCategory: Object.fromEntries(
      (['stok', 'kasa', 'cari', 'satis', 'siparis', 'fatura', 'veri', 'referans', 'anomali'] as IssueCategory[])
        .map(cat => [cat, issues.filter(i => i.category === cat).length])
        .filter(([, count]) => (count as number) > 0)
    ),
    isHealthy: issues.filter(i => i.severity === 'critical').length === 0,
  };
}

// ── Hızlı sağlık skoru (0-100) ──
export function getHealthScore(db: DB): number {
  const issues = runIntegrityCheck(db);
  const critPenalty = issues.filter(i => i.severity === 'critical').length * 15;
  const warnPenalty = issues.filter(i => i.severity === 'warning').length * 5;
  const infoPenalty = issues.filter(i => i.severity === 'info').length * 1;
  return Math.max(0, 100 - critPenalty - warnPenalty - infoPenalty);
}