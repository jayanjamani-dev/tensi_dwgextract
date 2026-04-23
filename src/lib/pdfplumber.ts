import { spawn } from "child_process";
import path from "path";

export interface TextElement {
  text: string;
  x: number;       // left edge (x0) in PDF points
  y: number;       // top edge in PDF points (top-left origin)
  x1?: number;     // right edge in PDF points (present on newly extracted drawings)
  bottom?: number; // bottom edge in PDF points (present on newly extracted drawings)
  size: number;
  page_width: number;
  page_height: number;
  region?: "bottom" | "right";
}

export interface PdfPlumberResult {
  elements: TextElement[];
  scanned: boolean;
  error?: string;
}

export interface PdfPlumberRegionResult extends PdfPlumberResult {
  titleBlockSide: "bottom" | "right" | "unknown";
  pageWidth: number;
  pageHeight: number;
  bottomBbox: [number, number, number, number];
  rightBbox: [number, number, number, number];
}

export interface PdfPlumberCropResult extends PdfPlumberResult {
  pageWidth: number;
  pageHeight: number;
  cropBbox: [number, number, number, number];
}

function resolvePdfPath(pdfPath: string): string {
  return path.isAbsolute(pdfPath)
    ? pdfPath
    : path.join(process.cwd(), pdfPath);
}

function runPython(args: string[], timeoutMs = 240_000): Promise<string> {
  const scriptPath = path.join(process.cwd(), "scripts", "extract_text.py");
  const pythonCmd = process.platform === "win32" ? "py" : "python3";

  return new Promise((resolve, reject) => {
    const child = spawn(pythonCmd, [scriptPath, ...args], { env: process.env });
    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Python process timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (err) => { clearTimeout(timer); reject(new Error(`Failed to run Python: ${err.message}`)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(stderr || `Python exited with code ${code}`));
      else resolve(stdout.trim());
    });
  });
}

/** Returns the number of pages in a PDF. Falls back to 1 on error. */
export async function getPageCount(pdfPath: string): Promise<number> {
  const absolutePath = resolvePdfPath(pdfPath);
  try {
    const output = await runPython([absolutePath, "--count"]);
    const result = JSON.parse(output) as { page_count?: number };
    return result.page_count ?? 1;
  } catch {
    return 1;
  }
}

/** Extracts text elements from a single page (0-indexed). Full page scan. */
export async function extractTextFromPdf(
  pdfPath: string,
  pageIndex = 0
): Promise<PdfPlumberResult> {
  const absolutePath = resolvePdfPath(pdfPath);
  try {
    const output = await runPython([absolutePath, String(pageIndex)]);
    const elements: TextElement[] = JSON.parse(output);
    return { elements, scanned: elements.length === 0 };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { elements: [], scanned: false, error: errMsg };
  }
}

/** Extracts text from bottom strip (25%) + right column (30%) only.
 *  Returns elements tagged with their region and a detected title_block_side hint. */
export async function extractTextFromRegions(
  pdfPath: string,
  pageIndex = 0
): Promise<PdfPlumberRegionResult> {
  const absolutePath = resolvePdfPath(pdfPath);
  try {
    const output = await runPython([absolutePath, String(pageIndex), "--regions"]);
    const result = JSON.parse(output) as {
      elements: TextElement[];
      page_width: number;
      page_height: number;
      title_block_side: "bottom" | "right" | "unknown";
      bottom_bbox: [number, number, number, number];
      right_bbox: [number, number, number, number];
    };
    return {
      elements: result.elements,
      scanned: result.elements.length === 0,
      titleBlockSide: result.title_block_side,
      pageWidth: result.page_width,
      pageHeight: result.page_height,
      bottomBbox: result.bottom_bbox,
      rightBbox: result.right_bbox,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      elements: [],
      scanned: false,
      error: errMsg,
      titleBlockSide: "unknown",
      pageWidth: 0,
      pageHeight: 0,
      bottomBbox: [0, 0, 0, 0],
      rightBbox: [0, 0, 0, 0],
    };
  }
}

/** Extracts text from a fixed bounding box (known title block coordinates). */
export async function extractTextFromCrop(
  pdfPath: string,
  pageIndex: number,
  bbox: { x0: number; y0: number; x1: number; y1: number }
): Promise<PdfPlumberCropResult> {
  const absolutePath = resolvePdfPath(pdfPath);
  try {
    const output = await runPython([
      absolutePath,
      String(pageIndex),
      "--crop",
      String(bbox.x0),
      String(bbox.y0),
      String(bbox.x1),
      String(bbox.y1),
    ]);
    const result = JSON.parse(output) as {
      elements: TextElement[];
      page_width: number;
      page_height: number;
      crop_bbox: [number, number, number, number];
    };
    return {
      elements: result.elements,
      scanned: result.elements.length === 0,
      pageWidth: result.page_width,
      pageHeight: result.page_height,
      cropBbox: result.crop_bbox,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      elements: [],
      scanned: false,
      error: errMsg,
      pageWidth: 0,
      pageHeight: 0,
      cropBbox: [bbox.x0, bbox.y0, bbox.x1, bbox.y1],
    };
  }
}

export interface PdfPlumberImageResult {
  imageBase64: string;
  width: number;
  height: number;
  error?: string;
}

/** Renders a PDF page as a base64 PNG for Gemini Vision fallback (scanned PDFs). */
export async function renderPageAsImage(
  pdfPath: string,
  pageIndex = 0,
  resolution = 150
): Promise<PdfPlumberImageResult> {
  const absolutePath = resolvePdfPath(pdfPath);
  try {
    const output = await runPython(
      [absolutePath, String(pageIndex), "--image", String(resolution)],
      60_000 // allow up to 60s for image rendering
    );
    const result = JSON.parse(output) as { image_base64: string; width: number; height: number };
    return {
      imageBase64: result.image_base64,
      width: result.width,
      height: result.height,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { imageBase64: "", width: 0, height: 0, error: errMsg };
  }
}
