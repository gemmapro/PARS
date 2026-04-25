/**
 * Akıllı Bildirim Motoru
 * DB verisini tarayarak proaktif uyarılar üretir.
 */
import type { DB } from '@/types';
import { formatMoney } from './utils-tr';

export type NotifSeverity = 'critical' | 'warning' | 'info';
export type NotifCategory = 'stok' | 'kasa' | 'cari' | 'siparis' | 'fatura' | 'sistem';

export interface AppNotification {
  id: string;
  severity: NotifSeverity;
  category: NotifCategory;
  icon: string;
  title: string;
  detail: string;
  targetTab?: string;
  relatedId?: string;
  generatedAt: string;
}

const SEVERITY_ORDER: Record<NotifSeverity, number> = { critical: 0, warning: 1, info: 2 };

export function generateNotifications(db: DB): AppNotification[] {
  const notifs: AppNotification[] = [];
  const now = new Date().toISOString();
  let idx = 0;

  const add = (
    severity: NotifSeverity,
    category: NotifCategory,
    icon: string,
    title: string,
    detail: string,
    targetTab?: string,
    relatedId?: string,
  ) => {
    notifs.push({ id: `notif_${++idx}`, severity, category, icon, title, detail, targetTab, relatedId, generatedAt: now });
  };

  // ── 1. STOK ──────────────────────────────────────────────────────
  const activeProducts = db.products.filter(p => !p.deleted);

  const sifirStok = activeProducts.filter(p => p.stock === 0);
  if (sifirStok.length > 0) {
    const names = sifirStok.slice(0, 3).map(p => p.name).join(', ');
    const extra = sifirStok.length > 3 ? ` ve ${sifirStok.length - 3} ürün daha` : '';
    add('critical', 'stok', '📦', `${sifirStok.length} ürün stokta yok`, `${names}${extra}`, 'products');
  }

  const kritikStok = activeProducts.filter(p => p.stock > 0 && p.stock <= p.minStock && p.minStock > 0);
  if (kritikStok.length > 0) {
    kritikStok.slice(0, 4).forEach(p => {
      add('warning', 'stok', '⚠️', `Kritik stok: ${p.name}`, `${p.stock} adet kaldı (min: ${p.minStock})`, 'products', p.id);
    });
    if (kritikStok.length > 4) {
      add('warning', 'stok', '⚠️', `${kritikStok.length - 4} ürün daha kritik seviyede`, 'Stok sayfasını kontrol edin', 'products');
    }
  }

  // ── 2. KASA ──────────────────────────────────────────────────────
  const kasaMap = new Map<string, number>();
  db.kasa.filter(k => !k.deleted).forEach(k => {
    const cur = kasaMap.get(k.kasa) ?? 0;
    kasaMap.set(k.kasa, cur + (k.type === 'gelir' ? k.amount : -k.amount));
  });
  kasaMap.forEach((balance, kasaId) => {
    if (balance < -0.01) {
      add('critical', 'kasa', '🚨', `Negatif kasa: ${kasaId}`, `Bakiye: ${formatMoney(balance)}`, 'kasa');
    }
  });

  // ── 3. CARİ ALACAK ───────────────────────────────────────────────
  const buyukAlacaklar = db.cari
    .filter(c => !c.deleted && c.type === 'musteri' && c.balance > 5000)
    .sort((a, b) => b.balance - a.balance);

  buyukAlacaklar.slice(0, 5).forEach(c => {
    const severity: NotifSeverity = c.balance > 20000 ? 'warning' : 'info';
    add(severity, 'cari', '👤', `Yüksek alacak: ${c.name}`, `Bekleyen: ${formatMoney(c.balance)}`, 'cari', c.id);
  });

  if (buyukAlacaklar.length > 5) {
    const toplam = buyukAlacaklar.reduce((s, c) => s + c.balance, 0);
    add('info', 'cari', '💼', `Toplam ${buyukAlacaklar.length} müşteri bakiye`, `Toplam alacak: ${formatMoney(toplam)}`, 'cari');
  }

  // ── 4. SİPARİŞ ───────────────────────────────────────────────────
  const bekliyenSiparisler = db.orders.filter(o => !o.deleted && o.status === 'bekliyor');
  if (bekliyenSiparisler.length > 0) {
    add('info', 'siparis', '🚚', `${bekliyenSiparisler.length} sipariş teslim bekliyor`, `Toplam: ${formatMoney(bekliyenSiparisler.reduce((s, o) => s + o.amount, 0))}`, 'suppliers');
  }

  const odenmemisTamam = db.orders.filter(o => !o.deleted && o.status === 'tamamlandi' && o.remainingAmount > 0.01);
  if (odenmemisTamam.length > 0) {
    add('warning', 'siparis', '💳', `${odenmemisTamam.length} tamamlanan sipariş ödenmemiş`, `Toplam borç: ${formatMoney(odenmemisTamam.reduce((s, o) => s + o.remainingAmount, 0))}`, 'suppliers');
  }

  // ── 5. FATURA ────────────────────────────────────────────────────
  const activeInvoices = (db.invoices || []).filter(f => !f.deleted);
  const todayTs = Date.now();
  const yaklasanVade = activeInvoices.filter(inv => {
    if (inv.status === 'odendi' || inv.status === 'iptal') return false;
    if (!inv.dueDate) return false;
    const diff = (new Date(inv.dueDate).getTime() - todayTs) / 86400000;
    return diff >= 0 && diff <= 7;
  });

  if (yaklasanVade.length > 0) {
    yaklasanVade.forEach(inv => {
      const diff = Math.round((new Date(inv.dueDate!).getTime() - todayTs) / 86400000);
      const label = diff === 0 ? 'BUGÜN' : `${diff} gün sonra`;
      add('warning', 'fatura', '🧾', `Fatura vadesi: ${inv.cariName}`, `#${inv.invoiceNo || inv.id.slice(-6)} · ${formatMoney(inv.total)} · Vade: ${label}`, 'fatura', inv.id);
    });
  }

  const gecmisVade = activeInvoices.filter(inv => {
    if (inv.status === 'odendi' || inv.status === 'iptal') return false;
    if (!inv.dueDate) return false;
    return new Date(inv.dueDate).getTime() < todayTs;
  });

  if (gecmisVade.length > 0) {
    const toplam = gecmisVade.reduce((s, f) => s + f.total, 0);
    add('critical', 'fatura', '🔴', `${gecmisVade.length} fatura vadesi geçmiş`, `Toplam: ${formatMoney(toplam)}`, 'fatura');
  }

  // Sırala: critical → warning → info
  return notifs.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export function getUnreadCount(notifs: AppNotification[], dismissed: Set<string>): number {
  return notifs.filter(n => !dismissed.has(n.id)).length;
}
