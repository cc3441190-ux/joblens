import React, { useState, useCallback } from "react";

export function ResumeTranslator({
  item,
  onCopy,
  copyLocked,
  linkedTodoDone,
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (copyLocked || copied) return;
    const plain = item.after.replace(/\*\*/g, "");
    onCopy(plain, item.linkedTodoId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [item, onCopy, copyLocked, copied]);

  return (
    <article
      id={`translator-${item.id}`}
      className="scroll-mt-24 rounded-xl bg-white p-4 shadow-card transition-shadow hover:shadow-cardHover md:p-6"
    >
      <div className="relative mb-4 pr-28">
        <h3 className="text-base font-semibold text-[#1a1a1a] md:text-lg">
          {item.sectionTitle}
        </h3>
        <button
          type="button"
          disabled={copyLocked || copied}
          onClick={handleCopy}
          className={`absolute right-0 top-0 rounded-lg px-3 py-2 text-sm font-medium text-white transition md:px-4 ${
            copied
              ? "cursor-default bg-hl"
              : "bg-brand hover:bg-[#0958d9] disabled:opacity-50"
          }`}
        >
          {copied ? "✅ 已复制" : "📋 复制建议文本"}
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 md:gap-6">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[#666]">
            <span>😮‍💨</span> Before
          </div>
          <div className="min-h-[120px] rounded-xl bg-todoBg p-4 text-sm leading-relaxed text-[#999] line-through decoration-must decoration-2">
            {item.before}
          </div>
        </div>

        <div className="flex flex-col md:block">
          <div className="mb-2 flex justify-center md:hidden">
            <span className="rounded-full bg-[#E6F4FF] px-3 py-1 text-xs font-medium text-brand">
              ↓ 建议改为
            </span>
          </div>
          <div className="mb-2 hidden items-center gap-2 text-sm font-medium text-brand md:flex">
            <span>✨</span> After
            <span className="text-lg text-[#CCC]">→</span>
          </div>
          <div className="min-h-[120px] rounded-xl bg-afterBg p-4 text-sm font-bold leading-relaxed text-brand">
            <span
              dangerouslySetInnerHTML={{ __html: item.afterHtml || item.after }}
            />
          </div>
        </div>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-[#888]">{item.footnote}</p>
      {linkedTodoDone && (
        <p className="mt-2 text-xs font-medium text-hl">✓ 关联 Todo 已勾选完成</p>
      )}
    </article>
  );
}
