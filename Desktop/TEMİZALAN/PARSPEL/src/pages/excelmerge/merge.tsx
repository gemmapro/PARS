import { useState, useMemo } from "react";
import { Merge, Download, FileSpreadsheet, CheckCircle, AlertTriangle, Info, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { type ExcelFile, type JoinType, type CleanOptions, mergeFiles, exportToExcel, exportReportToExcel } from "@/lib/excel-merge";
import { learnFromUserAction } from "@/lib/offline-ai";

interface MergePageProps {
  files: ExcelFile[];
}

const strategyLabels: Record<string, { label: string; desc: string }> = {
  latest: { label: "Son Dosyayi Tercih Et", desc: "Ayni anahtar icin son yuklenen dosyadaki deger kazanir" },
  first: { label: "Ilk Dosyayi Koru", desc: "Ayni anahtar icin ilk karsilasilan deger korunur" },
  union: { label: "Birlesim (Bos Dolum)", desc: "Bos hucreler diger dosyalardan doldurulur" },
  intersection: { label: "Sadece Ortak Satirlar", desc: "Tum dosyalarda var olan satirlari al" },
};

const joinTypeLabels: Record<JoinType, { label: string; desc: string; icon: string }> = {
  inner: { label: "Inner Join", desc: "Her iki dosyada da eslesen satirlar", icon: "⊙" },
  left: { label: "Left Join", desc: "A dosyasinin tum satirlari + B'den eslesenler", icon: "⊏" },
  right: { label: "Right Join", desc: "B dosyasinin tum satirlari + A'dan eslesenler", icon: "⊐" },
  fullOuter: { label: "Full Outer Join", desc: "Her iki dosyadan tum satirlar", icon: "⊞" },
  verticalUnion: { label: "Union (Alt Alta)", desc: "Tablolari dikey olarak birlestir (her satir korunur)", icon: "⇩" },
};

const defaultCleanOptions: CleanOptions = {
  trimWhitespace: true,
  deduplicateRows: false,
  fillNullsWithEmpty: false,
  standardizeCase: "none",
  standardizeDates: false,
};

export default function MergePage({ files }: MergePageProps) {
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [keyColumn, setKeyColumn] = useState<string>("");
  const [strategy, setStrategy] = useState("latest");
  const [joinType, setJoinType] = useState<JoinType>("fullOuter");
  const [fuzzyMatch, setFuzzyMatch] = useState(false);
  const [fuzzyThreshold, setFuzzyThreshold] = useState(0.85);
  const [cleanOptions, setCleanOptions] = useState<CleanOptions>(defaultCleanOptions);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showClean, setShowClean] = useState(false);
  const [merged, setMerged] = useState<ReturnType<typeof mergeFiles> | null>(null);
  const [outputName, setOutputName] = useState("birlestirilen_veri.xlsx");

  const selectedFiles = files.filter((f) => selectedFileIds.includes(f.id));

  const allHeaders = useMemo(() => {
    const headers = new Set<string>();
    selectedFiles.forEach((f) => f.sheets.forEach((s) => s.headers.forEach((h) => headers.add(h))));
    return Array.from(headers);
  }, [selectedFiles]);

  const toggleFile = (id: string) => {
    setSelectedFileIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
    setMerged(null);
  };

  const handleMerge = async () => {
    if (selectedFiles.length === 0) return;
    const result = mergeFiles(selectedFiles, {
      keyColumn,
      strategy,
      joinType,
      sheets: [],
      fuzzyMatch,
      fuzzyThreshold,
      cleanOptions,
    });
    setMerged(result);

    await learnFromUserAction({
      keyColumn: keyColumn || "(yok)",
      strategy,
      fileCount: selectedFiles.length,
      outcome: "success",
    });
  };

  const handleExport = () => {
    if (!merged) return;
    exportToExcel(merged.headers, merged.rows, outputName);
  };

  const handleExportReport = () => {
    if (!merged) return;
    exportReportToExcel(merged.report, "birlestirme_raporu.xlsx");
  };

  const setClean = (key: keyof CleanOptions, val: CleanOptions[keyof CleanOptions]) => {
    setCleanOptions((prev) => ({ ...prev, [key]: val }));
    setMerged(null);
  };

  if (files.length === 0) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="text-center py-16">
          <Merge className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-foreground mb-2">Birlestirme icin dosya gerekli</h2>
          <p className="text-muted-foreground">Lutfen once Dosya Yukle sayfasindan dosya yukleyin.</p>
        </div>
      </div>
    );
  }

  const report = merged?.report;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Veri Birlestir</h1>
        <p className="text-muted-foreground mt-1">
          Birden fazla dosyadan veri birlestirin. Join tipi, cakisma stratejisi ve veri temizleme seceneklerini yapilandirin.
        </p>
      </div>

      <Card className="border border-card-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Dosya Secimi</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {files.map((f) => (
              <button
                key={f.id}
                data-testid={`button-select-file-${f.id}`}
                onClick={() => toggleFile(f.id)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium transition-all ${
                  selectedFileIds.includes(f.id)
                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                    : "bg-card text-foreground border-border hover:border-primary/50"
                }`}
              >
                {selectedFileIds.includes(f.id) && <CheckCircle className="w-4 h-4" />}
                <FileSpreadsheet className="w-4 h-4" />
                <span className="max-w-40 truncate">{f.name}</span>
                {f.isRecovery && <Badge variant="outline" className="text-yellow-600 border-yellow-400 text-xs py-0">⚠</Badge>}
              </button>
            ))}
          </div>
          {selectedFileIds.length > 0 && (
            <p className="text-xs text-muted-foreground mt-3">
              {selectedFileIds.length} dosya secildi · Toplam{" "}
              {selectedFiles.reduce((acc, f) => acc + f.sheets.reduce((a, s) => a + s.rows.length, 0), 0).toLocaleString("tr-TR")} satir
            </p>
          )}
        </CardContent>
      </Card>

      {selectedFiles.length >= 1 && (
        <>
          <Card className="border border-card-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Join Tipi</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                {(Object.entries(joinTypeLabels) as [JoinType, typeof joinTypeLabels[JoinType]][]).map(([key, meta]) => (
                  <button
                    key={key}
                    onClick={() => { setJoinType(key); setMerged(null); }}
                    data-testid={`button-join-${key}`}
                    className={`p-3 rounded-xl border text-center transition-all ${
                      joinType === key
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-card text-muted-foreground hover:border-primary/40"
                    }`}
                  >
                    <div className="text-xl mb-1">{meta.icon}</div>
                    <div className="text-xs font-semibold text-foreground">{meta.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 leading-tight">{meta.desc}</div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border border-card-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Birlestirme Ayarlari</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-foreground">Anahtar Sutun (Birincil Anahtar)</label>
                  <Select
                    value={keyColumn}
                    onValueChange={(v) => { setKeyColumn(v); setMerged(null); }}
                    data-testid="select-merge-key"
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Anahtar sutun yok (satirlari sirayla birlestir)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Anahtar sutun yok (sirayla birlestir)</SelectItem>
                      {allHeaders.map((h) => (
                        <SelectItem key={h} value={h}>{h}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Musteri No, Siparis ID gibi benzersiz sutun secin</p>
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium text-foreground">Cakisma Stratejisi</label>
                  <Select value={strategy} onValueChange={(v) => { setStrategy(v); setMerged(null); }} data-testid="select-strategy">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(strategyLabels).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{strategyLabels[strategy]?.desc}</p>
                </div>
              </div>

              <div className="border border-border rounded-xl overflow-hidden">
                <button
                  className="w-full flex items-center justify-between px-4 py-3 bg-muted/40 text-sm font-medium text-foreground hover:bg-muted/60 transition-colors"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                >
                  <span>Gelismis Secenekler: Bulank Eslestirme (Fuzzy Matching)</span>
                  {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
                {showAdvanced && (
                  <div className="p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-foreground">Bulank Eslestirme Aktif</p>
                        <p className="text-xs text-muted-foreground">
                          "Ahmet Yilmaz" ile "Ahmet Yılmaz" gibi yakin degerleri eslestir
                        </p>
                      </div>
                      <Switch
                        checked={fuzzyMatch}
                        onCheckedChange={(v) => { setFuzzyMatch(v); setMerged(null); }}
                        data-testid="switch-fuzzy"
                      />
                    </div>
                    {fuzzyMatch && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-sm text-foreground">Benzerlik Esigi</label>
                          <span className="text-sm font-mono font-semibold text-primary">
                            %{Math.round(fuzzyThreshold * 100)}
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0.5"
                          max="1"
                          step="0.05"
                          value={fuzzyThreshold}
                          onChange={(e) => { setFuzzyThreshold(parseFloat(e.target.value)); setMerged(null); }}
                          className="w-full accent-primary"
                          data-testid="slider-fuzzy-threshold"
                        />
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>Esnek (%50)</span>
                          <span>Katı (%100)</span>
                        </div>
                        <div className="p-2 rounded-lg bg-accent/20 text-xs text-muted-foreground flex items-start gap-2">
                          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span>
                            %{Math.round(fuzzyThreshold * 100)} esigi: "Ahmet Yilmaz" ve "Ahmet Yılmaz" gibi
                            {fuzzyThreshold >= 0.9 ? " cok benzer" : fuzzyThreshold >= 0.75 ? " oldukca benzer" : " orta derecede benzer"} kelimeler eslenir.
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="border border-border rounded-xl overflow-hidden">
                <button
                  className="w-full flex items-center justify-between px-4 py-3 bg-muted/40 text-sm font-medium text-foreground hover:bg-muted/60 transition-colors"
                  onClick={() => setShowClean(!showClean)}
                >
                  <span>ETL: Veri Temizleme Secenekleri</span>
                  {showClean ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
                {showClean && (
                  <div className="p-4 space-y-3">
                    {[
                      {
                        key: "trimWhitespace" as const,
                        label: "Bas/Son Boslukları Temizle",
                        desc: "Hucre degerlerindeki gereksiz boslukları kaldirir",
                      },
                      {
                        key: "deduplicateRows" as const,
                        label: "Tekrar Eden Satirlari Kaldir",
                        desc: "Tamamen ayni olan satirlardan birini siler",
                      },
                      {
                        key: "fillNullsWithEmpty" as const,
                        label: "Bos Hucreleri Bosluklarla Doldur",
                        desc: "null degerlerini bos string ile degistirir",
                      },
                    ].map(({ key, label, desc }) => (
                      <div key={key} className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-foreground">{label}</p>
                          <p className="text-xs text-muted-foreground">{desc}</p>
                        </div>
                        <Switch
                          checked={cleanOptions[key] as boolean}
                          onCheckedChange={(v) => setClean(key, v)}
                          data-testid={`switch-clean-${key}`}
                        />
                      </div>
                    ))}
                    <div className="space-y-1">
                      <label className="text-sm font-medium text-foreground">Harf Standardizasyonu</label>
                      <Select
                        value={cleanOptions.standardizeCase}
                        onValueChange={(v) => setClean("standardizeCase", v as CleanOptions["standardizeCase"])}
                        data-testid="select-case"
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Degistirme</SelectItem>
                          <SelectItem value="upper">BUYUK HARF</SelectItem>
                          <SelectItem value="lower">kucuk harf</SelectItem>
                          <SelectItem value="title">Baslik Harfi</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              </div>

              <Button onClick={handleMerge} className="w-full" data-testid="button-merge">
                <Merge className="w-4 h-4 mr-2" />
                Verileri Birlestir
              </Button>
            </CardContent>
          </Card>
        </>
      )}

      {merged && report && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-4 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 text-center">
              <div className="text-2xl font-bold text-green-600">{report.matchedRows.toLocaleString("tr-TR")}</div>
              <div className="text-xs text-muted-foreground mt-1">Eslesen Satir</div>
            </div>
            <div className="p-4 rounded-xl bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 text-center">
              <div className="text-2xl font-bold text-yellow-600">{report.unmatchedFromA.toLocaleString("tr-TR")}</div>
              <div className="text-xs text-muted-foreground mt-1">A'dan Eslesmeyen</div>
            </div>
            <div className="p-4 rounded-xl bg-orange-50 dark:bg-orange-900/20 border border-orange-200 text-center">
              <div className="text-2xl font-bold text-orange-600">{report.unmatchedFromB.toLocaleString("tr-TR")}</div>
              <div className="text-xs text-muted-foreground mt-1">B'den Eslesmeyen</div>
            </div>
            <div className="p-4 rounded-xl bg-primary/10 border border-primary/20 text-center">
              <div className="text-2xl font-bold text-primary">{report.totalOutputRows.toLocaleString("tr-TR")}</div>
              <div className="text-xs text-muted-foreground mt-1">Toplam Cikti</div>
            </div>
          </div>

          {(report.duplicatesRemoved > 0 || report.nullsFilled > 0 || report.fuzzyMatchCount > 0 || report.skippedRows > 0) && (
            <div className="flex flex-wrap gap-2">
              {report.duplicatesRemoved > 0 && (
                <Badge variant="outline" className="text-purple-600 border-purple-400">
                  {report.duplicatesRemoved} tekrar kaldirildi
                </Badge>
              )}
              {report.nullsFilled > 0 && (
                <Badge variant="outline" className="text-blue-600 border-blue-400">
                  {report.nullsFilled} bos hucre dolduruldu
                </Badge>
              )}
              {report.fuzzyMatchCount > 0 && (
                <Badge variant="outline" className="text-teal-600 border-teal-400">
                  {report.fuzzyMatchCount} bulank eslestirme
                </Badge>
              )}
              {report.skippedRows > 0 && (
                <Badge variant="outline" className="text-red-600 border-red-400">
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  {report.skippedRows} satir atlandi
                </Badge>
              )}
            </div>
          )}

          <Card className="border border-card-border">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base">Onizleme (ilk 50 satir)</CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
                <Button variant="outline" size="sm" onClick={handleExportReport} data-testid="button-export-report">
                  <Download className="w-4 h-4 mr-1" />
                  Rapor Indir
                </Button>
                <input
                  value={outputName}
                  onChange={(e) => setOutputName(e.target.value)}
                  className="text-sm border border-border rounded-lg px-3 py-1.5 bg-background text-foreground w-52 focus:outline-none focus:ring-1 focus:ring-primary"
                  data-testid="input-output-name"
                />
                <Button onClick={handleExport} data-testid="button-export">
                  <Download className="w-4 h-4 mr-2" />
                  Excel Indir
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border">
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground w-10">#</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground w-28">Kaynak</th>
                      {merged.headers.map((h) => (
                        <th key={h} className="text-left px-3 py-2 font-medium text-muted-foreground max-w-36 truncate">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {merged.rows.slice(0, 50).map((row, i) => {
                      const src = merged.sourceInfo[i];
                      const srcFile = files.find((f) => f.id === src?.fileId);
                      return (
                        <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/20">
                          <td className="px-3 py-2 text-muted-foreground text-xs">{i + 1}</td>
                          <td className="px-3 py-2">
                            {src && (
                              <span className="text-xs text-muted-foreground truncate max-w-24 block" title={src.fileName}>
                                {srcFile?.name?.split(".")[0] ?? ""}
                              </span>
                            )}
                          </td>
                          {merged.headers.map((h) => (
                            <td key={h} className="px-3 py-2 max-w-36 overflow-hidden text-ellipsis whitespace-nowrap text-foreground">
                              {String(row[h] ?? "")}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {merged.rows.length > 50 && (
                <p className="text-xs text-muted-foreground text-center py-3 border-t border-border">
                  ... ve {(merged.rows.length - 50).toLocaleString("tr-TR")} satir daha. Tamami icin Excel Indir'e basin.
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

