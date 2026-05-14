import { useCallback, useState } from "react";
import type { InterviewItem } from "../data/mockPerspective";
import { AccordionItem } from "./AccordionItem";
import { MockInterviewModal } from "./MockInterviewModal";

interface InterviewPrepTabProps {
  interviews: InterviewItem[];
}

async function handleCopySTAR(item: InterviewItem) {
  const { s, t, a, r } = item.answer;
  const text =
    `[S] ${s}\n\n` +
    `[T] ${t}\n\n` +
    `[A] ${a}\n\n` +
    `[R] ${r}`;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    console.warn("[JobLens] STAR copy failed");
  }
}

export function InterviewPrepTab({ interviews }: InterviewPrepTabProps) {
  const [mockItem, setMockItem] = useState<InterviewItem | null>(null);

  const openMock = useCallback((item: InterviewItem) => {
    setMockItem(item);
  }, []);

  if (!interviews.length) {
    return (
      <div className="px-4 py-10 text-center text-sm leading-relaxed text-neutral-600">
        <p className="mb-3 text-xl">📋</p>
        <p className="font-medium text-neutral-800">暂未生成面试题</p>
        <p className="mt-2 text-neutral-500">
          ✅ 稍后从「匹配分析」重新拉取透视结果即可获得 STAR 草稿。
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3 px-3 pb-[calc(6rem+var(--safe-bottom,0px))] pt-2">
        {interviews.map((item, idx) => (
          <AccordionItem key={item.id} label={`Q${idx + 1}: ${item.question}`}>
            <div className="space-y-3 px-4 py-4 text-sm leading-relaxed text-neutral-800">
              <p className="flex items-start gap-2 font-semibold text-neutral-900">
                <span>💡</span>
                回答框架 · STAR（逐字稿）
              </p>
              <p>
                <span className="font-semibold text-brand">[S]</span>
                {" "}{item.answer.s}
              </p>
              <p>
                <span className="font-semibold text-brand">[T]</span>
                {" "}{item.answer.t}
              </p>
              <p>
                <span className="font-semibold text-brand">[A]</span>
                {" "}{item.answer.a}
              </p>
              <p>
                <span className="font-semibold text-brand">[R]</span>
                {" "}{item.answer.r}
              </p>
              <div className="flex flex-wrap gap-2 pb-3">
                <button
                  type="button"
                  onClick={() => openMock(item)}
                  className="flex-1 min-w-[8rem] rounded-lg bg-neutral-900 py-3 text-[13px] font-semibold text-white"
                >
                  🎙️ 模拟面试
                </button>
                <button
                  type="button"
                  onClick={() => void handleCopySTAR(item)}
                  className="flex-1 min-w-[8rem] rounded-lg bg-brand py-3 text-[13px] font-semibold text-white"
                >
                  📋 复制回答
                </button>
              </div>
            </div>
          </AccordionItem>
        ))}
      </div>

      <MockInterviewModal item={mockItem} open={!!mockItem} onClose={() => setMockItem(null)} />
    </>
  );
}
