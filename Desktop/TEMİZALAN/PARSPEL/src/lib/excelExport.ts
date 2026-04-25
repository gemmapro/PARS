import * as XLSX from 'xlsx';
import type { DB } from '@/types';

function fmtDate(iso: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}.${mm}.${yyyy}`;
  } catch {
    return iso;
  }
}

function fmtMoney(n: number): string {
  return `₺${(n || 0).toFixed(2).replace('.', ',')}`;
}

export interface ExportOptions {
  dateFrom?: string;
  dateTo?: string;
  sheets?: ('stok' | 'satislar' | 'cari' | 'kasa')[];
}

export function exportToExcel(db: DB, options: ExportOptions = {}): void {
  const wb = XLSX.utils.book_new();
  const { dateFrom, dateTo, sheets = ['stok', 'satislar', 'cari', 'kasa'] } = options;

  function inDateRange(iso: string): boolean {
    if (!dateFrom && !dateTo) return true;
    const d = new Date(iso);
    if (dateFrom && d < new Date(dateFrom)) return false;
    if (dateTo && d > new Date(dateTo + 'T23:59:59')) return false;
    return true;
  }

  if (sheets.includes('stok')) {
    const rows = db.products.filter(p => !p.deleted).map(p => ({
      'Ürün Adı': p.name,
      'Kategori': p.category,
      'Marka': p.brand || '',
      'Stok': p.stock,
      'Min Stok': p.minStock,
      'Alış Fiyatı': fmtMoney(p.cost),
      'Satış Fiyatı': fmtMoney(p.price),
      'Stok Değeri': fmtMoney(p.cost * p.stock),
      'Durum': p.stock === 0 ? 'Bitti' : p.stock <= p.minStock ? 'Az Stok' : 'Normal',
      'Eklenme Tarihi': fmtDate(p.createdAt),
      'Güncelleme Tarihi': fmtDate(p.updatedAt),
    }));
    const ws = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{}]);
    setColumnWidths(ws, [30, 12, 15, 8, 10, 15, 15, 15, 10, 18, 18]);
    XLSX.utils.book_append_sheet(wb, ws, 'Stok');
  }

  if (sheets.includes('satislar')) {
    const satislar = db.sales.filter(s => !s.deleted && inDateRange(s.createdAt));
    const rows = satislar.map(s => ({
      'Tarih': fmtDate(s.createdAt),
      'Ürün': s.productName,
      'Müşteri': db.cari.find(c => c.id === s.customerId)?.name || '',
      'Adet': s.quantity,
      'Birim Fiyat': fmtMoney(s.unitPrice),
      'Ara Toplam': fmtMoney(s.subtotal),
      'İskonto': fmtMoney(s.discountAmount),
      'Toplam': fmtMoney(s.total),
      'Kâr': fmtMoney(s.profit),
      'Ödeme': s.payment,
      'Durum': s.status === 'tamamlandi' ? 'Tamamlandı' : s.status === 'iade' ? 'İade' : 'İptal',
    }));
    const ws = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{}]);
    setColumnWidths(ws, [18, 30, 20, 8, 15, 15, 12, 15, 15, 10, 12]);
    XLSX.utils.book_append_sheet(wb, ws, 'Satışlar');
  }

  if (sheets.includes('cari')) {
    const rows = db.cari.filter(c => !c.deleted).map(c => ({
      'Ad': c.name,
      'Tür': c.type === 'musteri' ? 'Müşteri' : 'Tedarikçi',
      'Vergi No': c.taxNo || '',
      'Telefon': c.phone || '',
      'E-posta': c.email || '',
      'Adres': c.address || '',
      'Bakiye': fmtMoney(c.balance),
      'Son İşlem': fmtDate(c.lastTransaction || ''),
      'Eklenme Tarihi': fmtDate(c.createdAt),
    }));
    const ws = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{}]);
    setColumnWidths(ws, [25, 12, 15, 14, 22, 30, 15, 18, 18]);
    XLSX.utils.book_append_sheet(wb, ws, 'Cari Hesaplar');
  }

  if (sheets.includes('kasa')) {
    const kasaEntries = db.kasa.filter(k => !k.deleted && inDateRange(k.createdAt));
    const rows = kasaEntries.map(k => ({
      'Tarih': fmtDate(k.createdAt),
      'Tür': k.type === 'gelir' ? 'Gelir' : 'Gider',
      'Kasa': k.kasa,
      'Kategori': k.category || '',
      'Açıklama': k.description || '',
      'Tutar': fmtMoney(k.amount),
      'Cari': db.cari.find(c => c.id === k.cariId)?.name || '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{}]);
    setColumnWidths(ws, [18, 10, 10, 15, 35, 15, 20]);
    XLSX.utils.book_append_sheet(wb, ws, 'Kasa İşlemleri');
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `soba-rapor-${dateStr}.xlsx`);
}

function setColumnWidths(ws: XLSX.WorkSheet, widths: number[]) {
  ws['!cols'] = widths.map(w => ({ wch: w }));
}


/** Düz nesne dizisini Excel olarak indir (Reports sayfası için) */
export function exportArrayToExcel(data: Record<string, unknown>[], filename: string): void {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, 'Rapor');
  XLSX.writeFile(wb, `${filename}-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
