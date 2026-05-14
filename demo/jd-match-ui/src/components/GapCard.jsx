import React, { useState } from "react";
import { TodoItem } from "./TodoItem.jsx";

const TIER = {
  must_fix: { bar: "bg-must", label: "text-must" },
  nice: { bar: "bg-nice", label: "text-nice" },
  highlight: { bar: "bg-hl", label: "text-hl" },
};

export function GapCard({ gap, todoDone, onToggleTodo, onGoModify }) {
  const [expanded, setExpanded] = useState(false);
  const tier = TIER[gap.tier] || TIER.must_fix;

  return (
    <div className="relative flex overflow-hidden rounded-xl bg-white shadow-card transition-shadow duration-300 hover:shadow-cardHover">
      <div className={`w-1 shrink-0 ${tier.bar}`} aria-hidden />
      <div className="min-w-0 flex-1 p-4 pl-5">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-lg" aria-hidden>
            {gap.icon}
          </span>
          <h3 className={`text-base font-semibold ${tier.label}`}>{gap.title}</h3>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="w-full text-left"
        >
          <p
            className={`text-sm leading-relaxed text-[#555] transition ${
              expanded ? "" : "line-clamp-2"
            }`}
          >
            {gap.body}
          </p>
          <span className="mt-1 inline-block text-xs text-brand">
            {expanded ? "收起 ↑" : "展开更多 ↓"}
          </span>
        </button>
        <div className="mt-4 rounded-lg border border-[#EEE] p-1">
          <TodoItem
            id={gap.todo.id}
            label={gap.todo.label}
            eta={gap.todo.eta}
            done={todoDone}
            onToggle={onToggleTodo}
            onGoModify={onGoModify}
            translatorId={gap.todo.translatorId}
          />
        </div>
      </div>
    </div>
  );
}
