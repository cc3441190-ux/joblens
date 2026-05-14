import { useState } from "react";

interface AccordionItemProps {
  label: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  /** 可选：标题区右侧插槽（未在面试 Tab 中使用可省略） */
  onHeaderActionSlot?: React.ReactNode;
}

export function AccordionItem({
  label,
  children,
  defaultOpen = false,
  onHeaderActionSlot,
}: AccordionItemProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-card ring-1 ring-black/[0.03] transition-shadow hover:shadow-card-hover">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-start gap-2 px-3 py-3 text-left"
        aria-expanded={open}
      >
        <span className="mt-0.5 shrink-0 text-brand">📌</span>
        <span className="flex-1 text-sm font-semibold leading-snug text-neutral-900">{label}</span>
        <span
          className={`shrink-0 text-neutral-400 transition-transform duration-300 ease-out ${
            open ? "-rotate-180" : "rotate-0"
          }`}
        >
          ▼
        </span>
      </button>
      {onHeaderActionSlot ? (
        <div className="flex justify-end border-t border-neutral-100 px-3 py-2">{onHeaderActionSlot}</div>
      ) : null}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-in-out motion-reduce:transition-none ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden border-t border-neutral-100">{children}</div>
      </div>
    </div>
  );
}
