import { useState, useMemo } from "react";
import { Sparkles, Download, FileSpreadsheet, CheckCircle, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { type ExcelFile, type CleanOptions, cleanSheetData, exportToExcel } from "@/lib/excel-merge";

interface TemizlePageProps {
  files: ExcelFile[];
}

const defaultCleanOptions: CleanOptions = {
  trimWhitespace: true,
  deduplicateRows: false,
  fillNullsWithEmpty: false,
  standardizeCase: "none",
  standardizeDates: false,
};

export default function TemlizlePage({ files }: TemizlePageProps) {
  const [selectedFileId, setSelectedFileId] = useState<string>("");
  const [selectedSheet, setSelectedSheet] = useState<string>("");
  const [opts, setOpts] = useState<CleanOptions>(defaultCleanOptions);
  const [result, setResult] = useState<ReturnType<typeof cleanSheetData> | null>(null);
  const [preview, setPreview] = useState(false);

  const selectedFile = files.find((f) => f.id === selectedFileId);
  const sheets = selectedFile?.sheets ?? [];

  const currentSheet = useMemo(() => {
    return sheets.find((s) => s.name === selectedSheet) ?? sheets[0];
  }, [sheets, selectedSheet]);

  const setOpt = <K extends keyof CleanOptions>(key: K, val: CleanOptions[K]) => {
    setOpts((prev) => ({ ...prev, [key]: val }));
    setResult(null);
  };

  const handleClean = () => {
    if (!currentSheet) return;
    const r = cleanSheetData(currentSheet, opts);
    setResult(r);
    setPreview(true);
  };

  const handleExport = () => {
    if (!result) return;
    const name = selectedFile ? `temizlenmis_${selectedFile.name.replace(/\.[^.]+$/, "")}.xlsx` : "temizlenmis.xlsx";
    exportToExcel(result.headers, result.rows, name, currentSheet?.name ?? "Temizlenmis");
  };

  if (files.length === 0) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="text-center py-16">
          <Sparkles className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-foreground mb-2">Veri temizleme icin dosya gerekli</h2>
          <p className="text-muted-foreground">Lutfen once Dosya Yukle sayfasindan dosya yukleyin.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Veri Temizleme (ETL)</h1>
        <p className="text-muted-foreground mt-1">
          Bir dosya ve sayfa secin, temizleme seceneklerini belirleyin ve temizlenmis veriyi indirin.
        </p>
      </div>

      <Card className="border border-card-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Dosya ve Sayfa Secimi</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Dosya</label>
              <Select
                value={selectedFileId}
                onValueChange={(v) => { setSelectedFileId(v); setSelectedSheet(""); setResult(null); }}
                data-testid="select-file"
              >
                <SelectTrigger>
                  <SelectValue placeholder="Dosya secin..." />
                </SelectTrigger>
                <SelectContent>
                  {files.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      <div className="flex items-center gap-2">
                        <FileSpreadsheet className="w-4 h-4" />
                        {f.name}
                        {f.isRecovery && <Badge variant="outline" className="text-yellow-600 border-yellow-400 text-xs py-0">⚠</Badge>}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedFile && sheets.length > 1 && (
              <div className="space-y-1">
                <label className="text-sm font-medium text-foreground">Sayfa</label>
                <Select
                  value={selectedSheet || sheets[0]?.name}
                  onValueChange={(v) => { setSelectedSheet(v); setResult(null); }}
                  data-testid="select-sheet"
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sheets.map((s) => (
                      <SelectItem key={s.name} value={s.name}>
                        {s.name} ({s.rows.length} satir)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {currentSheet && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 text-sm text-muted-foreground">
              <FileSpreadsheet className="w-4 h-4 shrink-0" />
              <span>
                <strong className="text-foreground">{currentSheet.name}</strong> ·{" "}
                {currentSheet.rows.length.toLocaleString("tr-TR")} satir ·{" "}
                {currentSheet.headers.length} sutun
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {currentSheet && (
        <Card className="border border-card-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Temizleme Secenekleri</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              {
                key: "trimWhitespace" as const,
                label: "Bas/Son Boslukları Temizle",
                desc: "Hucre degerlerinin basindaki ve sonundaki boslukları kaldirir",
              },
              {
                key: "deduplicateRows" as const,
                label: "Tekrar Eden Satirlari Kaldir (Deduplication)",
                desc: "Tum sutunlarda tamamen ayni olan satir ciftlerinden birini siler",
              },
              {
                key: "fillNullsWithEmpty" as const,
                label: "Bos Hucreleri (null) Bos String ile Doldur",
                desc: "null/undefined degerleri bos metin '' ile degistirir",
              },
            ].map(({ key, label, desc }) => (
              <div key={key} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <div>
                  <p className="text-sm font-medium text-foreground">{label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                </div>
                <Switch
                  checked={opts[key] as boolean}
                  onCheckedChange={(v) => setOpt(key, v)}
                  data-testid={`switch-${key}`}
                />
              </div>
            ))}

            <div className="space-y-1 pt-1">
              <label className="text-sm font-medium text-foreground">Harf Standartlastirma</label>
              <p className="text-xs text-muted-foreground">Metin hucre degerlerinin harf biçimini standartlastir</p>
              <Select
                value={opts.standardizeCase}
                onValueChange={(v) => setOpt("standardizeCase", v as CleanOptions["standardizeCase"])}
                data-testid="select-case"
              >
                <SelectTrigger className="w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Degistirme (orijinal hali koru)</SelectItem>
                  <SelectItem value="upper">BUYUK HARF (ALL CAPS)</SelectItem>
                  <SelectItem value="lower">kucuk harf (lowercase)</SelectItem>
                  <SelectItem value="title">Baslik Harfi (Title Case)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button onClick={handleClean} className="w-full mt-2" data-testid="button-clean">
              <Sparkles className="w-4 h-4 mr-2" />
              Verileri Temizle
            </Button>
          </CardContent>
        </Card>
      )}

      {result && preview && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-4 rounded-xl bg-card border border-card-border text-center">
              <div className="text-2xl font-bold text-foreground">{result.originalCount.toLocaleString("tr-TR")}</div>
              <div className="text-xs text-muted-foreground mt-1">Orijinal Satir</div>
            </div>
            <div className="p-4 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 text-center">
              <div className="text-2xl font-bold text-green-600">{result.cleanedCount.toLocaleString("tr-TR")}</div>
              <div className="text-xs text-muted-foreground mt-1">Temizlenmis Satir</div>
            </div>
            <div className="p-4 rounded-xl bg-orange-50 dark:bg-orange-900/20 border border-orange-200 text-center">
              <div className="text-2xl font-bold text-orange-600">{result.duplicatesRemoved.toLocaleString("tr-TR")}</div>
              <div className="text-xs text-muted-foreground mt-1">Tekrar Kaldirildi</div>
            </div>
            <div className="p-4 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 text-center">
              <div className="text-2xl font-bold text-blue-600">{result.nullsFilled.toLocaleString("tr-TR")}</div>
              <div className="text-xs text-muted-foreground mt-1">Bos Hucre Doldu</div>
            </div>
          </div>

          {result.trimmedCells > 0 && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-accent/30 text-sm">
              <CheckCircle className="w-4 h-4 text-green-500" />
              <span className="text-foreground">{result.trimmedCells} hucredeki bas/son bosluklar temizlendi</span>
            </div>
          )}

          {result.originalCount === result.cleanedCount && result.duplicatesRemoved === 0 && result.nullsFilled === 0 && result.trimmedCells === 0 && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-muted text-sm">
              <AlertTriangle className="w-4 h-4 text-yellow-500" />
              <span className="text-muted-foreground">Secilen seceneklere gore temizlenecek veri bulunamadi.</span>
            </div>
          )}

          <Card className="border border-card-border">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base">Temizlenmis Veri Onizlemesi (ilk 50 satir)</CardTitle>
              <Button onClick={handleExport} data-testid="button-export-clean">
                <Download className="w-4 h-4 mr-2" />
                Excel Indir
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border">
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground w-10">#</th>
                      {result.headers.map((h) => (
                        <th key={h} className="text-left px-3 py-2 font-medium text-muted-foreground max-w-36 truncate">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.slice(0, 50).map((row, i) => (
                      <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/20">
                        <td className="px-3 py-2 text-muted-foreground text-xs">{i + 1}</td>
                        {result.headers.map((h) => (
                          <td
                            key={h}
                            className="px-3 py-2 max-w-36 overflow-hidden text-ellipsis whitespace-nowrap text-foreground"
                          >
                            {String(row[h] ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {result.rows.length > 50 && (
                <p className="text-xs text-muted-foreground text-center py-3 border-t border-border">
                  ... ve {(result.rows.length - 50).toLocaleString("tr-TR")} satir daha. Tamami icin Excel Indir'e basin.
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

