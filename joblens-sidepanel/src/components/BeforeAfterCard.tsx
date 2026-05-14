import { useCallback, useMemo, useState } from "react";
import type { ResumeTranslation } from "../data/mockPerspective";

interface BeforeAfterCardProps {
  translation: ResumeTranslation;
  scrollAnchorId: string;
  onMarkTodosDone: (ids: string[]) => void;
}

function assembleAfterPlain(t: ResumeTranslation): string {
  return t.afterSegments.map((s) => s.text).join("");
}

export function BeforeAfterCard({
  translation,
  scrollAnchorId,
  onMarkTodosDone,
}: BeforeAfterCardProps) {
  const [copied, setCopied] = useState(false);
  const [replacedFlash, setReplacedFlash] = useState(false);
  const [copyLocked, setCopyLocked] = useState(false);

  const fullAfter = useMemo(() => assembleAfterPlain(translation), [translation]);

  const handleCopy = useCallback(async () => {
    if (copyLocked) return;
    try {
      await navigator.clipboard.writeText(fullAfter);
      setCopied(true);
      setCopyLocked(true);
      onMarkTodosDone(translation.linkedTodoIds || []);
      window.setTimeout(() => {
        setCopied(false);
        setCopyLocked(false);
      }, 2000);
    } catch {
      console.warn("[JobLens] clipboard write failed");
    }
  }, [copyLocked, fullAfter, onMarkTodosDone, translation.linkedTodoIds]);

  const handleReplaceDemo = useCallback(() => {
    setReplacedFlash(true);
    onMarkTodosDone(translation.linkedTodoIds || []);
    window.setTimeout(() => setReplacedFlash(false), 1000);
  }, [onMarkTodosDone, translation.linkedTodoIds]);

  return (
    <section id={scrollAnchorId} className="scroll-mt-36 rounded-xl bg-white p-3 shadow-card ring-1 ring-black/[0.03]">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-base">📝</span>
        <h4 className="text-base font-semibold text-neutral-900">{translation.sectionTitle}</h4>
        {translation.lowConfidence ? (
          <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-200">
            AI 不确定 · 仅供参考
          </span>
        ) : null}
      </div>

      <div className="rounded-xl bg-[#F5F5F5] p-3 ring-1 ring-neutral-100">
        <p className="text-xs font-semibold text-[#999]">😮‍💨 Before</p>
        <p className={`mt-1 text-sm leading-relaxed ${replacedFlash ? "" : ""}`}>
          {replacedFlash ? (
            <span className="flash-replace-once inline-block rounded px-1 font-medium text-brand">
              {fullAfter}
            </span>
          ) : (
            <span className="text-[#999] line-through decoration-[#FF4D4F] decoration-[1.6px]">
              {translation.before}
            </span>
          )}
        </p>
      </div>

      <div className="my-3 flex justify-center">
        <span className="text-xs font-semibold tracking-wide text-neutral-500">
          👇 <span className="text-brand">建议改为</span>
        </span>
      </div>

      <div
        className={`rounded-xl border border-[#bae0ff]/70 bg-[#E6F4FF] p-3 ${
          replacedFlash ? "flash-replace-once" : ""
        }`}
      >
        <p className="text-xs font-semibold text-brand">✨ After</p>
        <p className="mt-1 text-sm font-medium leading-relaxed text-brand">
          {translation.afterSegments.map((seg, i) =>
            seg.kind === "new" ? (
              <mark key={i} className="mark-jd-hit">
                {seg.text}
              </mark>
            ) : (
              <span key={i}>{seg.text}</span>
            )
          )}
        </p>
      </div>

      <p className="mt-3 px-1 text-[11px] italic leading-snug text-neutral-500">
        💡{" "}{translation.jdNote.startsWith("*") ? translation.jdNote.slice(1) : translation.jdNote}
      </p>

      <div className="mt-4 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => void handleCopy()}
          disabled={copyLocked}
          className={`w-full rounded-lg py-3 text-center text-sm font-semibold text-white transition-colors ${
            copied ? "bg-[#52C41A]" : "bg-brand hover:opacity-95"
          } disabled:opacity-60`}
        >
          {copied ? "✅ 已复制" : "📋 复制建议文本"}
        </button>
        <button
          type="button"
          onClick={handleReplaceDemo}
          className="rounded-lg bg-white px-4 py-2 text-center text-xs font-semibold text-brand ring-1 ring-brand/40 hover:bg-[#f0f7ff]"
        >
          一键替换 · 预览效果
        </button>
      </div>
    </section>
  );
}
