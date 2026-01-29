/// <reference lib="webworker" />

import wasmUrl from "./gs.wasm?url";
import type { ShrinkOptions, GSProgress } from "./types.js";

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import createGS from "./gs.js";

type GSModule = {
  FS: {
    writeFile(path: string, data: Uint8Array): void;
    readFile(path: string): Uint8Array;
    unlink(path: string): void;
  };
  callMain(args: string[]): void;
};

type CompressMsg = {
  type: "compress";
  jobId: string;
  pdfBuffer: ArrayBuffer;
  options: ShrinkOptions;
};

// Job queue so multiple calls are handled sequentially
let queue = Promise.resolve();

// Progress state for the *currently running* job
let activeJobId: string | null = null;
let totalPages: number | null = null;
let currentPage = 0;

// ---- helpers ----
function postStatus(jobId: string, stage: string, message?: string) {
  self.postMessage({ type: "status", jobId, stage, message });
}

function postProgress(jobId: string, progress: GSProgress) {
  self.postMessage({ type: "progress", jobId, ...progress });
}

function emitProgress(jobId: string) {
  let percent = 0;

  if (totalPages && totalPages > 0) {
    const raw = Math.floor((currentPage / totalPages) * 100);
    percent = Math.min(99, Math.max(0, raw));
  }

  postProgress(jobId, { percent, current: currentPage, total: totalPages });
}

function detectPdfVersion(bytes: Uint8Array): string | null {
  const head = bytes.subarray(0, Math.min(1024, bytes.length));
  const text = new TextDecoder("ascii", { fatal: false }).decode(head);
  const m = text.match(/%PDF-(\d\.\d)/);
  return m?.[1] ?? null;
}

function parseGsLine(line: string) {
  if (!activeJobId) return;

  const mTotal = line.match(/Processing pages\s+(\d+)\s+through\s+(\d+)\./i);
  if (mTotal) {
    const start = Number(mTotal[1]);
    const end = Number(mTotal[2]);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      totalPages = end - start + 1;
      emitProgress(activeJobId);
    }
    return;
  }

  const mPage = line.match(/^\s*Page\s+(\d+)\s*$/i);
  if (mPage) {
    const p = Number(mPage[1]);
    if (Number.isFinite(p) && p > currentPage) {
      currentPage = p;
      if (totalPages == null && p === 1) totalPages = 1;
      emitProgress(activeJobId);
    }
  }
}

async function createFreshGS(): Promise<GSModule> {
  return (createGS)({
    locateFile: (p: string) => (p.endsWith(".wasm") ? wasmUrl : p),
    print: (t: string) => parseGsLine(t),
    printErr: (t: string) => parseGsLine(t),
  });
}

async function shrinkPdfLikeScript(
  gs: GSModule,
  inputPdf: Uint8Array,
  options: ShrinkOptions
): Promise<{
  out: Uint8Array;
  usedOriginal: boolean;
  pdfVersionUsed: string;
}> {
  const inPath = "/in.pdf";
  const outPath = "/out.pdf";

  try { gs.FS.unlink(inPath); } catch {}
  try { gs.FS.unlink(outPath); } catch {}

  gs.FS.writeFile(inPath, inputPdf);

  const grayscale = options.grayscale ?? false;
  const res = Number.isFinite(options.resolutionDpi) ? Math.max(1, options.resolutionDpi!) : 72;
  const threshold = Number.isFinite(options.threshold) ? Math.max(0.1, options.threshold!) : 1.5;
  const pdfSettings = options.pdfSettings ?? "ebook";

  const pdfVersion = detectPdfVersion(inputPdf) ?? "1.5";

  const args: string[] = [
    "-dNOPAUSE",
    "-dBATCH",
    "-dSAFER",
    "-sDEVICE=pdfwrite",
    `-dCompatibilityLevel=${pdfVersion}`,
    `-dPDFSETTINGS=/${pdfSettings}`,
    "-dEmbedAllFonts=true",
    "-dSubsetFonts=true",
    "-dAutoRotatePages=/None",

    "-dColorImageDownsampleType=/Bicubic",
    `-dColorImageResolution=${res}`,
    `-dColorImageDownsampleThreshold=${threshold}`,

    "-dGrayImageDownsampleType=/Bicubic",
    `-dGrayImageResolution=${res}`,
    `-dGrayImageDownsampleThreshold=${threshold}`,

    "-dMonoImageDownsampleType=/Subsample",
    `-dMonoImageResolution=${res}`,
    `-dMonoImageDownsampleThreshold=${threshold}`,

    "-dPreserveAnnots=false",

    `-sOutputFile=${outPath}`,
  ];

  if (grayscale) {
    args.push(
      "-sProcessColorModel=DeviceGray",
      "-sColorConversionStrategy=Gray",
      "-dOverrideICC"
    );
  }

  args.push(inPath);

  gs.callMain(args);

  const out = gs.FS.readFile(outPath);

  if (out.length > inputPdf.length) {
    return { out: inputPdf, usedOriginal: true, pdfVersionUsed: pdfVersion };
  }
  return { out, usedOriginal: false, pdfVersionUsed: pdfVersion };
}

async function handleJob(msg: CompressMsg) {
  const { jobId, pdfBuffer, options } = msg;

  postStatus(jobId, "loading", "Loading Ghostscript WASM…");
  
  const gs = await createFreshGS();
  
  postStatus(jobId, "ready", "Ghostscript ready.");

  // init progress state for this job
  activeJobId = jobId;
  totalPages = null;
  currentPage = 0;
  emitProgress(jobId);

  postStatus(jobId, "running", "Compressing…");

  try {
    const { out, usedOriginal, pdfVersionUsed } = await shrinkPdfLikeScript(
      gs,
      new Uint8Array(pdfBuffer),
      options
    );

    postProgress(jobId, { percent: 100, current: totalPages ?? currentPage, total: totalPages });
    postStatus(jobId, "done", usedOriginal ? "Output larger; returned original." : "Done.");

    self.postMessage(
      { type: "result", jobId, outBuffer: out.buffer, usedOriginal, pdfVersionUsed },
      [out.buffer]
    );
  } finally {
    activeJobId = null;
    totalPages = null;
    currentPage = 0;
  }
}

self.onmessage = (e: MessageEvent<CompressMsg>) => {
  const msg = e.data;
  if (msg.type !== "compress") return;

  queue = queue.then(() => handleJob(msg)).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    self.postMessage({ type: "error", jobId: msg.jobId, error: message });
  });
};