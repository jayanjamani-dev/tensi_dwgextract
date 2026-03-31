import { spawn } from "child_process";
import path from "path";

export interface TextElement {
  text: string;
  x: number;
  y: number;
  size: number;
  page_width: number;
  page_height: number;
}

export interface PdfPlumberResult {
  elements: TextElement[];
  scanned: boolean;
  error?: string;
}

function resolvePdfPath(pdfPath: string): string {
  return path.isAbsolute(pdfPath)
    ? pdfPath
    : path.join(process.cwd(), pdfPath);
}

function runPython(args: string[]): Promise<string> {
  const scriptPath = path.join(process.cwd(), "scripts", "extract_text.py");
  const pythonCmd = process.platform === "win32" ? "python" : "python3";

  return new Promise((resolve, reject) => {
    const child = spawn(pythonCmd, [scriptPath, ...args], { env: process.env });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (err) => reject(new Error(`Failed to run Python: ${err.message}`)));
    child.on("close", (code) => {
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

/** Extracts text elements from a single page (0-indexed). */
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
