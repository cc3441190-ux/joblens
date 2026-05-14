import { useEffect, useMemo, useState } from "react";
import type { InterviewItem } from "../data/mockPerspective";

interface MockInterviewModalProps {
  item: InterviewItem | null;
  open: boolean;
  onClose: () => void;
}

export function MockInterviewModal({ item, open, onClose }: MockInterviewModalProps) {
  const [left, setLeft] = useState(30);

  useEffect(() => {
    if (!open || !item) return;
    setLeft(30);
    const iv = window.setInterval(() => {
      setLeft((x) => {
        if (x <= 1) return 0;
        return x - 1;
      });
    }, 1000);
    return () => window.clearInterval(iv);
  }, [open, item]);

  const progress = useMemo(() => ({ width: `${(left / 30) * 100}%` }), [left]);

  if (!open || !item) return null;

  return (
    <div
      className="fixed inset-0 z-[200] mx-auto flex max-w-[360px] flex-col bg-neutral-900/92 px-5 py-6 text-white"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mock-iv-q"
    >
      <button
        type="button"
        className="mb-6 self-start rounded-lg bg-white/15 px-3 py-2 text-xs font-medium text-white"
        onClick={onClose}
      >
        ✕ 结束模拟
      </button>
      <p id="mock-iv-q" className="flex items-start gap-2 text-xl font-semibold leading-snug">
        <span className="text-2xl">🎙️</span>
        {item.question}
      </p>
      <div className="mt-10">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/65">⌛ 作答时间 · 仅剩</p>
        <p className="mt-2 text-5xl font-bold tabular-nums">{left}</p>
        <div className="mt-6 h-2 w-full overflow-hidden rounded-full bg-white/25">
          <div
            className="h-full rounded-full bg-[#1677FF] transition-[width] duration-1000 linear"
            style={progress}
          />
        </div>
        <p className="mt-8 text-[13px] leading-relaxed text-white/72">
          <span className="mr-1">⚡️</span>不要看点，像在面试间里口述一样开始回答。
          结束后可把 STAR 草稿展开对照。
        </p>
      </div>
      <div className="mt-auto" />
      <button
        type="button"
        className="w-full rounded-lg bg-brand py-3 font-semibold text-white"
        onClick={onClose}
      >
        我作答完毕
      </button>
    </div>
  );
}
