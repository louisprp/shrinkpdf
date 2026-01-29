import type { ShrinkOptions, GSProgress } from "../worker/types";

let worker: Worker | null = null;

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL("../worker/gs.worker.ts", import.meta.url), { type: "module" });
  }
  return worker;
}

export function compressWithGS(
  pdf: ArrayBuffer,
  options: ShrinkOptions,
  onStatus?: (stage: string, message?: string) => void,
  onProgress?: (p: GSProgress) => void
): Promise<{ outBuffer: ArrayBuffer; usedOriginal: boolean; pdfVersionUsed: string }> {
  const w = getWorker();
  const jobId = crypto.randomUUID();

  return new Promise((resolve, reject) => {
    const onMessage = (e: MessageEvent) => {
      const data = e.data;
      if (data?.jobId !== jobId) return;

      if (data.type === "status") {
        onStatus?.(data.stage, data.message);
        return;
      }

      if (data.type === "progress") {
        onProgress?.({
          percent: Number(data.percent ?? 0),
          current: Number(data.current ?? 0),
          total: data.total == null ? null : Number(data.total),
        });
        return;
      }

      cleanup();

      if (data.type === "result") {
        resolve({
          outBuffer: data.outBuffer as ArrayBuffer,
          usedOriginal: !!data.usedOriginal,
          pdfVersionUsed: String(data.pdfVersionUsed ?? ""),
        });
      } else if (data.type === "error") {
        reject(new Error(data.error ?? "Worker error"));
      }
    };

    const onError = (err: ErrorEvent) => {
      cleanup();
      reject(err.error ?? new Error(err.message));
    };

    const cleanup = () => {
      w.removeEventListener("message", onMessage);
      w.removeEventListener("error", onError);
    };

    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError);

    w.postMessage({ type: "compress", jobId, pdfBuffer: pdf, options }, [pdf]);
  });
}
