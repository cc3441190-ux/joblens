import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions, TextLayer } from "pdfjs-dist";
import "pdfjs-dist/web/pdf_viewer.css";
import AnnotationLayer from "./AnnotationLayer.jsx";
import { fetchMockSuggestions } from "../mockSuggestions.js";
import "../pdf-annotator.css";

GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

function PdfPage({
  pageNum,
  pdfDoc,
  scale,
  pageSuggestions,
  statusById,
  flashingIds,
  replacePreviewById,
  activeBubbleId,
  onOpenBubble,
  onCloseBubble,
  onAccept,
  onIgnore,
}) {
  const canvasRef = useRef(null);
  const textLayerRef = useRef(null);
  const renderTaskRef = useRef(null);
  const [viewport, setViewport] = useState(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const page = await pdfDoc.getPage(pageNum);
      const vp = page.getViewport({ scale });
      if (cancelled) return;
      setViewport(vp);

      const canvas = canvasRef.current;
      const textDiv = textLayerRef.current;
      if (!canvas || !textDiv) return;

      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {
          /* ignore */
        }
      }

      canvas.width = vp.width;
      canvas.height = vp.height;
      const ctx = canvas.getContext("2d", { alpha: false });

      const renderTask = page.render({
        canvasContext: ctx,
        viewport: vp,
        canvas,
      });
      renderTaskRef.current = renderTask;

      try {
        await renderTask.promise;
      } catch (e) {
        if (e?.name === "RenderingCancelledException" || e?.name === "AbortException") {
          return;
        }
        console.error(e);
        return;
      }
      if (cancelled) return;

      textDiv.className = "textLayer";
      textDiv.replaceChildren();

      const textLayer = new TextLayer({
        textContentSource: page.streamTextContent(),
        container: textDiv,
        viewport: vp,
      });
      await textLayer.render();
    })();

    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {
          /* ignore */
        }
      }
    };
  }, [pdfDoc, pageNum, scale]);

  if (!viewport) {
    return (
      <div className="page-wrap page-wrap--loading">
        正在渲染第 {pageNum} 页…
      </div>
    );
  }

  return (
    <div
      className="page-wrap"
      style={{
        position: "relative",
        width: viewport.width,
        height: viewport.height,
      }}
    >
      <canvas ref={canvasRef} className="pdf-canvas" />
      <div
        ref={textLayerRef}
        className="text-layer-host"
        aria-hidden="false"
      />
      <AnnotationLayer
        viewport={viewport}
        pageWidth={viewport.width}
        pageHeight={viewport.height}
        suggestions={pageSuggestions}
        statusById={statusById}
        flashingIds={flashingIds}
        replacePreviewById={replacePreviewById}
        activeBubbleId={activeBubbleId}
        onOpenBubble={onOpenBubble}
        onCloseBubble={onCloseBubble}
        onAccept={onAccept}
        onIgnore={onIgnore}
      />
    </div>
  );
}

/**
 * 左侧 PDF（canvas + TextLayer），右侧说明；批注叠在 PDF 上，随 scale 通过 viewport 重算坐标。
 */
export default function PDFViewer({ pdfUrl }) {
  const [pdfDoc, setPdfDoc] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.25);
  const [suggestions, setSuggestions] = useState([]);
  const [ignoredIds, setIgnoredIds] = useState(() => new Set());
  const [removedIds, setRemovedIds] = useState(() => new Set());
  const [flashingIds, setFlashingIds] = useState(() => new Set());
  const [replacePreviewById, setReplacePreviewById] = useState({});
  const [activeBubbleId, setActiveBubbleId] = useState(null);
  const [scanMode, setScanMode] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [loadingPdf, setLoadingPdf] = useState(true);
  const scrollRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingPdf(true);
    setLoadError(null);

    (async () => {
      try {
        const loadingTask = getDocument({
          url: pdfUrl,
          disableRange: true,
          disableStream: true,
        });
        const pdf = await loadingTask.promise;
        if (cancelled) return;

        let textFound = false;
        const checkPages = Math.min(pdf.numPages, 5);
        for (let p = 1; p <= checkPages; p++) {
          const page = await pdf.getPage(p);
          const tc = await page.getTextContent();
          if (tc.items?.length > 0) {
            textFound = true;
            break;
          }
        }
        setScanMode(!textFound);
        setPdfDoc(pdf);
        setNumPages(pdf.numPages);
      } catch (e) {
        if (!cancelled) setLoadError(String(e?.message || e));
      } finally {
        if (!cancelled) setLoadingPdf(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pdfUrl]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetchMockSuggestions();
      if (!cancelled) setSuggestions(res.suggestions || []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onDocDown = (e) => {
      if (!activeBubbleId) return;
      const t = e.target;
      if (t.closest?.(".suggestion-bubble")) return;
      if (t.closest?.(".annot-icon") || t.closest?.(".stack-picker")) return;
      if (t.closest?.(".annotation-layer")) return;
      setActiveBubbleId(null);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [activeBubbleId]);

  const visibleSuggestions = useMemo(
    () => suggestions.filter((s) => !removedIds.has(s.id)),
    [suggestions, removedIds]
  );

  const statusById = useMemo(() => {
    const m = {};
    for (const id of ignoredIds) m[id] = "ignored";
    return m;
  }, [ignoredIds]);

  const pendingCount = useMemo(() => {
    return visibleSuggestions.filter((s) => !ignoredIds.has(s.id)).length;
  }, [visibleSuggestions, ignoredIds]);

  const suggestionsByPage = useMemo(() => {
    const map = new Map();
    for (const s of visibleSuggestions) {
      if (!map.has(s.page)) map.set(s.page, []);
      map.get(s.page).push(s);
    }
    return map;
  }, [visibleSuggestions]);

  const onOpenBubble = useCallback((id) => {
    setActiveBubbleId(id);
  }, []);

  const onCloseBubble = useCallback(() => setActiveBubbleId(null), []);

  const onIgnore = useCallback(
    (id) => {
      setIgnoredIds((prev) => new Set(prev).add(id));
      setActiveBubbleId((cur) => (cur === id ? null : cur));
    },
    []
  );

  const onAccept = useCallback((id) => {
    const s = suggestions.find((x) => x.id === id);
    if (!s) return;
    setFlashingIds((prev) => new Set(prev).add(id));
    setReplacePreviewById((prev) => ({ ...prev, [id]: s.suggestedText }));
    setActiveBubbleId(null);
    window.setTimeout(() => {
      setRemovedIds((prev) => new Set(prev).add(id));
      setFlashingIds((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
      setReplacePreviewById((prev) => {
        const { [id]: _, ...rest } = prev;
        return rest;
      });
    }, 1000);
  }, [suggestions]);

  const acceptAll = useCallback(() => {
    const targets = visibleSuggestions.filter((s) => !ignoredIds.has(s.id));
    targets.forEach((s, i) => {
      window.setTimeout(() => onAccept(s.id), i * 80);
    });
  }, [visibleSuggestions, ignoredIds, onAccept]);

  const ignoreAll = useCallback(() => {
    setIgnoredIds((prev) => {
      const n = new Set(prev);
      visibleSuggestions.forEach((s) => n.add(s.id));
      return n;
    });
    setActiveBubbleId(null);
  }, [visibleSuggestions]);

  return (
    <div className="pdf-viewer-root">
      <header className="pdf-toolbar">
        <div className="pdf-toolbar__title">AI 简历批注</div>
        <div className="pdf-toolbar__stats">
          <span className="pdf-toolbar__badge">{pendingCount} 条待处理建议</span>
          <button type="button" className="tb-btn" onClick={acceptAll} disabled={pendingCount === 0}>
            全部接受
          </button>
          <button type="button" className="tb-btn tb-btn--ghost" onClick={ignoreAll} disabled={pendingCount === 0}>
            全部忽略
          </button>
        </div>
        <label className="pdf-toolbar__zoom">
          缩放
          <input
            type="range"
            min={0.75}
            max={2.25}
            step={0.05}
            value={scale}
            onChange={(e) => setScale(Number(e.target.value))}
          />
          <span>{Math.round(scale * 100)}%</span>
        </label>
      </header>

      <div className="pdf-viewer-body">
        <section className="pdf-pane" ref={scrollRef}>
          {loadError && <div className="pdf-error">无法加载 PDF：{loadError}</div>}
          {loadingPdf && !loadError && <div className="pdf-loading">正在加载 PDF…</div>}
          {scanMode && !loadingPdf && (
            <div className="scan-fallback">
              <strong>当前简历为图片格式，建议上传文字版 PDF 以获得精准批注。</strong>
              <p>已降级为下方文字列表模式（本演示在检测到页面无文本内容时触发）。</p>
              <ul>
                {visibleSuggestions.map((s) => (
                  <li key={s.id}>
                    <span className="scan-fallback__id">{s.id}</span>
                    {s.originalText} → {s.suggestedText}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!scanMode && pdfDoc && (
            <div className="pdf-pages">
              {Array.from({ length: numPages }, (_, i) => i + 1).map((pn) => (
                <PdfPage
                  key={pn}
                  pageNum={pn}
                  pdfDoc={pdfDoc}
                  scale={scale}
                  pageSuggestions={suggestionsByPage.get(pn) || []}
                  statusById={statusById}
                  flashingIds={flashingIds}
                  replacePreviewById={replacePreviewById}
                  activeBubbleId={activeBubbleId}
                  onOpenBubble={onOpenBubble}
                  onCloseBubble={onCloseBubble}
                  onAccept={onAccept}
                  onIgnore={onIgnore}
                />
              ))}
            </div>
          )}
        </section>

        <aside className="pdf-side">
          <h2>使用说明</h2>
          <ol>
            <li>批注层叠在 canvas 之上，坐标由 PDF.js viewport.convertToViewportPoint 转换。</li>
            <li>拖动缩放滑块可验证批注与文字同步缩放。</li>
            <li>重叠建议显示为「💡+N」，点击展开列表。</li>
            <li>「一键替换」为前端模拟：绿色闪烁约 1 秒后移除该条建议。</li>
          </ol>
          <p className="pdf-side__hint">
            演示 PDF 为 Mozilla 样例论文，mock 矩形仅为示意，可能与真实文字不对齐。
          </p>
        </aside>
      </div>
    </div>
  );
}
