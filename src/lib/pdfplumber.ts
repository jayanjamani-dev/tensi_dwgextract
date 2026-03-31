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

export async function extractTextFromPdf(pdfPath: string): Promise<PdfPlumberResult> {
  const scriptPath = path.join(process.cwd(), "scripts", "extract_text.py");
  const absolutePdfPath = path.isAbsolute(pdfPath)
    ? pdfPath
    : path.join(process.cwd(), pdfPath);

  return new Promise((resolve) => {
    // Try python3 first, fall back to python
    const pythonCmd = process.platform === "win32" ? "python" : "python3";

    const child = spawn(pythonCmd, [scriptPath, absolutePdfPath], {
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => { stdout += data.toString(); });
    child.stderr.on("data", (data) => { stderr += data.toString(); });

    child.on("error", (err) => {
      resolve({ elements: [], scanned: false, error: `Failed to run Python: ${err.message}` });
    });

    child.on("close", (code) => {
      if (code !== 0) {
        resolve({ elements: [], scanned: false, error: stderr || `Python exited with code ${code}` });
        return;
      }

      try {
        const elements: TextElement[] = JSON.parse(stdout.trim());
        const scanned = elements.length === 0;
        resolve({ elements, scanned });
      } catch {
        resolve({ elements: [], scanned: false, error: `JSON parse error: ${stdout.slice(0, 200)}` });
      }
    });
  });
}
