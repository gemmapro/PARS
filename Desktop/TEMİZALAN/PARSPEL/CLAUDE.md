# Soba Yönetim — Claude Code Kılavuzu

## Proje Özeti

Soba, pelet ve boru satışı yapan bir işletmenin yönetim uygulaması.
React 19 + TypeScript + Vite + TailwindCSS v4 + Firebase Firestore (REST) kullanılarak geliştirilmiştir.

### Veri Katmanı
- **Depolama:** `localStorage` (birincil) + Firebase Firestore (bulut yedek)
- **Hook:** `src/hooks/useDB.ts` — tüm CRUD işlemleri buradan geçer
- **Senkronizasyon:** Uygulama açılışında Firestore'dan yükle, kayıtta 1s debounce ile Firestore'a gönder
- **Versiyon:** `db._version` artan sayaç; bulut ile yerel arasında hangisi daha yüksekse kazanır

### Temel Modüller
| Sayfa | Dosya | Açıklama |
|-------|-------|----------|
| Dashboard | `src/pages/Dashboard.tsx` | Özet metrikler |
| Ürünler | `src/pages/Products.tsx` | Stok yönetimi |
| Satış | `src/pages/Sales.tsx` | Satış işlemleri |
| Kasa | `src/pages/Kasa.tsx` | Nakit/banka hareketleri |
| Cari | `src/pages/Cari.tsx` | Müşteri/tedarikçi cari hesapları |
| Fatura | `src/pages/Fatura.tsx` | Fatura yönetimi |
| Bütçe | `src/pages/Butce.tsx` | Bütçe planlama |
| Pelet | `src/pages/Pelet.tsx` | Pelet alım/satım |
| Boru Ted. | `src/pages/BoruTed.tsx` | Boru tedariki |

### Muhasebe Kuralları (Altın Kurallar)
1. **Çift taraflı kayıt:** Her satış hem stok düşürür hem kasa/cari etkiler.
2. **Kasa bakiyesi:** `kasa` kayıtlarında `type: 'gelir'` → bakiye artar, diğer her şey → azalır.
3. **Cari bakiye:** Müşteri borcu pozitif, tedarikçi borcu negatif (veya tam tersi — mevcut mantığa uy).
4. **Stok hareketi:** Her stok değişikliği `stockMovements` dizisine kayıt düşer.
5. **Fatura–Satış bağlantısı:** Fatura oluşturulduğunda ilgili satış kaydıyla eşleştirilmeli.
6. **Taksit:** `installments` dizisi; toplam taksit tutarı orijinal fatura tutarıyla eşit olmalı.
7. **Silme yasağı:** Hiçbir finansal kayıt gerçekten silinmez; `deleted: true` ile işaretlenir (soft-delete).

---

## Geliştirme İş Akışı

Bu proje **5 adımlı kalite döngüsü** ile geliştirilir:

```
1. [SONNET] Özellik Ekle   →  /project:1-ozellik-ekle
2. [SONNET] Test Yaz        →  /project:2-test-olustur
3. [OPUS]   Kod İnceleme    →  /project:3-kod-incele
4. [SONNET] Sorunları Düzelt →  /project:4-sorun-duzelt
5. [OPUS]   Son Kontrol     →  /project:5-son-kontrol
```

### Model Seçimi
| Adım | Model | Neden |
|------|-------|-------|
| Özellik & Test | `claude-sonnet-4-6` | Hız, maliyet, kod üretimi |
| İnceleme & Kontrol | `claude-opus-4-6` | Derin analiz, mantık doğrulaması |

CLI'da model seçmek için:
```bash
claude --model claude-opus-4-6
claude --model claude-sonnet-4-6
```

---

## Kod Standartları

- **Dil:** Tüm kullanıcı arayüzü Türkçe; kod ve yorumlar Türkçe veya İngilizce
- **State:** Sadece `useDB` hook'u ile; doğrudan `localStorage` yazma yasak
- **Para formatı:** Her zaman `formatMoney()` veya `formatMoneyShort()` kullan
- **ID üretimi:** Her zaman `genId()` kullan
- **Tarih:** Her zaman ISO string; gösterimde `formatDate()` / `formatDateShort()`
- **Soft delete:** Finansal kayıtlarda `deleted: true` kullan, diziden çıkarma
- **TypeScript:** `any` kullanma; tip tanımlarını `src/types/index.ts`'e ekle

---

## Bilinen Kısıtlamalar

- Test framework kurulu değil (`vitest` veya `jest` henüz eklenmedi)
- Firebase API anahtarı client-side; sadece Firestore güvenlik kuralları ile korunuyor
- `localStorage` 5–10MB limiti; büyük veri setlerinde dikkat
