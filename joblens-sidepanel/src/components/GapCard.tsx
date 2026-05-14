import { useState } from "react";
import type { GapCardData } from "../data/mockPerspective";
import { TodoItem } from "./TodoItem";

interface GapCardProps {
  gap: GapCardData;
  todoDone?: boolean;
  onTodoToggle: (todoId: string, next: boolean) => void;
  onGoModify?: (translatorId: string | undefined) => void;
}

const stripe: Record<GapCardData["tier"], { bar: string }> = {
  must_fix: { bar: "bg-[#FF4D4F]" },
  nice: { bar: "bg-[#FAAD14]" },
  highlight: { bar: "bg-[#52C41A]" },
};

export function GapCard({ gap, todoDone = false, onTodoToggle, onGoModify }: GapCardProps) {
  const [open, setOpen] = useState(false);
  const s = stripe[gap.tier];
  const showLowConf = gap.confidence != null && gap.confidence < 0.7;
  const hasExpand = !!(gap.bodyFull && gap.bodyFull.trim().length > 0);

  return (
    <article className="group relative overflow-hidden rounded-xl bg-white shadow-card ring-1 ring-black/[0.03] transition-shadow duration-300 hover:shadow-card-hover">
      <div className={`absolute left-0 top-0 h-full w-1 ${s.bar}`} aria-hidden />
      <div className="relative p-3 pl-4">
        <header className="flex flex-wrap items-center gap-2">
          <span className="text-lg" aria-hidden>
            {gap.icon}
          </span>
          <h3 className="text-[15px] font-semibold leading-snug text-neutral-900">{gap.title}</h3>
          {showLowConf ? (
            <span className="ml-auto shrink-0 rounded bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-200">
              ⚠️ AI 不确定，仅供参考
            </span>
          ) : null}
        </header>

        <div className="mt-2">
          <p
            className={`text-sm leading-relaxed text-neutral-700 transition-all ${open ? "" : "line-clamp-2"}`}
          >
            <span className="mr-1 text-neutral-400">📋</span>
            {open && hasExpand ? gap.bodyFull : gap.bodyShort}
          </p>
          {hasExpand ? (
            <button
              type="button"
              className="mt-1 text-xs font-medium text-brand underline decoration-brand/50 hover:opacity-90"
              onClick={() => setOpen(!open)}
              aria-expanded={open}
            >
              {open ? "▲ 收起分析" : "▼ 展开分析"}
            </button>
          ) : null}
        </div>

        {gap.todo ? (
          <div className="mt-4">
            <TodoItem
              todo={gap.todo}
              done={todoDone}
              onToggle={(id, next) => onTodoToggle(id, next)}
              onGoModify={
                onGoModify
                  ? () => onGoModify(gap.todo?.translatorId)
                  : undefined
              }
            />
          </div>
        ) : null}
      </div>
    </article>
  );
}
