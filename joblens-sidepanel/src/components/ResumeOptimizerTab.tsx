import type { MockPerspectiveResponse } from "../data/mockPerspective";
import { BeforeAfterCard } from "./BeforeAfterCard";

interface ResumeOptimizerTabProps {
  data: MockPerspectiveResponse;
  onMarkTodosDone: (ids: string[]) => void;
}

export function scrollTranslatorIntoView(translatorId: string) {
  const el = typeof document !== "undefined" ? document.getElementById(`tr-${translatorId}`) : null;
  el?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function ResumeOptimizerTab({ data, onMarkTodosDone }: ResumeOptimizerTabProps) {
  const list = data.translations || [];

  if (list.length === 0) {
    return (
      <section className="mx-4 my-12 rounded-xl bg-white px-6 py-10 text-center shadow-card ring-1 ring-neutral-100">
        <span className="text-4xl">✨</span>
        <h3 className="mt-5 text-[17px] font-bold text-neutral-900">
          高度匹配 · 暂不推荐强制改写段落
        </h3>
        <p className="mt-3 flex gap-2 text-left text-[13px] leading-relaxed text-neutral-600">
          <span>📌</span>
          <span className="min-w-0">
            ✅ 可先完成匹配分析页的待办自检，再跳转 Boss 沟通。
          </span>
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-5 px-3 pb-[calc(6rem+var(--safe-bottom,0px))] pt-2">
      {list.map((t) => (
        <BeforeAfterCard
          key={t.id}
          translation={t}
          scrollAnchorId={`tr-${t.id}`}
          onMarkTodosDone={onMarkTodosDone}
        />
      ))}
    </div>
  );
}
