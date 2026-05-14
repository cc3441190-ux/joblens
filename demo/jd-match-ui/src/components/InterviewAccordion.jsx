import React, { useState } from "react";

function StarBlock({ label, text }) {
  return (
    <p className="text-sm leading-relaxed text-[#444]">
      <span className="mr-2 inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded bg-[#E6F4FF] text-xs font-bold text-brand">
        {label}
      </span>
      {text}
    </p>
  );
}

export function InterviewAccordion({ items, onMockInterview }) {
  const [openId, setOpenId] = useState(null);

  return (
    <div className="space-y-3">
        {items.map((it, idx) => {
        const open = openId === it.id;
        return (
          <div
            key={it.id}
            className="overflow-hidden rounded-xl bg-white shadow-card transition-shadow hover:shadow-cardHover"
          >
            <button
              type="button"
              onClick={() => setOpenId(open ? null : it.id)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition md:px-5 md:py-4"
              style={{ transition: "background 300ms ease-out" }}
            >
              <span className="text-sm font-semibold text-[#1a1a1a] md:text-base">
                Q{idx + 1}: {it.q}
              </span>
              <span
                className={`shrink-0 text-brand transition-transform duration-300 ease-out ${
                  open ? "rotate-180" : ""
                }`}
              >
                ▼
              </span>
            </button>
            <div
              className={`overflow-hidden transition-all duration-300 ease-out ${
                open ? "max-h-[960px] opacity-100" : "max-h-0 opacity-0"
              }`}
            >
                <div className="border-t border-[#F0F0F0] px-4 pb-4 pt-2 md:px-5 md:pb-5">
                  <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#333]">
                    <span>💡</span> 回答框架（STAR 法则）
                  </p>
                  <div className="space-y-3 rounded-lg bg-[#FAFAFA] p-4">
                    <StarBlock label="S" text={it.star.S} />
                    <StarBlock label="T" text={it.star.T} />
                    <StarBlock label="A" text={it.star.A} />
                    <StarBlock label="R" text={it.star.R} />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onMockInterview(it)}
                      className="rounded-lg border border-brand bg-white px-4 py-2 text-sm font-medium text-brand transition hover:bg-[#E6F4FF]"
                    >
                      🎙️ 模拟面试
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const full = `S ${it.star.S}\nT ${it.star.T}\nA ${it.star.A}\nR ${it.star.R}`;
                        navigator.clipboard?.writeText(full);
                      }}
                      className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-[#0958d9]"
                    >
                      📋 复制回答
                    </button>
                  </div>
                </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
