import type { TodoDef } from "../data/mockPerspective";

interface TodoItemProps {
  todo: TodoDef;
  done: boolean;
  onToggle: (id: string, next: boolean) => void;
  onGoModify?: () => void;
}

export function TodoItem({ todo, done, onToggle, onGoModify }: TodoItemProps) {
  return (
    <div
      className={`rounded-md bg-[#F5F5F5] p-3 transition-opacity duration-300 ${
        done ? "opacity-60" : "opacity-100"
      }`}
    >
      <label className="flex cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          className="mt-1 size-4 shrink-0 accent-brand"
          checked={done}
          onChange={(e) => onToggle(todo.id, e.target.checked)}
          aria-label="待办完成"
        />
        <span className="min-w-0 flex-1 text-sm font-medium text-neutral-800">
          <span className="text-neutral-500">☑️ Todo：</span>
          {todo.label}
        </span>
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-2 pl-7">
        {onGoModify && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              onGoModify();
            }}
            className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90"
          >
            去修改 →
          </button>
        )}
        {todo.etaMinutes != null ? (
          <span className="rounded-md bg-white px-2 py-1 text-[11px] text-neutral-500 ring-1 ring-neutral-200">
            预计 {todo.etaMinutes} 分钟
          </span>
        ) : null}
      </div>
    </div>
  );
}
