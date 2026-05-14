import { useMemo, useState } from "react";
import SuggestionBubble from "./SuggestionBubble.jsx";
import { usePdfCoordinates } from "../usePdfCoordinates.js";

function rectsOverlap(a, b) {
  return !(
    a.left + a.width < b.left ||
    b.left + b.width < a.left ||
    a.top + a.height < b.top ||
    b.top + b.height < a.top
  );
}

function clusterByOverlap(layoutItems) {
  const n = layoutItems.length;
  if (n === 0) return [];
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (i, j) => {
    parent[find(i)] = find(j);
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (rectsOverlap(layoutItems[i].box, layoutItems[j].box)) {
        union(i, j);
      }
    }
  }
  const buckets = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!buckets.has(r)) buckets.set(r, []);
    buckets.get(r).push(layoutItems[i]);
  }
  return [...buckets.values()];
}

function unionBox(items) {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const { box } of items) {
    left = Math.min(left, box.left);
    top = Math.min(top, box.top);
    right = Math.max(right, box.left + box.width);
    bottom = Math.max(bottom, box.top + box.height);
  }
  return { left, top, width: right - left, height: bottom - top };
}

/**
 * 叠在 canvas 上的批注层：高亮 / 下划线 / 删除线、💡 图标、重叠堆叠、气泡。
 */
export default function AnnotationLayer({
  viewport,
  pageWidth,
  pageHeight,
  suggestions,
  statusById,
  flashingIds,
  replacePreviewById,
  activeBubbleId,
  onOpenBubble,
  onCloseBubble,
  onAccept,
  onIgnore,
}) {
  const { rectToCss } = usePdfCoordinates(viewport);
  const [hoveredId, setHoveredId] = useState(null);
  const [openStackKey, setOpenStackKey] = useState(null);

  const layoutItems = useMemo(() => {
    return suggestions
      .map((s) => {
        const box = rectToCss(s.rect);
        if (!box || box.width <= 0 || box.height <= 0) return null;
        return { suggestion: s, box };
      })
      .filter(Boolean);
  }, [suggestions, rectToCss]);

  const clusters = useMemo(() => clusterByOverlap(layoutItems), [layoutItems]);

  const clusterMeta = useMemo(() => {
    return clusters.map((items, idx) => {
      const union = unionBox(items);
      const key = `c-${idx}`;
      return { key, items, union };
    });
  }, [clusters]);

  const activeSuggestion = useMemo(
    () => suggestions.find((s) => s.id === activeBubbleId) || null,
    [suggestions, activeBubbleId]
  );

  const anchorForBubble = useMemo(() => {
    if (!activeSuggestion) return null;
    const box = rectToCss(activeSuggestion.rect);
    return box;
  }, [activeSuggestion, rectToCss]);

  return (
    <div
      className="annotation-layer"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
      }}
    >
      {clusterMeta.map(({ key, items, union }) => {
        const activeInCluster = items.filter(
          ({ suggestion: s }) => (statusById[s.id] || "pending") !== "ignored"
        );
        const stackCount = activeInCluster.length;
        const showStackBadge = stackCount > 1;
        const iconLeft = union.left + union.width - 12;
        const iconTop = union.top - 8;
        const stackOpen = openStackKey === key;

        return (
          <div key={key} style={{ pointerEvents: "auto" }}>
            {items.map(({ suggestion: s, box }) => {
              const st = statusById[s.id] || "pending";
              const isIgnored = st === "ignored";
              const isFlash = flashingIds.has(s.id);
              const preview = replacePreviewById[s.id];
              const hiddenIcon = isIgnored || showStackBadge;

              const baseZ = 2;
              const dim = isIgnored ? "annotation-muted" : "";

              return (
                <div key={s.id} className={dim} style={{ position: "absolute", zIndex: baseZ }}>
                  {s.type === "highlight" && (
                    <div
                      className={`highlight-rect ${isFlash ? "highlight-rect--flash" : ""}`}
                      style={{
                        position: "absolute",
                        left: box.left,
                        top: box.top,
                        width: box.width,
                        height: box.height,
                        borderRadius: 2,
                        pointerEvents: "auto",
                      }}
                      onMouseEnter={() => setHoveredId(s.id)}
                      onMouseLeave={() => setHoveredId((id) => (id === s.id ? null : id))}
                      onClick={() => {
                        if (!showStackBadge) onOpenBubble(s.id);
                      }}
                    />
                  )}

                  {s.type === "underline" && (
                    <div
                      className="underline-wrap"
                      style={{
                        position: "absolute",
                        left: box.left,
                        top: box.top,
                        width: box.width,
                        height: box.height,
                        pointerEvents: "auto",
                      }}
                      onMouseEnter={() => setHoveredId(s.id)}
                      onMouseLeave={() => setHoveredId((id) => (id === s.id ? null : id))}
                      onClick={() => {
                        if (!showStackBadge) onOpenBubble(s.id);
                      }}
                    >
                      <div
                        className="underline-rect"
                        style={{
                          position: "absolute",
                          left: 0,
                          top: box.height - 2,
                          width: box.width,
                          height: 2,
                          borderBottom: "2px solid #FF4D4F",
                        }}
                      />
                    </div>
                  )}

                  {s.type === "strikethrough" && (
                    <div
                      className="strikethrough-rect"
                      style={{
                        position: "absolute",
                        left: box.left,
                        top: box.top,
                        width: box.width,
                        minHeight: box.height,
                        textDecoration: "line-through",
                        color: "#999",
                        fontSize: Math.max(10, box.height * 0.85),
                        lineHeight: `${box.height}px`,
                        overflow: "hidden",
                        whiteSpace: "nowrap",
                        textOverflow: "ellipsis",
                        pointerEvents: "auto",
                      }}
                      onMouseEnter={() => setHoveredId(s.id)}
                      onMouseLeave={() => setHoveredId((id) => (id === s.id ? null : id))}
                      onClick={() => {
                        if (!showStackBadge) onOpenBubble(s.id);
                      }}
                    >
                      {s.originalText}
                    </div>
                  )}

                  {hoveredId === s.id && st === "pending" && (
                    <div
                      className="hover-tip"
                      style={{
                        position: "absolute",
                        left: box.left,
                        top: box.top - 28,
                        padding: "4px 8px",
                        background: "rgba(0,0,0,0.75)",
                        color: "#fff",
                        fontSize: 11,
                        borderRadius: 4,
                        whiteSpace: "nowrap",
                        pointerEvents: "none",
                      }}
                    >
                      点击查看建议
                    </div>
                  )}

                  {preview && (
                    <div
                      className="replace-preview"
                      style={{
                        position: "absolute",
                        left: box.left,
                        top: box.top,
                        width: box.width,
                        padding: 4,
                        fontSize: 11,
                        lineHeight: 1.35,
                        background: "rgba(34,197,94,0.25)",
                        borderRadius: 2,
                      }}
                    >
                      {preview}
                    </div>
                  )}

                  {!hiddenIcon && (
                    <button
                      type="button"
                      className="annot-icon"
                      aria-label="打开建议"
                      style={{
                        position: "absolute",
                        left: box.left + box.width - 18,
                        top: box.top - 10,
                        width: 20,
                        height: 20,
                        border: "none",
                        borderRadius: "50%",
                        background: "#facc15",
                        color: "#fff",
                        cursor: "pointer",
                        boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
                        fontSize: 12,
                        lineHeight: "18px",
                        padding: 0,
                        zIndex: 10,
                        pointerEvents: "auto",
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenBubble(s.id);
                      }}
                    >
                      💡
                    </button>
                  )}
                </div>
              );
            })}

            {showStackBadge && (
              <div
                style={{
                  position: "absolute",
                  left: iconLeft,
                  top: iconTop,
                  zIndex: 12,
                  pointerEvents: "auto",
                }}
              >
                <button
                  type="button"
                  className="annot-icon annot-icon--stack"
                  onClick={() => setOpenStackKey((k) => (k === key ? null : key))}
                  title="多条建议重叠，点击查看列表"
                >
                  💡+{stackCount}
                </button>
                {stackOpen && (
                  <ul className="stack-picker">
                    {activeInCluster.map(({ suggestion: s }) => (
                      <li key={s.id}>
                        <button
                          type="button"
                          onClick={() => {
                            onOpenBubble(s.id);
                            setOpenStackKey(null);
                          }}
                        >
                          <span className="stack-picker__id">{s.id}</span>
                          <span className="stack-picker__txt">{s.originalText}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        );
      })}

      {activeSuggestion && anchorForBubble && (
        <div style={{ pointerEvents: "auto", zIndex: 40 }}>
          <SuggestionBubble
            suggestion={activeSuggestion}
            anchorRect={anchorForBubble}
            pageWidth={pageWidth}
            pageHeight={pageHeight}
            onAccept={onAccept}
            onIgnore={onIgnore}
            onClose={onCloseBubble}
          />
        </div>
      )}
    </div>
  );
}
