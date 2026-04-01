"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface TitleBlockCoords {
  x: number;
  y: number;
}

interface ExtractedField {
  label: string;
  value: string | null;
  x: number;
  y: number;
  color: string;
}

interface Props {
  url: string;
  pageNumber?: number;
  /** If provided, auto-zoom to this region on load */
  titleBlockCoords?: TitleBlockCoords | null;
  titleBlockLocation?: string | null;
  extractedFields?: ExtractedField[];
}

export default function PDFViewer({ url, pageNumber = 1, titleBlockCoords, titleBlockLocation, extractedFields = [] }: Props) {
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNum, setPageNum] = useState(pageNumber);
  const [scale, setScale] = useState(1.0);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pageLoaded, setPageLoaded] = useState(false);

  // Auto-scroll to title block when page loads
  const scrollToTitleBlock = useCallback(() => {
    const container = containerRef.current;
    if (!container || !pageLoaded) return;

    const pageEl = container.querySelector(".react-pdf__Page") as HTMLElement;
    if (!pageEl) return;

    const pageRect = pageEl.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    if (titleBlockCoords && titleBlockCoords.x > 0 && titleBlockCoords.y > 0) {
      // Scroll to the exact title block coordinate
      // Coordinates are in PDF space — scale them to rendered space
      const scrollX = (titleBlockCoords.x * scale) - containerRect.width / 2;
      const scrollY = (titleBlockCoords.y * scale) - containerRect.height / 2;

      container.scrollTo({
        left: Math.max(0, scrollX),
        top: Math.max(0, scrollY),
        behavior: "smooth",
      });
      return;
    }

    // Fall back to title block location hint
    if (titleBlockLocation) {
      const loc = titleBlockLocation.toLowerCase();
      if (loc.includes("bottom")) {
        // Scroll to bottom of page
        container.scrollTo({
          left: 0,
          top: pageRect.height - containerRect.height + 20,
          behavior: "smooth",
        });
      } else if (loc === "right") {
        // Scroll to right side
        container.scrollTo({
          left: pageRect.width - containerRect.width + 20,
          top: pageRect.height * 0.5,
          behavior: "smooth",
        });
      }
    }
  }, [titleBlockCoords, titleBlockLocation, scale, pageLoaded]);

  useEffect(() => {
    if (pageLoaded) {
      // Small delay to ensure render is complete
      const t = setTimeout(scrollToTitleBlock, 300);
      return () => clearTimeout(t);
    }
  }, [pageLoaded, scrollToTitleBlock]);

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="flex items-center gap-3 px-4 py-2 bg-gray-900 text-white text-sm shrink-0">
        <div className="flex items-center gap-1">
          <button
            onClick={() => { setPageNum((p) => Math.max(1, p - 1)); setPageLoaded(false); }}
            disabled={pageNum <= 1}
            className="px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-40"
          >‹</button>
          <span className="text-xs text-gray-300">
            {pageNum} / {numPages || "—"}
          </span>
          <button
            onClick={() => { setPageNum((p) => Math.min(numPages, p + 1)); setPageLoaded(false); }}
            disabled={pageNum >= numPages}
            className="px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-40"
          >›</button>
        </div>
        <div className="flex items-center gap-1 ml-auto">
          <button onClick={() => setScale((s) => Math.max(0.4, s - 0.2))} className="px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600">−</button>
          <span className="text-xs text-gray-300 w-10 text-center">{(scale * 100).toFixed(0)}%</span>
          <button onClick={() => setScale((s) => Math.min(3, s + 0.2))} className="px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600">+</button>
        </div>
      </div>

      {/* PDF */}
      <div ref={containerRef} className="flex-1 overflow-auto flex items-start justify-center p-4">
        {error ? (
          <div className="text-red-400 text-sm mt-8">{error}</div>
        ) : (
          <Document
            file={url}
            onLoadSuccess={({ numPages }) => setNumPages(numPages)}
            onLoadError={(e) => setError(`Failed to load PDF: ${e.message}`)}
            loading={<div className="text-gray-400 text-sm mt-8">Loading PDF…</div>}
          >
            <Page
              pageNumber={pageNum}
              scale={scale}
              renderTextLayer={true}
              renderAnnotationLayer={false}
              className="shadow-xl relative"
              onRenderSuccess={() => setPageLoaded(true)}
            >
              {/* Field Highlights */}
              {pageLoaded && extractedFields.map((field, i) => {
                // Tailwind color mapping
                const colorMap: Record<string, string> = {
                  blue: "border-blue-500 bg-blue-500/20 text-blue-700",
                  green: "border-green-500 bg-green-500/20 text-green-700",
                  purple: "border-purple-500 bg-purple-500/20 text-purple-700",
                  fuchsia: "border-fuchsia-500 bg-fuchsia-500/20 text-fuchsia-700",
                  amber: "border-amber-500 bg-amber-500/20 text-amber-700",
                  rose: "border-rose-500 bg-rose-500/20 text-rose-700",
                };
                const colorClasses = colorMap[field.color] || "border-gray-500 bg-gray-500/20 text-gray-700";

                return (
                  <div
                    key={i}
                    className={`absolute flex flex-col items-start select-none pointer-events-none ${colorClasses}`}
                    style={{
                      left: field.x * scale,
                      top: Math.max(0, (field.y * scale) - 6), // Offset slightly to frame the text better
                      minWidth: 80 * scale,
                      minHeight: 16 * scale,
                      borderWidth: 2,
                      borderStyle: "solid",
                    }}
                  >
                    <div
                      className="absolute -top-[18px] left-[-2px] whitespace-nowrap text-[10px] font-medium leading-none px-1 py-0.5 rounded-t"
                      style={{
                        backgroundColor: "currentColor",
                        color: "white"
                      }}
                    >
                      {field.label}
                    </div>
                  </div>
                );
              })}
            </Page>
          </Document>
        )}
      </div>
    </div>
  );
}
