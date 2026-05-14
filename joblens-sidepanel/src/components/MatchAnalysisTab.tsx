import { useEffect, useMemo, useState } from "react";
import type { MockPerspectiveResponse } from "../data/mockPerspective";
import { GapCard } from "./GapCard";

interface MatchAnalysisTabProps {
  data: MockPerspectiveResponse | null;
  loading: boolean;
  todoDone: Record<string, boolean>;
  dispatchCheck: boolean;
  onTodoToggle: (id: string, next: boolean) => void;
  onGoModifyTranslator: (translatorId: string | undefined) => void;
  onDispatchCheck: (next: boolean) => void;
  onOpenBossJob: (url: string) => void;
  onRefresh: () => void;
}

const R = 52;
const CX = 60;
const CY = 60;
const CIRC = 2 * Math.PI * R;

function ScoreRing({ pct, durationMs }: { pct: number; durationMs: number }) {
  const [off, setOff] = useState(CIRC);
  useEffect(() => {
    const targetOff = CIRC * (1 - Math.min(100, Math.max(0, pct)) / 100);
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const u = Math.min(1, (now - start) / durationMs);
      const ease = 1 - Math.pow(1 - u, 3);
      setOff(CIRC + (targetOff - CIRC) * ease);
      if (u < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [pct, durationMs]);

  return (
    <svg width={120} height={120} viewBox="0 0 120 120" className="-rotate-90 shrink-0 tabular-nums">
      <circle cx={CX} cy={CY} r={R} fill="none" stroke="#EEF0F5" strokeWidth={10} />
      <circle
        cx={CX}
        cy={CY}
        r={R}
        fill="none"
        stroke="#1677FF"
        strokeWidth={10}
        strokeLinecap="round"
        strokeDasharray={CIRC}
        strokeDashoffset={off}
        style={{ transition: "stroke-dashoffset 0.1s linear" }}
      />
    </svg>
  );
}

function AnimatedScoreBlock({ value }: { value: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const target = Math.min(100, Math.max(0, value));
    const t0 = Date.now();
    const dur = 800;
    let raf = 0;
    const tick = () => {
      const p = Math.min(1, (Date.now() - t0) / dur);
      const ease = 1 - Math.pow(1 - p, 3);
      setN(Math.round(target * ease));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return (
    <div className="flex flex-nowrap items-baseline justify-center text-neutral-900">
      <span className="text-[48px] font-bold leading-none tabular-nums tracking-tight">{n}</span>
      <span className="ml-1 text-xl font-bold">%</span>
    </div>
  );
}

export function MatchAnalysisTab({
  data,
  loading,
  todoDone,
  dispatchCheck,
  onTodoToggle,
  onGoModifyTranslator,
  onDispatchCheck,
  onOpenBossJob,
  onRefresh,
}: MatchAnalysisTabProps) {
  const topGaps = data?.gaps?.slice(0, 3) || [];

  const gapTodoIds = useMemo(
    () =>
      (data?.gaps || [])
        .filter((g) => g.todo)
        .map((g) => g.todo!.id),
    [data?.gaps]
  );

  const totalSteps = Math.max(
    data?.todoQuotaTotal ?? gapTodoIds.length + (gapTodoIds.length > 0 ? 1 : 0),
    gapTodoIds.length
  );

  const completedGapTodos = gapTodoIds.filter((id) => todoDone[id]).length;
  const completedAll =
    gapTodoIds.length > 0 &&
    gapTodoIds.every((id) => todoDone[id]) &&
    (totalSteps <= gapTodoIds.length || dispatchCheck);

  const progressLabel = `${Math.min(completedGapTodos + (dispatchCheck ? 1 : 0), totalSteps)} / ${totalSteps}`;

  if (loading && !data) {
    return (
      <div className="flex flex-col gap-4 px-4 py-10 text-center text-sm text-neutral-500">
        <p className="text-2xl">⏳</p>
        <p className="font-medium text-neutral-700">正在同步 Boss 职位与 JD…</p>
        <p className="text-neutral-500">
          👉 请勿过快切换列表，避免在途分析被覆盖。
        </p>
      </div>
    );
  }

  if (data?.errorCode === "boss_dom") {
    return (
      <div className="mx-4 mt-6 rounded-xl bg-white p-4 shadow-card ring-1 ring-neutral-100">
        <p className="flex gap-2 font-semibold text-[#FF4D4F]">
          <span>⚠️</span> Boss 页面结构可能已更新
        </p>
        <p className="mt-3 text-sm leading-relaxed text-neutral-700">
          ✅ 请点下方刷新，或重新点开目标职位卡片触发抓取。
        </p>
        <button
          type="button"
          onClick={onRefresh}
          className="mt-5 w-full rounded-lg bg-brand py-3 text-center text-sm font-semibold text-white"
        >
          🔄 刷新分析
        </button>
      </div>
    );
  }

  if (data?.errorCode === "image_jd") {
    return (
      <div className="mx-4 mt-6 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200">
        <p className="flex gap-2 font-semibold text-amber-900">
          <span>🖼️</span>
          图片型 JD · 暂不可用
        </p>
        <p className="mt-3 text-sm text-amber-950/80">
          ✅ 该职位 JD 为图片格式，暂不支持 AI 分析。
        </p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="px-4 py-14 text-center text-sm text-neutral-500">
        📌 请选择左侧职位列表中的一项，以启动匹配分析。
      </div>
    );
  }

  return (
    <div className="space-y-6 px-4 pb-[calc(6rem+var(--safe-bottom,0px))] pt-3">
      {/* 48px 匹配度 + 环 + 胶囊 */}
      <section className="flex items-center justify-between gap-3">
        <div className="relative h-[120px] w-[120px] shrink-0">
          <ScoreRing pct={data.matchScore} durationMs={800} />
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <AnimatedScoreBlock value={data.matchScore} />
          </div>
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="inline-flex max-w-full items-center rounded-full bg-white px-4 py-2 text-sm font-bold shadow-card ring-1 ring-neutral-100">
            💼 {data.applyCapsuleLabel}
          </div>
          <div className="flex items-center gap-2 text-sm text-neutral-700">
            🧭
            <span className="truncate font-medium text-neutral-800">
              {data.jobTitle || "当前职位"}
            </span>
          </div>
          <p className="text-[16.8px] font-bold leading-snug text-neutral-900">
            <span className="mr-2">✨</span>
            {data.conclusion}
          </p>
        </div>
      </section>

      {/* 全局待办进度 */}
      <div className="flex items-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-neutral-800 shadow-card ring-1 ring-neutral-100">
        <span aria-hidden>🛠️</span>
        <span>待办进度 · {progressLabel}</span>
      </div>

      {completedAll ? (
        <div className="space-y-4 rounded-xl bg-[#E6F4FF] p-4 ring-1 ring-brand/20">
          <p className="text-center text-base font-bold text-brand">
            🎉 简历侧已就绪 · 建议立即前往 Boss 站内投递
          </p>
          <button
            type="button"
            onClick={() => onOpenBossJob(data.jobDetailUrl)}
            className="w-full rounded-lg bg-neutral-900 py-3 text-center text-sm font-semibold text-white"
          >
            ✅ 去 Boss 投递
          </button>
        </div>
      ) : null}

      <div className="space-y-3">
        <h2 className="flex items-center gap-2 text-[16px] font-bold text-neutral-900">
          📊 <span>核心缺口 · TOP 3</span>
        </h2>
        {topGaps.map((g) => (
          <GapCard
            key={g.id}
            gap={g}
            todoDone={g.todo ? !!todoDone[g.todo.id] : false}
            onTodoToggle={(id, next) => onTodoToggle(id, next)}
            onGoModify={onGoModifyTranslator}
          />
        ))}
      </div>

      {gapTodoIds.length > 0 && totalSteps > gapTodoIds.length ? (
        <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-white px-4 py-3 text-sm font-medium text-neutral-800 shadow-card ring-1 ring-neutral-100">
          <input
            type="checkbox"
            className="mt-1 size-4 accent-brand"
            checked={dispatchCheck}
            onChange={(e) => onDispatchCheck(e.target.checked)}
          />
          <span>
            <span className="mr-1">📬</span>
            已与 JD 关键词自检，准备发送沟通/投递
          </span>
        </label>
      ) : null}

      {loading ? (
        <p className="flex items-center gap-2 text-xs text-neutral-500">
          🔄 刷新中… Boss 侧 SPA 可能稍有延迟。
        </p>
      ) : null}
    </div>
  );
}
