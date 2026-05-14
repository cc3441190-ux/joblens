import React, { useEffect, useState } from "react";

function RingGauge({ score, durationMs = 800 }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const [off, setOff] = useState(c);

  useEffect(() => {
    const t = requestAnimationFrame(() => {
      const pct = Math.min(100, Math.max(0, score)) / 100;
      setOff(c * (1 - pct));
    });
    return () => cancelAnimationFrame(t);
  }, [score, c]);

  return (
    <div className="relative mx-auto h-36 w-36 md:h-44 md:w-44">
      <svg
        viewBox="0 0 120 120"
        className="h-full w-full -rotate-90"
        aria-hidden
      >
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke="#E8E8E8"
          strokeWidth="10"
        />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke="#1677FF"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={off}
          style={{
            transition: `stroke-dashoffset ${durationMs}ms ease-out`,
          }}
        />
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="text-[40px] font-bold leading-none text-[#1a1a1a] md:text-[48px]"
          style={{ fontFamily: "system-ui, sans-serif" }}
        >
          {score}
        </span>
        <span className="text-xs text-[#888]">匹配度</span>
      </div>
    </div>
  );
}

const ADVICE = {
  avoid: { label: "🔴 不建议投", className: "bg-[#FFF1F0] text-must border border-[#FFCCC7]" },
  try: { label: "🟡 可尝试", className: "bg-[#FFFBE6] text-nice border border-[#FFE58F]" },
  strong: { label: "🟢 强烈推荐", className: "bg-[#F6FFED] text-hl border border-[#B7EB8F]" },
};

/** 首屏决策区：巨型数字 + 环 + 胶囊 + 一句话 + 待办进度 */
export function MatchCard({ match, barPercent }) {
  const adv = ADVICE[match.advice] || ADVICE.try;

  return (
    <section className="rounded-xl bg-white p-5 shadow-card md:p-8">
      <div className="flex flex-col items-center gap-6 md:flex-row md:items-center md:justify-center md:gap-12">
        <RingGauge score={match.score} />
        <div className="max-w-xl text-center md:text-left">
          <span
            className={`inline-block rounded-full px-4 py-1.5 text-sm font-semibold ${adv.className}`}
          >
            {adv.label}
          </span>
          <p className="mt-4 text-lg font-bold leading-snug text-[#1a1a1a] md:text-xl">
            {match.oneLiner}
          </p>
          <p className="mt-1 text-xs text-[#999]">结论字号较正文约 +20%</p>
        </div>
      </div>
      <div className="mx-auto mt-8 max-w-lg">
        <div className="mb-1 flex justify-between text-sm text-[#666]">
          <span>🛠️ 待办</span>
          <span>
            {match.todosDone}/{match.todosTotal}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-[#EAEAEA]">
          <div
            className="h-full rounded-full bg-brand"
            style={{
              width: `${barPercent}%`,
              transition: "width 800ms ease-out",
            }}
          />
        </div>
      </div>
    </section>
  );
}
