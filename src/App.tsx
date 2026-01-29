import { useCallback, useEffect, useMemo, useState } from "react";
import { useDropzone } from "react-dropzone";

import {
  UploadSimpleIcon as Upload,
  LockIcon as Lock,
  ShieldIcon as Shield,
  CpuIcon as Cpu,
  EyeIcon as Eye,
  DownloadSimpleIcon as Download,
  XIcon as X,
  GithubLogoIcon as GithubLogo,
  ArrowSquareOutIcon as ExternalLink,
  SpinnerIcon as Spinner,
  ArrowsInSimpleIcon as Minimize,
  FilePdfIcon as File,
} from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardFooter,
  CardContent,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

import { compressWithGS } from "./lib/gs-client";
import type { GSProgress, ShrinkOptions } from "./worker/types";
import { Badge } from "./components/ui/badge";

type CompressionLevel = "low" | "medium" | "high";

interface FileState {
  file: File;
  status: "pending" | "compressing" | "complete" | "error";
  progress: number;
  originalSize: number;
  compressedSize?: number;
  compressedBlob?: Blob;
  statusText?: string;
  gsProgress?: GSProgress;
  usedOriginal?: boolean | null;
  pdfVersionUsed?: string;
  downloadUrl?: string | null;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Number.parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}

function optionsFromLevel(level: CompressionLevel): ShrinkOptions {
  switch (level) {
    case "low":
      return { grayscale: false, resolutionDpi: 250, threshold: 1.5, pdfSettings: "printer" };
    case "medium":
      return { grayscale: false, resolutionDpi: 150, threshold: 1.3, pdfSettings: "ebook" };
    case "high":
      return { grayscale: false, resolutionDpi: 96, threshold: 1.2, pdfSettings: "screen" };
    default:
      return { grayscale: false, resolutionDpi: 150, threshold: 1.3, pdfSettings: "ebook" };
  }
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function formatProgressLine(p?: GSProgress) {
  if (!p) return null;

  const current = Math.max(0, p.current);
  if (p.total == null) {
    return current > 0 ? `Page ${current}` : null;
  }

  const total = Math.max(1, p.total);
  const shownCurrent = clamp(current, 0, total);
  return `Page ${shownCurrent} / ${total}`;
}

export default function App() {
  const [fileState, setFileState] = useState<FileState | null>(null);
  const [compressionLevel, setCompressionLevel] =
    useState<CompressionLevel>("medium");

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file && file.type === "application/pdf") {
      setFileState((prev) => {
        if (prev?.downloadUrl) URL.revokeObjectURL(prev.downloadUrl);
        return {
          file,
          status: "pending",
          progress: 0,
          originalSize: file.size,
          statusText: "Ready. Click Compress to start.",
          gsProgress: undefined,
          usedOriginal: null,
          pdfVersionUsed: "",
          downloadUrl: null,
        };
      });
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/pdf": [".pdf"] },
    multiple: false,
  });

  // cleanup on unmount
  useEffect(() => {
    return () => {
      if (fileState?.downloadUrl) URL.revokeObjectURL(fileState.downloadUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canCompress = useMemo(
    () => !!fileState && fileState.status === "pending",
    [fileState]
  );

  const handleCompress = async () => {
    if (!fileState || fileState.status !== "pending") return;

    // reset output + go busy
    setFileState((prev) => {
      if (!prev) return prev;
      if (prev.downloadUrl) URL.revokeObjectURL(prev.downloadUrl);
      return {
        ...prev,
        status: "compressing",
        progress: 0,
        compressedBlob: undefined,
        compressedSize: undefined,
        downloadUrl: null,
        usedOriginal: null,
        pdfVersionUsed: "",
        statusText: "Reading file...",
        gsProgress: { percent: 0, current: 0, total: null },
      };
    });

    try {
      const inputBuf = await fileState.file.arrayBuffer();
      const opts = optionsFromLevel(compressionLevel);

      const { outBuffer, usedOriginal, pdfVersionUsed } = await compressWithGS(
        inputBuf,
        opts,
        (stage: string, msg?: string) => {
          setFileState((prev) =>
            prev
              ? {
                ...prev,
                statusText: `${stage}${msg ? ": " + msg : ""}`,
              }
              : prev
          );
        },
        (p: GSProgress) => {
          setFileState((prev) => {
            if (!prev) return prev;
            if (prev.status !== "compressing") return prev;

            const nextPercent = clamp(Math.round(p.percent), 0, 100);
            const monotonic = Math.max(prev.progress ?? 0, nextPercent);

            return {
              ...prev,
              progress: monotonic,
              gsProgress: p,
            };
          });
        }
      );

      const blob = new Blob([outBuffer], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);

      setFileState((prev) =>
        prev
          ? {
            ...prev,
            status: "complete",
            progress: 100,
            compressedSize: outBuffer.byteLength,
            compressedBlob: blob,
            downloadUrl: url,
            usedOriginal,
            pdfVersionUsed,
            statusText: usedOriginal
              ? "Note: output would be larger — returning original."
              : "Done: output ready.",
          }
          : prev
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFileState((prev) =>
        prev
          ? {
            ...prev,
            status: "error",
            progress: 0,
            statusText: "error: " + msg,
          }
          : prev
      );
    }
  };

  const handleDownload = () => {
    if (!fileState?.downloadUrl) return;
    const a = document.createElement("a");
    a.href = fileState.downloadUrl;
    a.download = fileState.file.name.toLowerCase().endsWith(".pdf")
      ? fileState.file.name.slice(0, -4) + "_compressed.pdf"
      : fileState.file.name + "_compressed.pdf";
    a.click();
  };

  const handleReset = () => {
    setFileState((prev) => {
      if (prev?.downloadUrl) URL.revokeObjectURL(prev.downloadUrl);
      return null;
    });
  };

  const compressionLevels: {
    key: CompressionLevel;
    label: string;
    description: string;
  }[] = [
      { key: "low", label: "Low", description: "Best quality" },
      { key: "medium", label: "Medium", description: "Balanced" },
      { key: "high", label: "High", description: "Smallest size" },
    ];

  const progressLine = formatProgressLine(fileState?.gsProgress);

  return (
    <div className="min-h-screen bg-background text-foreground dark">
      {/* Header */}
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <Minimize className="h-6 w-6 text-primary" strokeWidth={2} />
            <span className="font-semibold text-lg tracking-tight">
              shrinkpdf
            </span>
          </div>
          <a
            href="https://github.com/louisprp/shrinkpdf"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground"
          >
            <GithubLogo className="h-4 w-4" />
            <span className="hidden text-sm sm:inline">Github</span>
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-12">
        {/* Hero */}
        <div className="mb-8 flex flex-col items-center">
          <div className="relative">
            <h1 className="mb-4 text-3xl font-bold text-center tracking-tight sm:text-4xl">
              Compress <span className="text-primary underline underline-offset-4">your own</span> PDF Files
            </h1>

            <div className="absolute -right-20 -top-5 hidden lg:block">
              <svg
                width="60"
                height="48"
                viewBox="0 0 314 252"
                fill="none"
                className="text-primary"
              >
                <path
                  d="M139.391 13.1901C157.8 -6.04244 193.82 -4.41565 207.77 19.2077C221.061 43.6512 210.431 95.8992 197.118 119.411C238.15 115.77 269.494 102.718 299.403 74.1367C305.662 66.6536 317.791 75.7702 312.265 83.8717C301.008 96.3765 285.892 105.385 271.977 114.817C245.72 129.43 214.392 135.51 184.543 135.891C145.078 168.972 98.7176 196.603 46.9666 203.717C37.5722 203.976 15.6002 214.108 13.4319 200.04C12.8932 191.234 22.5068 191.059 28.9042 190.398C81.8023 184.406 122.187 164.131 163.886 132.035C140.958 124.692 121.04 105.396 118.393 80.7357C112.177 54.8475 119.114 30.7641 139.391 13.1901ZM137.503 40.8148C129.261 54.45 132.804 70.8741 135.896 85.5451C141.174 104.108 159.956 115.878 178.19 118.996C193.125 99.8112 203.544 50.2829 194.027 27.6981C176.707 4.10427 148.846 19.6985 137.503 40.8148Z"
                  fill="currentColor"
                />
                <path
                  d="M4.50986 183.629C23.7601 169.002 44.5753 155.155 63.9877 141.264C70.8649 139.638 76.3489 147.897 72.3598 153.673C56.0822 169.171 35.5747 179.764 17.8711 193.592C33.4247 208.737 48.7942 224.15 65.2482 238.265C72.2187 246.107 60.1623 256.875 53.1207 248.954C39.7358 238.108 27.9128 225.564 15.3974 213.746C7.45097 206.371 -7.52192 194.134 4.50986 183.629Z"
                  fill="currentColor"
                />
              </svg>
              <Badge variant="secondary" className="absolute bg-primary text-[#500724] rounded-none uppercase -right-34 top-1">
                powered by wasm
              </Badge>
              {/* <span 
                className="absolute uppercase -right-30 top-2 whitespace-nowrap text-xs text-primary"
              >
                powered by wasm
              </span> */}
            </div>

          </div>
          <p className="mx-auto max-w-2xl text-muted-foreground text-center">
            Reduce file size while maintaining quality. Everything runs locally in your browser - your files never leave your device.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <Cpu className="h-4 w-4 text-primary" />
              <span>Client-Side Only</span>
            </div>
            <div className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-primary" />
              <span>100% Private</span>
            </div>
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-primary" />
              <span>Open Source</span>
            </div>
          </div>
        </div>

        {/* Upload Area */}
        <Card className="mb-8 overflow-hidden border-border p-0">
          {!fileState ? (
            <div
              {...getRootProps()}
              className={cn(
                "cursor-pointer border-2 border-dashed border-muted-foreground/40 p-16 text-center transition-colors hover:border-primary hover:bg-primary/5",
                isDragActive && "border-primary bg-primary/10"
              )}
            >
              <input {...getInputProps()} />
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center bg-primary/10">
                <Upload className="h-7 w-7 text-primary" />
              </div>
              <p className="mb-2 font-medium text-lg">
                {isDragActive
                  ? "Drop your PDF here"
                  : "Drag & drop a PDF file here"}
              </p>
              <p className="text-muted-foreground text-sm">or click to browse</p>
            </div>
          ) : (
            <div className="p-8">
              {/* File Info */}
              <div className="mb-6 flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center bg-primary/10 shrink-0">
                    <File className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">{fileState.file.name}</p>
                    <p className="text-muted-foreground text-sm">
                      {formatFileSize(fileState.originalSize)}
                    </p>
                  </div>
                </div>
                {fileState.status !== "compressing" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleReset}
                    className="text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <X className="h-5 w-5" />
                  </Button>
                )}
              </div>

              {fileState.status === "pending" && (
                <>
                  {/* Compression Level Selector */}
                  <div className="mb-6">
                    <p className="mb-3 font-medium text-sm">Compression Level</p>
                    <div className="grid grid-cols-3 gap-3">
                      {compressionLevels.map((level) => (
                        <button
                          key={level.key}
                          type="button"
                          onClick={() => setCompressionLevel(level.key)}
                          className={cn(
                            "border p-4 text-left transition-colors",
                            compressionLevel === level.key
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border transition-colors hover:border-primary/50"
                          )}
                        >
                          <p className="font-medium text-xs sm:text-sm">{level.label}</p>
                          <p
                            className={cn(
                              "text-xs sm:text-sm",
                              compressionLevel === level.key
                                ? "text-primary-foreground/80"
                                : "text-muted-foreground"
                            )}
                          >
                            {level.description}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>

                  <Button
                    onClick={handleCompress}
                    className="w-full py-6 text-base transition-colors hover:bg-primary/80"
                    size="lg"
                    variant="default"
                    disabled={!canCompress}
                  >
                    Compress PDF
                  </Button>

                  {fileState.statusText && (
                    <p className="mt-3 text-muted-foreground text-sm">
                      {fileState.statusText}
                    </p>
                  )}
                </>
              )}

              {fileState.status === "compressing" && (
                <div className="py-4">
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <Spinner className="h-4 w-4 animate-spin" />
                      {fileState.statusText || "Compressing..."}
                      {progressLine ? (
                        <span className="text-muted-foreground">
                          • {progressLine}
                        </span>
                      ) : null}
                    </span>
                    <span className="text-muted-foreground">
                      {fileState.progress}%
                    </span>
                  </div>
                  <Progress value={fileState.progress} className="h-2 rounded-none" />
                </div>
              )}

              {fileState.status === "error" && (
                <div className="space-y-4">
                  <div className="border border-destructive/40 bg-destructive/10 p-4">
                    <p className="font-medium">Compression failed</p>
                    <p className="mt-1 text-muted-foreground text-sm">
                      {fileState.statusText || "Unknown error"}
                    </p>
                  </div>
                  <Button onClick={handleReset} variant="outline">
                    Try another file
                  </Button>
                </div>
              )}

              {fileState.status === "complete" &&
                fileState.compressedSize != null && (
                  <div className="space-y-6">
                    {/* Results */}
                    <div className="bg-muted p-6">


                      <div className="grid grid-cols-3 gap-4 text-center">
                        <div>
                          <p className="text-muted-foreground text-sm">
                            Original
                          </p>
                          <p className="font-mono font-semibold">
                            {formatFileSize(fileState.originalSize)}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground text-sm">Output</p>
                          <p className="font-mono font-semibold">
                            {formatFileSize(fileState.compressedSize)}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground text-sm">
                            {fileState.usedOriginal ? "Returned" : "Saved"}
                          </p>
                          <p className="font-mono font-semibold text-primary">
                            {fileState.usedOriginal
                              ? "Original"
                              : `${Math.round(
                                (1 -
                                  fileState.compressedSize /
                                  fileState.originalSize) *
                                100
                              )}%`}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row">
                      <Button
                        onClick={handleDownload}
                        className="flex-1 py-6 text-base transition-colors hover:bg-primary/80"
                        size="lg"
                        disabled={!fileState.downloadUrl}
                      >
                        <Download className="mr-2 h-5 w-5" />
                        Download Output PDF
                      </Button>
                      <Button
                        variant="outline"
                        onClick={handleReset}
                        className="bg-transparent py-6"
                        size="lg"
                      >
                        Compress Another
                      </Button>
                    </div>
                  </div>
                )}
            </div>
          )}
        </Card>

        {/* Features */}
        <div className="mb-8 border border-border bg-card p-6">
          <div className="mb-4 flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">100% Private & Secure</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="flex gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center bg-primary/10">
                <Cpu className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="font-medium text-sm">On-Device Processing</p>
                <p className="text-muted-foreground text-sm">
                  Compression happens in your browser using WebAssembly. No
                  server uploads.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center bg-primary/10">
                <Lock className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="font-medium text-sm">Files Never Leave</p>
                <p className="text-muted-foreground text-sm">
                  Your documents stay on your device. Zero network transfer of
                  file data.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center bg-primary/10">
                <Eye className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="font-medium text-sm">Fully Verifiable</p>
                <p className="text-muted-foreground text-sm">
                  Open source code. Inspect code and network traffic yourself to verify.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Technical Details */}
        <Card className="mb-8 relative overflow-hidden">
          <CardHeader>
            <CardTitle className="text-base text-primary">
              Technical Details
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            This tool uses{" "}
            <a
              href="https://www.ghostscript.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4 transition-colors hover:text-muted-foreground"
            >
              Ghostscript
            </a>{" "}
            compiled to
            {" "}
            <a
              href="https://webassembly.org/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4 transition-colors hover:text-muted-foreground"
            >
              WebAssembly
            </a>
            , running entirely in a Web Worker. The WASM
            binary handles all PDF processing locally, on your device, without any server
            communication.

            You can verify privacy by opening your browser&apos;s Network tab
            and observing that no file data is transmitted.
          </CardContent>
          <CardFooter className="flex-col items-start gap-3">
            <a
              href="https://github.com/louisprp/shrinkpdf"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-primary text-sm underline underline-offset-4 transition-colors hover:text-primary/80"
            >
              View source on Github
              <ExternalLink className="h-3 w-3" />
            </a>
          </CardFooter>
        </Card>

        <div className="px-4">
          <p className="text-muted-foreground text-xs">
            This page and its name is inspired by the shell script {" "}
            <a
              href="https://github.com/aklomp/shrinkpdf"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4 transition-colors hover:text-foreground"
            >
              shrinkpdf.sh
            </a>
            {" "} by Alfred Klomp that provides some common arguments for PDF compression with Ghostscript.
            I regularly used it to compress PDFs, often
            achieving better results than many online services. However, it naturally
            requires installing Ghostscript locally, which isn&apos;t always possible on all devices. This website
            brings that same functionality to your browser.
          </p>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-center px-4 py-4">
          <p className="text-muted-foreground text-sm">
            Licensed under{" "}
            <a
              href="https://www.gnu.org/licenses/agpl-3.0.html"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4 transition-colors hover:text-foreground"
            >
              AGPLv3
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
