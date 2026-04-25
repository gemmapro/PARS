#!/usr/bin/env node
/**
 * archive.js — PARSPEL production build arşivleyici
 *
 * Kullanım: node scripts/archive.js
 *
 * Adımlar:
 *  1. dist/ temizle
 *  2. npm run build
 *  3. Dosyaları topla (dist/, package.json, package-lock.json, .env)
 *  4. build-manifest.json ve README-DEPLOY.md üret
 *  5. ZIP arşivi oluştur → parspel-build-<versiyon>-<YYYYMMDD-HHmmss>.zip
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import zlib from 'zlib';
import stream from 'stream';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

// ESM'de __dirname eşdeğeri
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Proje kökü (scripts/ bir üst dizin)
const PROJECT_ROOT = path.resolve(__dirname, '..');

/**
 * Arşiv dosya adını üretir.
 *
 * @param {string} version - Paket versiyonu (örn. "2.0.0")
 * @param {Date} date - Tarih nesnesi (yerel saat kullanılır)
 * @returns {string} "parspel-build-<version>-<YYYYMMDD-HHmmss>.zip" formatında dosya adı
 *
 * @example
 * generateArchiveName('2.0.0', new Date('2026-04-15T14:30:22'))
 * // → 'parspel-build-2.0.0-20260415-143022.zip'
 */
export function generateArchiveName(version, date) {
  const pad = (n) => String(n).padStart(2, '0');

  const YYYY = date.getFullYear();
  const MM   = pad(date.getMonth() + 1);
  const DD   = pad(date.getDate());
  const HH   = pad(date.getHours());
  const mm   = pad(date.getMinutes());
  const ss   = pad(date.getSeconds());

  return `parspel-build-${version}-${YYYY}${MM}${DD}-${HH}${mm}${ss}.zip`;
}

/**
 * Build manifest JSON'ını üretir.
 *
 * @param {{ name: string, version: string }} pkg - package.json'dan name ve version
 * @param {{ absolutePath: string, archivePath: string }[]} files - Dahil edilecek dosya listesi
 * @param {Date} date - Build tarihi
 * @returns {string} Pretty-printed JSON (2 boşluk girintili)
 *
 * @example
 * generateManifest({ name: 'parspel', version: '2.0.0' }, files, new Date())
 * // → '{\n  "name": "parspel",\n  "version": "2.0.0", ...\n}'
 */
export function generateManifest(pkg, files, date) {
  /** @type {{ name: string, version: string, buildDate: string, nodeVersion: string, includedFiles: string[] }} */
  const manifest = {
    name: pkg.name,
    version: pkg.version,
    buildDate: date.toISOString(),
    nodeVersion: process.version,
    includedFiles: files.map((f) => f.archivePath),
  };

  return JSON.stringify(manifest, null, 2);
}

/**
 * README-DEPLOY.md içeriğini üretir.
 *
 * @param {string} version - Paket versiyonu (örn. "2.0.0")
 * @param {Date} date - Build tarihi
 * @param {boolean} envIncluded - .env dosyasının arşive eklenip eklenmediği
 * @returns {string} README-DEPLOY.md dosyasının içeriği
 *
 * @example
 * generateReadme('2.0.0', new Date('2026-04-15T14:30:22'), true)
 * // → '# PARSPEL — Kurulum Talimatları\n...'
 */
export function generateReadme(version, date, envIncluded) {
  const buildDateStr = date.toLocaleString('tr-TR');

  const envSection = envIncluded
    ? `
## ⚠️ Ortam Değişkenleri (.env) Uyarısı

Bu arşiv, \`.env\` dosyasını içermektedir. Bu dosya **hassas bilgiler** (API anahtarları, proje ID'leri vb.) barındırır.

> **Önemli:** Arşivi hedef ortama açmadan önce \`.env\` dosyasını hedef ortama uygun değerlerle güncelleyin.
> Kaynak ortama ait API anahtarları ve proje ID'leri **üretim ortamında kullanılmamalıdır**.
`
    : '';

  return `# PARSPEL — Kurulum Talimatları

## Build Bilgileri

- **Build Tarihi:** ${buildDateStr}
- **PARSPEL Versiyonu:** ${version}

## Kurulum Adımları

### 1. Bağımlılıkları Yükle

Arşivi açtıktan sonra proje dizininde aşağıdaki komutu çalıştırın:

\`\`\`bash
npm install --production
\`\`\`

### 2. Uygulamayı Başlat

Statik dosyaları sunmak için:

\`\`\`bash
npx serve dist
\`\`\`
${envSection}
---

*Bu dosya PARSPEL arşivleyici tarafından otomatik olarak oluşturulmuştur.*
`;
}

/**
 * dist/ dizinini siler. Dizin yoksa hata fırlatmaz.
 *
 * @param {string} distPath - Silinecek dist/ dizininin tam yolu
 * @returns {void}
 */
export function cleanDist(distPath) {
  fs.rmSync(distPath, { recursive: true, force: true });
}

/**
 * npm run build komutunu çalıştırır.
 * Build başarısız olursa hata mesajı yazar ve process.exit(1) ile sonlanır.
 *
 * @returns {void}
 */
export function runBuild() {
  try {
    execSync('npm run build', { stdio: 'inherit' });
  } catch (err) {
    console.error('Build başarısız:', err.message);
    process.exit(1);
  }
}

/**
 * dist/ dizininin var olduğunu ve en az bir dosya içerdiğini doğrular.
 * Koşul sağlanmazsa hata mesajı yazar ve process.exit(1) ile sonlanır.
 *
 * @param {string} distPath - Kontrol edilecek dist/ dizininin tam yolu
 * @returns {void}
 */
export function validateDist(distPath) {
  if (!fs.existsSync(distPath)) {
    console.error(`dist/ dizini bulunamadı: ${distPath}`);
    process.exit(1);
  }

  /**
   * Dizini özyinelemeli olarak tarar ve dosya sayısını döndürür.
   * @param {string} dir
   * @returns {number}
   */
  function countFiles(dir) {
    let count = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        count += countFiles(path.join(dir, entry.name));
      } else {
        count += 1;
      }
    }
    return count;
  }

  if (countFiles(distPath) === 0) {
    console.error(`dist/ dizini boş: ${distPath}`);
    process.exit(1);
  }
}

/**
 * Proje kökünü tarar ve arşive dahil edilecek dosyaları döndürür.
 *
 * Dahil edilenler:
 *  - dist/** (özyinelemeli, yalnızca dist/ mevcutsa)
 *  - package.json (her zaman)
 *  - package-lock.json (varsa)
 *  - .env (varsa)
 *
 * Dışlananlar: node_modules/, src/, android/, .kiro/, .git/,
 *              *.local, vite.config.ts, tsconfig*.json, tailwind.config.*
 *
 * @param {string} root - Proje kök dizininin tam yolu
 * @returns {{ absolutePath: string, archivePath: string }[]}
 *
 * @example
 * collectFiles('/home/user/parspel')
 * // → [
 * //     { absolutePath: '/home/user/parspel/dist/index.html', archivePath: 'parspel-build/dist/index.html' },
 * //     { absolutePath: '/home/user/parspel/package.json',    archivePath: 'parspel-build/package.json' },
 * //   ]
 */
export function collectFiles(root) {
  /** @type {{ absolutePath: string, archivePath: string }[]} */
  const entries = [];

  /**
   * Verilen absolutePath için archivePath üretir.
   * Windows'ta ters eğik çizgileri düz eğik çizgiye çevirir.
   *
   * @param {string} absolutePath
   * @returns {string}
   */
  function toArchivePath(absolutePath) {
    const rel = path.relative(root, absolutePath).replace(/\\/g, '/');
    return `parspel-build/${rel}`;
  }

  /**
   * Dizini özyinelemeli olarak tarar, her dosya için callback çağırır.
   *
   * @param {string} dir
   * @param {(absolutePath: string) => void} onFile
   */
  function walkDir(dir, onFile) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(fullPath, onFile);
      } else {
        onFile(fullPath);
      }
    }
  }

  // 1. dist/** — yalnızca dist/ mevcutsa
  const distPath = path.join(root, 'dist');
  if (fs.existsSync(distPath)) {
    walkDir(distPath, (absolutePath) => {
      entries.push({ absolutePath, archivePath: toArchivePath(absolutePath) });
    });
  }

  // 2. package.json — her zaman dahil
  const packageJsonPath = path.join(root, 'package.json');
  entries.push({
    absolutePath: packageJsonPath,
    archivePath: toArchivePath(packageJsonPath),
  });

  // 3. package-lock.json — varsa dahil
  const packageLockPath = path.join(root, 'package-lock.json');
  if (fs.existsSync(packageLockPath)) {
    entries.push({
      absolutePath: packageLockPath,
      archivePath: toArchivePath(packageLockPath),
    });
  }

  // 4. .env — varsa dahil
  const envPath = path.join(root, '.env');
  if (fs.existsSync(envPath)) {
    entries.push({
      absolutePath: envPath,
      archivePath: toArchivePath(envPath),
    });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// CRC-32 yardımcı fonksiyonu
// ---------------------------------------------------------------------------

/**
 * Standart CRC-32 lookup tablosunu oluşturur (polinom: 0xEDB88320).
 * @returns {Uint32Array}
 */
function buildCrc32Table() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
}

const CRC32_TABLE = buildCrc32Table();

/**
 * Verilen Buffer için CRC-32 değerini hesaplar.
 *
 * @param {Buffer} buf
 * @returns {number} 32-bit işaretsiz CRC-32 değeri
 */
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// createZip
// ---------------------------------------------------------------------------

/**
 * Verilen entry listesinden PKZIP formatında bir ZIP dosyası oluşturur ve
 * `outputPath`'e yazar.
 *
 * @param {{ archivePath: string, content: Buffer }[]} entries - ZIP'e eklenecek dosyalar
 * @param {string} outputPath - ZIP dosyasının yazılacağı tam yol
 * @returns {void}
 */
export function createZip(entries, outputPath) {
  /** @type {Buffer[]} */
  const parts = [];

  /**
   * Her entry için local file header + compressed data bilgilerini tutar.
   * @type {{ nameBytes: Buffer, crc: number, compressedSize: number, uncompressedSize: number, localHeaderOffset: number }[]}
   */
  const centralDirInfos = [];

  let currentOffset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.archivePath, 'utf8');
    const uncompressedSize = entry.content.length;
    const compressed = zlib.deflateRawSync(entry.content);
    const compressedSize = compressed.length;
    const fileCrc = crc32(entry.content);

    // Local File Header — 30 bayt sabit kısım + dosya adı
    const localHeader = Buffer.alloc(30 + nameBytes.length);
    localHeader.writeUInt32LE(0x04034b50, 0);   // signature
    localHeader.writeUInt16LE(20, 4);            // version needed
    localHeader.writeUInt16LE(0, 6);             // general purpose bit flag
    localHeader.writeUInt16LE(8, 8);             // compression method: DEFLATE
    localHeader.writeUInt16LE(0, 10);            // last mod file time
    localHeader.writeUInt16LE(0, 12);            // last mod file date
    localHeader.writeUInt32LE(fileCrc, 14);      // CRC-32
    localHeader.writeUInt32LE(compressedSize, 18);   // compressed size
    localHeader.writeUInt32LE(uncompressedSize, 22); // uncompressed size
    localHeader.writeUInt16LE(nameBytes.length, 26); // file name length
    localHeader.writeUInt16LE(0, 28);            // extra field length
    nameBytes.copy(localHeader, 30);

    centralDirInfos.push({
      nameBytes,
      crc: fileCrc,
      compressedSize,
      uncompressedSize,
      localHeaderOffset: currentOffset,
    });

    parts.push(localHeader);
    parts.push(compressed);
    currentOffset += localHeader.length + compressedSize;
  }

  // Central Directory Headers
  const centralDirOffset = currentOffset;
  let centralDirSize = 0;

  for (const info of centralDirInfos) {
    const cdHeader = Buffer.alloc(46 + info.nameBytes.length);
    cdHeader.writeUInt32LE(0x02014b50, 0);          // signature
    cdHeader.writeUInt16LE(20, 4);                   // version made by
    cdHeader.writeUInt16LE(20, 6);                   // version needed
    cdHeader.writeUInt16LE(0, 8);                    // general purpose bit flag
    cdHeader.writeUInt16LE(8, 10);                   // compression method: DEFLATE
    cdHeader.writeUInt16LE(0, 12);                   // last mod file time
    cdHeader.writeUInt16LE(0, 14);                   // last mod file date
    cdHeader.writeUInt32LE(info.crc, 16);            // CRC-32
    cdHeader.writeUInt32LE(info.compressedSize, 20); // compressed size
    cdHeader.writeUInt32LE(info.uncompressedSize, 24); // uncompressed size
    cdHeader.writeUInt16LE(info.nameBytes.length, 28); // file name length
    cdHeader.writeUInt16LE(0, 30);                   // extra field length
    cdHeader.writeUInt16LE(0, 32);                   // file comment length
    cdHeader.writeUInt16LE(0, 34);                   // disk number start
    cdHeader.writeUInt16LE(0, 36);                   // internal file attributes
    cdHeader.writeUInt32LE(0, 38);                   // external file attributes
    cdHeader.writeUInt32LE(info.localHeaderOffset, 42); // relative offset of local header
    info.nameBytes.copy(cdHeader, 46);

    parts.push(cdHeader);
    centralDirSize += cdHeader.length;
  }

  // End of Central Directory Record — 22 bayt
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);              // signature
  eocd.writeUInt16LE(0, 4);                        // disk number
  eocd.writeUInt16LE(0, 6);                        // disk with start of central directory
  eocd.writeUInt16LE(entries.length, 8);           // number of entries on this disk
  eocd.writeUInt16LE(entries.length, 10);          // total number of entries
  eocd.writeUInt32LE(centralDirSize, 12);          // size of central directory
  eocd.writeUInt32LE(centralDirOffset, 16);        // offset of start of central directory
  eocd.writeUInt16LE(0, 20);                       // comment length

  parts.push(eocd);

  fs.writeFileSync(outputPath, Buffer.concat(parts));
}

/**
 * Arşiv dosyasının adını ve boyutunu (MB, 2 ondalık) konsola yazdırır.
 *
 * @param {string} archivePath - Arşiv dosyasının tam yolu
 * @returns {void}
 */
export function printSummary(archivePath) {
  const stats = fs.statSync(archivePath);
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
  const fileName = path.basename(archivePath);
  console.log(`\n✅ Arşiv oluşturuldu: ${fileName} (${sizeMB} MB)`);
}

/**
 * Ana giriş noktası — tüm adımları sırasıyla çalıştırır.
 */
async function main() {
  const startTime = Date.now();
  const now = new Date();

  console.log('🚀 PARSPEL arşivleyici başlatılıyor...');

  // package.json oku
  const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));

  const distPath = path.join(PROJECT_ROOT, 'dist');

  // 1. dist/ temizle
  console.log('🧹 dist/ temizleniyor...');
  cleanDist(distPath);

  // 2. Temiz build al
  console.log('🔨 npm run build çalıştırılıyor...');
  runBuild();
  console.log('✅ Build tamamlandı.');

  // 3. dist/ doğrula
  validateDist(distPath);

  // 4. Dosyaları topla
  const fileEntries = collectFiles(PROJECT_ROOT);

  // 5. Manifest üret ve ZipEntry listesine ekle
  const manifestJson = generateManifest(pkg, fileEntries, now);
  const readmeContent = generateReadme(
    pkg.version,
    now,
    fileEntries.some((e) => e.archivePath === 'parspel-build/.env'),
  );

  /** @type {{ archivePath: string, content: Buffer }[]} */
  const zipEntries = [
    ...fileEntries.map((e) => ({
      archivePath: e.archivePath,
      content: fs.readFileSync(e.absolutePath),
    })),
    {
      archivePath: 'parspel-build/build-manifest.json',
      content: Buffer.from(manifestJson, 'utf8'),
    },
    {
      archivePath: 'parspel-build/README-DEPLOY.md',
      content: Buffer.from(readmeContent, 'utf8'),
    },
  ];

  // 6. ZIP oluştur
  const archiveName = generateArchiveName(pkg.version, now);
  const archivePath = path.join(PROJECT_ROOT, archiveName);
  console.log(`📦 ZIP oluşturuluyor: ${archiveName}`);
  createZip(zipEntries, archivePath);

  // 7. Özet yazdır
  printSummary(archivePath);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`⏱  Toplam süre: ${elapsed}s`);
}

process.on('uncaughtException', (err) => {
  console.error('Beklenmeyen hata:', err.message);
  process.exit(1);
});

main().catch((err) => {
  console.error('Hata:', err.message);
  process.exit(1);
});
