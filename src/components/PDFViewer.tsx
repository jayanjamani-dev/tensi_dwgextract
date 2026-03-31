"use client";

import { useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export default function PDFViewer({ url }: { url: string }) {
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNum, setPageNum] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="flex items-center gap-3 px-4 py-2 bg-gray-900 text-white text-sm shrink-0">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPageNum((p) => Math.max(1, p - 1))}
            disabled={pageNum <= 1}
            className="px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-40"
          >‹</button>
          <span className="text-xs text-gray-300">
            {pageNum} / {numPages || "—"}
          </span>
          <button
            onClick={() => setPageNum((p) => Math.min(numPages, p + 1))}
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
      <div className="flex-1 overflow-auto flex items-start justify-center p-4">
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
              className="shadow-xl"
            />
          </Document>
        )}
      </div>
    </div>
  );
}
