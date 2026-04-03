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

export interface BoundingBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Props {
  url: string;
  pageNumber?: number;
  /** If provided, auto-zoom to this region on load */
  titleBlockCoords?: TitleBlockCoords | null;
  titleBlockLocation?: string | null;
  extractedFields?: ExtractedField[];
  onRegionExtract?: (bbox: BoundingBox, fieldName: string, imageBase64?: string | null) => void;
}

export default function PDFViewer({ url, pageNumber = 1, titleBlockCoords, titleBlockLocation, extractedFields = [], onRegionExtract }: Props) {
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNum, setPageNum] = useState(pageNumber);
  const [scale, setScale] = useState(1.0);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pageLoaded, setPageLoaded] = useState(false);

  // Region selection states
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [currentPos, setCurrentPos] = useState<{ x: number; y: number } | null>(null);
  const [finalBbox, setFinalBbox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [selectedField, setSelectedField] = useState("drawingNumber");
  
  // Handlers for region selection
  const handlePointerDown = (e: React.PointerEvent) => {
    if (!isSelectMode || e.button !== 0) return; // Only left click in select mode
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    setDragStart({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    setCurrentPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    setFinalBbox(null);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragStart) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setCurrentPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const handlePointerUp = () => {
    if (!dragStart || !currentPos) return;
    const px0 = Math.min(dragStart.x, currentPos.x);
    const py0 = Math.min(dragStart.y, currentPos.y);
    const px1 = Math.max(dragStart.x, currentPos.x);
    const py1 = Math.max(dragStart.y, currentPos.y);
    const w = px1 - px0;
    const h = py1 - py0;

    if (w > 10 && h > 10) {
      setFinalBbox({ x: px0, y: py0, w, h });
    } else {
      setFinalBbox(null);
    }
    setDragStart(null);
    setCurrentPos(null);
  };

  const handleExtractClick = () => {
    if (!finalBbox || !onRegionExtract) return;
    
    // Convert DOM space coordinates to PDF space (divide by scale)
    const bbox: BoundingBox = {
      x0: finalBbox.x / scale,
      y0: finalBbox.y / scale,
      x1: (finalBbox.x + finalBbox.w) / scale,
      y1: (finalBbox.y + finalBbox.h) / scale,
    };

    let imageBase64: string | null = null;
    const canvas = containerRef.current?.querySelector(".react-pdf__Page canvas") as HTMLCanvasElement;
    if (canvas) {
      try {
        const cropCanvas = document.createElement("canvas");
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        
        cropCanvas.width = finalBbox.w * scaleX;
        cropCanvas.height = finalBbox.h * scaleY;
        const ctx = cropCanvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(
            canvas,
            finalBbox.x * scaleX,
            finalBbox.y * scaleY,
            finalBbox.w * scaleX,
            finalBbox.h * scaleY,
            0,
            0,
            cropCanvas.width,
            cropCanvas.height
          );
          imageBase64 = cropCanvas.toDataURL("image/jpeg", 0.9);
        }
      } catch (e) {
        console.error("Failed to extract canvas crop", e);
      }
    }

    onRegionExtract(bbox, selectedField, imageBase64);
  };

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
        <div className="flex items-center gap-4 ml-auto">
          {onRegionExtract && (
            <button
              onClick={() => {
                setIsSelectMode((s) => !s);
                if (isSelectMode) setFinalBbox(null);
              }}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                isSelectMode ? "bg-amber-500 text-black hover:bg-amber-400" : "bg-gray-700 hover:bg-gray-600 text-gray-200"
              }`}
            >
              {isSelectMode ? "Cancel Selection" : "Select Region"}
            </button>
          )}

          <div className="flex items-center gap-1 border-l border-gray-700 pl-4">
            <button onClick={() => setScale((s) => Math.max(0.4, s - 0.2))} className="px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600">−</button>
            <span className="text-xs text-gray-300 w-10 text-center">{(scale * 100).toFixed(0)}%</span>
            <button onClick={() => setScale((s) => Math.min(3, s + 0.2))} className="px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600">+</button>
          </div>
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

              {/* Selection Drag Overlay */}
              {isSelectMode && (
                <div 
                  className="absolute inset-0 z-50 cursor-crosshair"
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  style={{ touchAction: 'none' }}
                >
                  {/* Drawing rect */}
                  {dragStart && currentPos && (
                    <div 
                      className="absolute border border-amber-500 bg-amber-500/20"
                      style={{
                        left: Math.min(dragStart.x, currentPos.x),
                        top: Math.min(dragStart.y, currentPos.y),
                        width: Math.abs(currentPos.x - dragStart.x),
                        height: Math.abs(currentPos.y - dragStart.y),
                      }}
                    />
                  )}
                  {/* Final rect */}
                  {finalBbox && (
                    <div 
                      className="absolute border-2 border-amber-500 bg-amber-500/20 shadow-lg pointer-events-none"
                      style={{
                        left: finalBbox.x,
                        top: finalBbox.y,
                        width: finalBbox.w,
                        height: finalBbox.h,
                      }}
                    />
                  )}
                </div>
              )}

              {/* Selection Context Menu - renders outside the drag overlay to be clickable */}
              {isSelectMode && finalBbox && (
                <div 
                  className="absolute z-50 bg-gray-900 border border-gray-700 shadow-2xl rounded p-2 flex flex-col gap-2 drop-shadow-xl"
                  style={{
                    left: finalBbox.x,
                    top: finalBbox.y + finalBbox.h + 8, // below the box
                  }}
                >
                  <select 
                    title="select a field"
                    className="bg-gray-800 text-sm text-white px-2 py-1 rounded outline-none border border-gray-600 focus:border-amber-500 w-full"
                    value={selectedField}
                    onChange={(e) => setSelectedField(e.target.value)}
                  >
                    <option value="drawingNumber">Drawing Number</option>
                    <option value="drawingTitle">Drawing Title</option>
                    <option value="revision">Revision</option>
                    <option value="revisionDate">Revision Date</option>
                    <option value="status">Status</option>
                    <option value="location">Location</option>
                  </select>
                  <button 
                    onClick={handleExtractClick}
                    className="bg-amber-500 hover:bg-amber-400 text-black text-sm font-semibold rounded px-4 py-1.5 transition-colors shadow"
                  >
                    Extract and Learn
                  </button>
                </div>
              )}

            </Page>
          </Document>
        )}
      </div>
    </div>
  );
}
