import { useCallback, useState } from "react";
import { Upload, FileSpreadsheet, AlertTriangle, CheckCircle, X, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { parseExcelFile, parseCsvFile, parseJsonFile, parseXmlFile, formatFileSize, type ExcelFile } from "@/lib/excel-merge";

interface UploadPageProps {
  files: ExcelFile[];
  onFilesChange: (files: ExcelFile[]) => void;
}

export default function UploadPage({ files, onFilesChange }: UploadPageProps) {
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const processFiles = useCallback(
    async (fileList: FileList) => {
      setLoading(true);
      setError(null);
      const newFiles: ExcelFile[] = [];
      const validExtensions = [".xlsx", ".xls", ".xlsm", ".xlsb", ".csv", ".ods", ".json", ".xml"];

      for (const file of Array.from(fileList)) {
        const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
        if (!validExtensions.includes(ext)) {
          setError(`"${file.name}" desteklenmiyor. Desteklenen formatlar: ${validExtensions.join(", ")}`);
          continue;
        }
        try {
          let parsed: ExcelFile;
          if (ext === ".json") parsed = await parseJsonFile(file);
          else if (ext === ".xml") parsed = await parseXmlFile(file);
          else if (ext === ".csv") parsed = await parseCsvFile(file);
          else parsed = await parseExcelFile(file);
          newFiles.push(parsed);
        } catch (e) {
          setError(`"${file.name}" dosyası okunamadı. Dosya bozuk olabilir. (${e instanceof Error ? e.message : "bilinmeyen hata"})`);
        }
      }

      onFilesChange([...files, ...newFiles]);
      setLoading(false);
    },
    [files, onFilesChange]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (e.dataTransfer.files.length > 0) {
        processFiles(e.dataTransfer.files);
      }
    },
    [processFiles]
  );

  const onFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        processFiles(e.target.files);
        e.target.value = "";
      }
    },
    [processFiles]
  );

  const removeFile = (id: string) => {
    onFilesChange(files.filter((f) => f.id !== id));
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dosya Yukle</h1>
        <p className="text-muted-foreground mt-1">
          Excel (XLSX/XLS), CSV, JSON, XML formatindaki dosyalari yukleyin. Kurtarma dosyalari otomatik tespit edilir.
        </p>
      </div>

      <div
        data-testid="dropzone"
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`relative border-2 border-dashed rounded-xl p-12 text-center transition-all duration-200 cursor-pointer
          ${dragging
            ? "border-primary bg-accent/50 scale-[1.01]"
            : "border-border bg-card hover:border-primary/50 hover:bg-accent/20"
          }`}
        onClick={() => document.getElementById("file-input")?.click()}
      >
        <input
          id="file-input"
          type="file"
          multiple
          accept=".xlsx,.xls,.xlsm,.xlsb,.csv,.ods,.json,.xml"
          className="hidden"
          onChange={onFileInput}
          data-testid="input-file"
        />
        <div className="flex flex-col items-center gap-3">
          <div className={`p-4 rounded-full transition-colors ${dragging ? "bg-primary/20" : "bg-muted"}`}>
            <Upload className={`w-8 h-8 ${dragging ? "text-primary" : "text-muted-foreground"}`} />
          </div>
          <div>
            <p className="text-lg font-semibold text-foreground">
              {dragging ? "Buraya birakabilirsiniz" : "Dosyalari surukleyin veya tiklayin"}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              XLSX, XLS, CSV, JSON, XML, ODS desteklenir. Birden fazla dosya secilebilir.
            </p>
          </div>
          {loading && (
            <div className="flex items-center gap-2 text-primary">
              <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span className="text-sm">Dosyalar isleniyor...</span>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-3 p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
          <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
          <p className="text-sm text-destructive">{error}</p>
          <button onClick={() => setError(null)} className="ml-auto text-destructive hover:opacity-70">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="p-4 bg-accent/30 border border-accent-border rounded-lg flex items-start gap-3">
        <Info className="w-5 h-5 text-accent-foreground shrink-0 mt-0.5" />
        <div className="text-sm text-accent-foreground">
          <p className="font-medium mb-1">Gizlilik Guvenceleri</p>
          <p>Tum islemler tarayicinizda gerceklesmektedir. Dosyalariniz hicbir sunucuya gonderilmez.</p>
        </div>
      </div>

      {files.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">
            Yuklenen Dosyalar ({files.length})
          </h2>
          {files.map((file) => (
            <Card key={file.id} data-testid={`card-file-${file.id}`} className="border border-card-border">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg shrink-0 ${file.isRecovery ? "bg-yellow-100 dark:bg-yellow-900/30" : "bg-primary/10"}`}>
                    <FileSpreadsheet className={`w-5 h-5 ${file.isRecovery ? "text-yellow-600 dark:text-yellow-400" : "text-primary"}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-foreground truncate">{file.name}</p>
                      {file.isRecovery && (
                        <Badge variant="outline" className="text-yellow-600 border-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 shrink-0">
                          <AlertTriangle className="w-3 h-3 mr-1" />
                          Kurtarma Dosyasi
                        </Badge>
                      )}
                      {!file.isRecovery && (
                        <Badge variant="outline" className="text-green-600 border-green-400 bg-green-50 dark:bg-green-900/20 shrink-0">
                          <CheckCircle className="w-3 h-3 mr-1" />
                          Normal Dosya
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span>{formatFileSize(file.size)}</span>
                      <span>·</span>
                      <span>{file.sheets.length} sayfa</span>
                      <span>·</span>
                      <span>
                        {file.sheets.reduce((acc, s) => acc + s.rows.length, 0).toLocaleString("tr-TR")} satir
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {file.sheets.map((sheet) => (
                        <Badge key={sheet.name} variant="secondary" className="text-xs">
                          {sheet.name} ({sheet.rows.length} satir)
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => removeFile(file.id)}
                    data-testid={`button-remove-${file.id}`}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {files.length === 0 && (
        <Card className="border border-dashed border-border">
          <CardHeader>
            <CardTitle className="text-base text-muted-foreground font-normal text-center">
              Henuz dosya yuklenmedi
            </CardTitle>
          </CardHeader>
          <CardContent className="text-center pb-6">
            <p className="text-sm text-muted-foreground">
              Yukari alandaki alana surukleyin veya tiklayin
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

