import React from "react";

export function TodoItem({
  id,
  label,
  eta,
  done,
  onToggle,
  onGoModify,
  translatorId,
}) {
  return (
    <div
      className={`rounded-md p-3 transition-colors ${
        done ? "bg-[#EAEAEA] text-[#999]" : "bg-todoBg"
      }`}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          role="checkbox"
          aria-checked={done}
          onClick={() => onToggle(id)}
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs ${
            done
              ? "border-[#BBB] bg-[#DDD] text-[#666]"
              : "border-[#D9D9D9] bg-white hover:border-brand"
          }`}
        >
          {done ? "✓" : ""}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-[#333]">☑️ Todo：</span>
            <span className={`text-sm ${done ? "line-through" : ""}`}>{label}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {translatorId && (
              <button
                type="button"
                disabled={done}
                onClick={() => onGoModify(translatorId)}
                className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white transition hover:bg-[#0958d9] disabled:cursor-not-allowed disabled:opacity-40"
              >
                去修改 →
              </button>
            )}
            <span className="text-xs text-[#888]">{eta}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
