export type ShrinkOptions = {
  grayscale?: boolean
  resolutionDpi?: number
  threshold?: number
  pdfSettings?: "screen" | "ebook" | "printer" | "prepress";
};

export type GSProgress = {
  percent: number
  current: number
  total: number | null
};
