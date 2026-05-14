import { useLayoutEffect, useRef, useState } from "react";

/**
 * Figma 风格评论气泡：锚定在高亮附近，空间不足时翻转到下方。
 */
export default function SuggestionBubble({
  suggestion,
  anchorRect,
  pageWidth,
  pageHeight,
  onAccept,
  onIgnore,
  onClose,
}) {
  const bubbleRef = useRef(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [placement, setPlacement] = useState("above");

  useLayoutEffect(() => {
    const bubble = bubbleRef.current;
    if (!bubble || !anchorRect) return;

    const margin = 8;
    const gap = 10;
    const maxW = 320;
    const bw = Math.min(bubble.offsetWidth || maxW, maxW);
    const bh = bubble.offsetHeight || 160;

    let left =
      anchorRect.left + anchorRect.width / 2 - bw / 2;
    left = Math.max(
      margin,
      Math.min(left, pageWidth - bw - margin)
    );

    let topAbove = anchorRect.top - gap - bh;
    let topBelow = anchorRect.top + anchorRect.height + gap;

    if (topAbove < margin) {
      setPlacement("below");
      if (topBelow + bh > pageHeight - margin) {
        topBelow = Math.max(margin, pageHeight - bh - margin);
      }
      setPosition({ top: topBelow, left });
    } else {
      setPlacement("above");
      if (topAbove < margin) topAbove = margin;
      setPosition({ top: topAbove, left });
    }
  }, [anchorRect, pageWidth, pageHeight, suggestion.id, suggestion.originalText]);

  const lowConfidence = suggestion.confidence < 0.7;

  return (
    <div
      ref={bubbleRef}
      className="suggestion-bubble"
      role="dialog"
      aria-label="AI 建议"
      style={{
        position: "absolute",
        top: position.top,
        left: position.left,
        maxWidth: 320,
        zIndex: 50,
      }}
    >
      <div className="suggestion-bubble__arrow" data-placement={placement} />
      <div className="suggestion-bubble__header">
        <span>🤖 AI 建议</span>
        {lowConfidence && (
          <span className="suggestion-bubble__warn">AI 不确定，仅供参考</span>
        )}
      </div>
      <div className="suggestion-bubble__body">
        <div className="suggestion-bubble__row">
          <span className="suggestion-bubble__label">原文</span>
          <span className="suggestion-bubble__text">{suggestion.originalText}</span>
        </div>
        <div className="suggestion-bubble__row">
          <span className="suggestion-bubble__label">建议</span>
          <span className="suggestion-bubble__text">{suggestion.suggestedText}</span>
        </div>
        <div className="suggestion-bubble__row">
          <span className="suggestion-bubble__label">原因</span>
          <span className="suggestion-bubble__text">{suggestion.reason}</span>
        </div>
        {typeof suggestion.confidence === "number" && (
          <div className="suggestion-bubble__meta">
            置信度 {(suggestion.confidence * 100).toFixed(0)}%
          </div>
        )}
      </div>
      <div className="suggestion-bubble__actions">
        <button type="button" className="btn-accept" onClick={() => onAccept(suggestion.id)}>
          ✅ 一键替换
        </button>
        <button type="button" className="btn-ignore" onClick={() => onIgnore(suggestion.id)}>
          ❌ 忽略
        </button>
        <button type="button" className="btn-close" onClick={onClose}>
          关闭
        </button>
      </div>
    </div>
  );
}
