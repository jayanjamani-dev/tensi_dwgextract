"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface TitleBlockCoords { x: number; y: number; }
interface ExtractedField { label: string; value: string | null; x: number; y: number; color: string; }
export interface BoundingBox { x0: number; y0: number; x1: number; y1: number; }

interface Props {
  url: string;
  pageNumber?: number;
  titleBlockCoords?: TitleBlockCoords | null;
  titleBlockLocation?: string | null;
  extractedFields?: ExtractedField[];
  onRegionExtract?: (bbox: BoundingBox, fieldName: string, imageBase64?: string | null) => void;
}

export default function PDFViewer({
  url, pageNumber = 1, titleBlockCoords, titleBlockLocation, extractedFields = [], onRegionExtract,
}: Props) {
  const [numPages, setNumPages] = useState(0);
  const [pageNum, setPageNum] = useState(pageNumber);

  // ── Two-scale system ─────────────────────────────────────────────
  // displayScale: visual zoom (CSS transform) — updates instantly on gesture
  // renderScale:  actual PDF canvas resolution — updates lazily (debounced)
  const [displayScale, setDisplayScale] = useState(1.0);
  const [renderScale, setRenderScale]   = useState(1.0);
  const displayScaleRef = useRef(1.0);

  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pageLoaded, setPageLoaded] = useState(false);
  const [pageDimensions, setPageDimensions] = useState<{ width: number; height: number } | null>(null);
  const hasFittedRef = useRef(false);

  // Snapshot shown over the blank canvas while react-pdf re-renders
  const [prevSnapshot, setPrevSnapshot] = useState<{ dataUrl: string; w: number; h: number } | null>(null);
  const rerenderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // pdfjs document reference
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfDocRef = useRef<any>(null);

  // Region selection
  const [isSelectMode, setIsSelectMode] = useState(false);
  const isSelectModeRef = useRef(false);
  const [dragStart, setDragStart]   = useState<{ x: number; y: number } | null>(null);
  const [currentPos, setCurrentPos] = useState<{ x: number; y: number } | null>(null);
  const [finalBbox, setFinalBbox]   = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [selectedField, setSelectedField] = useState("drawingNumber");

  // Keep select mode ref in sync
  useEffect(() => { isSelectModeRef.current = isSelectMode; }, [isSelectMode]);

  // ── Drag-to-pan state ────────────────────────────────────────────
  const [isDragging, setIsDragging] = useState(false);
  const panRef = useRef<{ startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(null);

  // ── Fit scale ────────────────────────────────────────────────────
  const computeFitScale = useCallback(() => {
    const container = containerRef.current;
    if (!container || !pageDimensions) return null;
    const pad = 32;
    const availW = container.clientWidth  - pad;
    const availH = container.clientHeight - pad;
    if (availW <= 0 || availH <= 0) return null;
    return Math.min(availW / pageDimensions.width, availH / pageDimensions.height, 5.0);
  }, [pageDimensions]);

  // ── Snapshot + schedule PDF re-render ───────────────────────────
  const scheduleRerender = useCallback((targetScale: number, delay = 300) => {
    if (rerenderTimerRef.current) clearTimeout(rerenderTimerRef.current);
    rerenderTimerRef.current = setTimeout(() => {
      const canvas = containerRef.current
        ?.querySelector(".react-pdf__Page canvas") as HTMLCanvasElement | null;
      if (canvas && canvas.width > 0) {
        try {
          const rect = canvas.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            setPrevSnapshot({ dataUrl: canvas.toDataURL("image/jpeg", 0.9), w: rect.width, h: rect.height });
          }
        } catch { /* CORS / tainted canvas — accept brief blank */ }
      }
      setRenderScale(targetScale);
    }, delay);
  }, []);

  // ── Fetch page dimensions from pdfjs ────────────────────────────
  const fetchPageDimensions = useCallback(async (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pdf: any, pn: number
  ) => {
    try {
      const page = await pdf.getPage(pn);
      const vp   = page.getViewport({ scale: 1 });
      setPageDimensions({ width: vp.width, height: vp.height });
    } catch { /* ignore */ }
  }, []);

  // ── Reset when drawing changes ───────────────────────────────────
  useEffect(() => {
    setPageDimensions(null);
    setPageLoaded(false);
    setPrevSnapshot(null);
    hasFittedRef.current = false;
    if (rerenderTimerRef.current) clearTimeout(rerenderTimerRef.current);
  }, [url]);

  // ── Auto-fit once dimensions are known ──────────────────────────
  useEffect(() => {
    if (!pageDimensions || hasFittedRef.current) return;
    const t = setTimeout(() => {
      const fit = computeFitScale();
      if (fit && fit > 0) {
        hasFittedRef.current = true;
        const s = parseFloat(fit.toFixed(2));
        displayScaleRef.current = s;
        setDisplayScale(s);
        setRenderScale(s);
        setPrevSnapshot(null);
        if (rerenderTimerRef.current) clearTimeout(rerenderTimerRef.current);
      }
    }, 60);
    return () => clearTimeout(t);
  }, [pageDimensions, computeFitScale]);

  // ── Re-fetch dims when page number changes ───────────────────────
  useEffect(() => {
    if (!pdfDocRef.current) return;
    hasFittedRef.current = false;
    setPageLoaded(false);
    fetchPageDimensions(pdfDocRef.current, pageNum);
  }, [pageNum, fetchPageDimensions]);

  // ── Ctrl+scroll / trackpad pinch ─────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const factor = e.deltaMode === 0 ? 1 + Math.abs(e.deltaY) * 0.004 : 1.15;
      const dir    = e.deltaY < 0 ? factor : 1 / factor;
      const next   = parseFloat(Math.min(5, Math.max(0.1, displayScaleRef.current * dir)).toFixed(2));
      displayScaleRef.current = next;
      setDisplayScale(next);
      scheduleRerender(next);
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, [scheduleRerender]);

  // ── Drag-to-pan (all directions, works in all zoom states) ───────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onMouseDown = (e: MouseEvent) => {
      // Skip if in region-select mode or not left button
      if (isSelectModeRef.current || e.button !== 0) return;
      // Skip if clicking a button/input
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase() ?? "";
      if (tag === "button" || tag === "input" || tag === "select" || tag === "a") return;

      panRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        scrollLeft: container.scrollLeft,
        scrollTop: container.scrollTop,
      };
      setIsDragging(true);
      e.preventDefault();
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!panRef.current) return;
      const dx = panRef.current.startX - e.clientX;
      const dy = panRef.current.startY - e.clientY;
      container.scrollLeft = panRef.current.scrollLeft + dx;
      container.scrollTop  = panRef.current.scrollTop  + dy;
    };

    const onMouseUp = () => {
      if (!panRef.current) return;
      panRef.current = null;
      setIsDragging(false);
    };

    container.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      container.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []); // stable — uses refs for mutable state

  // ── Keyboard Ctrl +/-/0 ──────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;

      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        const next = parseFloat(Math.min(5, displayScaleRef.current + 0.2).toFixed(2));
        displayScaleRef.current = next;
        setDisplayScale(next);
        scheduleRerender(next, 150);
      } else if (e.key === "-") {
        e.preventDefault();
        const next = parseFloat(Math.max(0.1, displayScaleRef.current - 0.2).toFixed(2));
        displayScaleRef.current = next;
        setDisplayScale(next);
        scheduleRerender(next, 150);
      } else if (e.key === "0") {
        e.preventDefault();
        const fit = computeFitScale();
        if (fit) {
          const s = parseFloat(fit.toFixed(2));
          displayScaleRef.current = s;
          setDisplayScale(s);
          setRenderScale(s);
          setPrevSnapshot(null);
          if (rerenderTimerRef.current) clearTimeout(rerenderTimerRef.current);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [computeFitScale, scheduleRerender]);

  // ── Region drag ──────────────────────────────────────────────────
  const handlePointerDown = (e: React.PointerEvent) => {
    if (!isSelectMode || e.button !== 0) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const pos  = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setDragStart(pos); setCurrentPos(pos); setFinalBbox(null);
  };
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragStart) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setCurrentPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };
  const handlePointerUp = () => {
    if (!dragStart || !currentPos) return;
    const x0 = Math.min(dragStart.x, currentPos.x), y0 = Math.min(dragStart.y, currentPos.y);
    const x1 = Math.max(dragStart.x, currentPos.x), y1 = Math.max(dragStart.y, currentPos.y);
    if (x1 - x0 > 10 && y1 - y0 > 10) setFinalBbox({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    else setFinalBbox(null);
    setDragStart(null); setCurrentPos(null);
  };

  const handleExtractClick = () => {
    if (!finalBbox || !onRegionExtract) return;
    const bbox: BoundingBox = {
      x0: finalBbox.x / displayScale, y0: finalBbox.y / displayScale,
      x1: (finalBbox.x + finalBbox.w) / displayScale, y1: (finalBbox.y + finalBbox.h) / displayScale,
    };
    let imageBase64: string | null = null;
    const canvas = containerRef.current?.querySelector(".react-pdf__Page canvas") as HTMLCanvasElement;
    if (canvas) {
      try {
        const rect   = canvas.getBoundingClientRect();
        const scaleX = canvas.width  / rect.width;
        const scaleY = canvas.height / rect.height;
        const crop   = document.createElement("canvas");
        crop.width   = finalBbox.w * scaleX;
        crop.height  = finalBbox.h * scaleY;
        const ctx = crop.getContext("2d");
        if (ctx) {
          ctx.drawImage(canvas,
            finalBbox.x * scaleX, finalBbox.y * scaleY, finalBbox.w * scaleX, finalBbox.h * scaleY,
            0, 0, crop.width, crop.height);
          imageBase64 = crop.toDataURL("image/jpeg", 0.9);
        }
      } catch (err) { console.error("Canvas crop failed", err); }
    }
    onRegionExtract(bbox, selectedField, imageBase64);
  };

  // ── Auto-scroll to title block ───────────────────────────────────
  const scrollToTitleBlock = useCallback(() => {
    const container = containerRef.current;
    if (!container || !pageLoaded) return;
    const pageEl = container.querySelector(".react-pdf__Page") as HTMLElement;
    if (!pageEl) return;
    const pageRect      = pageEl.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    if (titleBlockCoords && titleBlockCoords.x > 0 && titleBlockCoords.y > 0) {
      container.scrollTo({
        left: Math.max(0, titleBlockCoords.x * displayScale - containerRect.width  / 2),
        top:  Math.max(0, titleBlockCoords.y * displayScale - containerRect.height / 2),
        behavior: "smooth",
      });
      return;
    }
    if (titleBlockLocation) {
      const loc = titleBlockLocation.toLowerCase();
      if (loc.includes("bottom")) {
        container.scrollTo({ left: 0, top: pageRect.height - containerRect.height + 20, behavior: "smooth" });
      } else if (loc === "right") {
        container.scrollTo({ left: pageRect.width - containerRect.width + 20, top: pageRect.height * 0.5, behavior: "smooth" });
      }
    }
  }, [titleBlockCoords, titleBlockLocation, displayScale, pageLoaded]);

  useEffect(() => {
    if (!pageLoaded) return;
    const t = setTimeout(scrollToTitleBlock, 300);
    return () => clearTimeout(t);
  }, [pageLoaded, scrollToTitleBlock]);

  // ── Helpers ──────────────────────────────────────────────────────
  const zoomButton = (delta: number) => () => {
    const next = parseFloat(Math.min(5, Math.max(0.1, displayScaleRef.current + delta)).toFixed(2));
    displayScaleRef.current = next;
    setDisplayScale(next);
    scheduleRerender(next, 150);
  };

  const resetToFit = () => {
    const fit = computeFitScale();
    if (!fit) return;
    const s = parseFloat(fit.toFixed(2));
    displayScaleRef.current = s;
    setDisplayScale(s);
    setRenderScale(s);
    setPrevSnapshot(null);
    if (rerenderTimerRef.current) clearTimeout(rerenderTimerRef.current);
  };

  const cssTransformRatio = displayScale / renderScale;
  const pw = pageDimensions?.width  ?? 0;
  const ph = pageDimensions?.height ?? 0;

  // Cursor: crosshair in select mode, grabbing while panning, grab otherwise
  const cursor = isSelectMode ? "default" : isDragging ? "grabbing" : "grab";

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">

      {/* ── Toolbar ── */}
      <div className="flex items-center gap-3 px-4 py-2 bg-gray-900 text-white text-sm shrink-0">
        <div className="flex items-center gap-1">
          <button onClick={() => { setPageNum(p => Math.max(1, p - 1)); }} disabled={pageNum <= 1}
            className="px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-40">‹</button>
          <span className="text-xs text-gray-300">{pageNum} / {numPages || "—"}</span>
          <button onClick={() => { setPageNum(p => Math.min(numPages, p + 1)); }} disabled={pageNum >= numPages}
            className="px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-40">›</button>
        </div>

        <div className="flex items-center gap-4 ml-auto">
          {onRegionExtract && (
            <button
              onClick={() => { setIsSelectMode(s => !s); if (isSelectMode) setFinalBbox(null); }}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                isSelectMode ? "bg-amber-500 text-black hover:bg-amber-400" : "bg-gray-700 hover:bg-gray-600 text-gray-200"
              }`}
            >
              {isSelectMode ? "Cancel Selection" : "Select Region"}
            </button>
          )}

          <div className="flex items-center gap-1 border-l border-gray-700 pl-4">
            <button onClick={zoomButton(-0.2)} className="px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600" title="Zoom out (Ctrl −)">−</button>
            <button onClick={resetToFit}
              className="text-xs text-gray-300 w-12 text-center hover:text-white cursor-pointer rounded hover:bg-gray-700 py-0.5 transition-colors"
              title="Fit page (Ctrl 0)"
            >
              {(displayScale * 100).toFixed(0)}%
            </button>
            <button onClick={zoomButton(+0.2)} className="px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600" title="Zoom in (Ctrl +)">+</button>
          </div>
        </div>
      </div>

      {/* ── PDF viewport ────────────────────────────────────────────────
        * Layout trick for unrestricted panning in all directions:
        *
        * The scroll container (containerRef) has overflow:auto.
        * Its direct child uses:
        *   width: fit-content   → expands to hold content at any zoom level
        *   min-width: 100%      → fills the viewport when content is smaller (so centering works)
        *   min-height: 100%     → same for vertical
        * The phantom div inside sets the scroll area to exactly pw×ph×scale.
        * This avoids the classic flexbox justify-center bug where overflowing content
        * extends equally left and right of center but scrollLeft can only be ≥ 0,
        * making the left edge permanently unreachable.
      */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-gray-800 select-none"
        style={{ cursor }}
      >
        {error
          ? <div className="flex items-center justify-center h-full text-red-400 text-sm">{error}</div>
          : (
          <div style={{
            width: "fit-content",
            minWidth: "100%",
            minHeight: "100%",
            padding: "16px",
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}>
            <Document
              file={url}
              onLoadSuccess={async (pdf) => {
                pdfDocRef.current = pdf;
                setNumPages(pdf.numPages);
                await fetchPageDimensions(pdf, pageNum);
              }}
              onLoadError={e => setError(`Failed to load PDF: ${e.message}`)}
              loading={<div className="text-gray-400 text-sm mt-8 self-center">Loading PDF…</div>}
            >
              {pageDimensions ? (
                /*
                 * Phantom div — sets scroll/layout size based on displayScale.
                 * Inner div — holds the actual canvas, CSS-scaled to match displayScale.
                 */
                <div
                  style={{ width: pw * displayScale, height: ph * displayScale, position: "relative", flexShrink: 0 }}
                >
                  {/* ── Inner div: PDF at renderScale, CSS-scaled to displayScale ── */}
                  <div style={{
                    position: "absolute", top: 0, left: 0,
                    width: pw * renderScale, height: ph * renderScale,
                    transform: `scale(${cssTransformRatio})`,
                    transformOrigin: "top left",
                    willChange: "transform",
                  }}>
                    <Page
                      pageNumber={pageNum}
                      scale={renderScale}
                      renderTextLayer={true}
                      renderAnnotationLayer={false}
                      className="shadow-xl"
                      onLoadSuccess={page => {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const vp = (page as any).getViewport({ scale: 1 });
                        setPageDimensions({ width: vp.width, height: vp.height });
                      }}
                      onRenderSuccess={() => {
                        setPageLoaded(true);
                        setPrevSnapshot(null);
                      }}
                    />
                  </div>

                  {/* ── Snapshot overlay: no blank during re-render ── */}
                  {prevSnapshot && (
                    <img
                      src={prevSnapshot.dataUrl}
                      alt=""
                      draggable={false}
                      style={{
                        position: "absolute", top: 0, left: 0,
                        width: prevSnapshot.w, height: prevSnapshot.h,
                        pointerEvents: "none", zIndex: 5,
                      }}
                    />
                  )}

                  {/* ── Drag selection overlay (in displayScale space) ── */}
                  {isSelectMode && (
                    <div
                      style={{ position: "absolute", inset: 0, zIndex: 20, cursor: "crosshair", touchAction: "none" }}
                      onPointerDown={handlePointerDown}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      onPointerCancel={handlePointerUp}
                    >
                      {dragStart && currentPos && (
                        <div className="absolute border border-amber-500 bg-amber-500/20" style={{
                          left: Math.min(dragStart.x, currentPos.x), top: Math.min(dragStart.y, currentPos.y),
                          width: Math.abs(currentPos.x - dragStart.x), height: Math.abs(currentPos.y - dragStart.y),
                        }} />
                      )}
                      {finalBbox && (
                        <div className="absolute border-2 border-amber-500 bg-amber-500/20 shadow-lg pointer-events-none"
                          style={{ left: finalBbox.x, top: finalBbox.y, width: finalBbox.w, height: finalBbox.h }} />
                      )}
                    </div>
                  )}

                  {/* ── Field extraction context menu ── */}
                  {isSelectMode && finalBbox && (
                    <div
                      className="absolute bg-gray-900 border border-gray-700 shadow-2xl rounded p-2 flex flex-col gap-2"
                      style={{ left: finalBbox.x, top: finalBbox.y + finalBbox.h + 8, zIndex: 30 }}
                    >
                      <select
                        title="select a field"
                        className="bg-gray-800 text-sm text-white px-2 py-1 rounded outline-none border border-gray-600 focus:border-amber-500 w-full"
                        value={selectedField} onChange={e => setSelectedField(e.target.value)}
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
                </div>
              ) : (
                <div className="text-gray-400 text-sm mt-8">Loading PDF…</div>
              )}
            </Document>
          </div>
        )}
      </div>
    </div>
  );
}
