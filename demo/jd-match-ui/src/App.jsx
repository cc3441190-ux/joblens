import React, { useCallback, useMemo, useState } from "react";
import { MatchCard } from "./components/MatchCard.jsx";
import { GapCard } from "./components/GapCard.jsx";
import { ResumeTranslator } from "./components/ResumeTranslator.jsx";
import { InterviewAccordion } from "./components/InterviewAccordion.jsx";
import {
  MOCK_MATCH,
  MOCK_GAPS,
  MOCK_TRANSLATORS,
  MOCK_INTERVIEW,
  MOCK_EMPTY,
} from "./mockData.js";

const TABS = [
  { id: "match", label: "🔍 匹配分析" },
  { id: "resume", label: "📝 简历优化" },
  { id: "interview", label: "🎯 面试准备" },
];

function MockInterviewModal({ item, onClose }) {
  const [sec, setSec] = useState(30);
  React.useEffect(() => {
    if (!item) return;
    setSec(30);
    const id = setInterval(() => {
      setSec((s) => {
        if (s <= 1) {
          clearInterval(id);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [item]);

  if (!item) return null;
  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-black/75 p-6 text-white">
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center">
        <p className="text-center text-sm text-white/70">模拟面试 · 30 秒思考</p>
        <h2 className="mt-4 text-center text-xl font-bold leading-snug">
          {item.q}
        </h2>
        <div className="mt-10 text-center">
          <span className="text-6xl font-black tabular-nums text-brand">{sec}</span>
          <span className="ml-2 text-lg">秒</span>
        </div>
        <p className="mt-8 text-center text-sm text-white/60">
          深呼吸，开口前先在脑中过一遍 STAR 四段。
        </p>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="mx-auto mb-8 rounded-lg bg-white/10 px-6 py-3 text-sm hover:bg-white/20"
      >
        结束模拟
      </button>
    </div>
  );
}

export default function App() {
  const [demoEmpty, setDemoEmpty] = useState(false);
  const [tab, setTab] = useState("match");
  const [completedTodos, setCompletedTodos] = useState(() => new Set(["t3"]));
  const [copyUntil, setCopyUntil] = useState(0);
  const [mockQ, setMockQ] = useState(null);

  const match = demoEmpty ? MOCK_EMPTY.match : MOCK_MATCH;
  const gaps = demoEmpty ? MOCK_EMPTY.gaps : MOCK_GAPS;
  const translators = demoEmpty ? MOCK_EMPTY.translators : MOCK_TRANSLATORS;
  const interview = demoEmpty ? MOCK_EMPTY.interview : MOCK_INTERVIEW;

  const todoIds = useMemo(
    () => gaps.map((g) => g.todo.id).filter(Boolean),
    [gaps]
  );
  const allDone =
    todoIds.length > 0 && todoIds.every((id) => completedTodos.has(id));
  const barPercent =
    todoIds.length === 0
      ? 100
      : Math.round((todoIds.filter((id) => completedTodos.has(id)).length / todoIds.length) * 100);

  const copyLocked = Date.now() < copyUntil;

  const onToggleTodo = useCallback((id) => {
    setCompletedTodos((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const onGoModify = useCallback((translatorId) => {
    setTab("resume");
    setTimeout(() => {
      const el = document.getElementById(`translator-${translatorId}`);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 320);
  }, []);

  const onCopyTranslator = useCallback((plain, linkedTodoId) => {
    navigator.clipboard?.writeText(plain).catch(() => {});
    setCopyUntil(Date.now() + 2000);
    if (linkedTodoId) {
      setCompletedTodos((prev) => new Set(prev).add(linkedTodoId));
    }
  }, []);

  const tabIndex = TABS.findIndex((t) => t.id === tab);

  return (
    <div className="min-h-screen bg-page pb-24 font-sans text-sm leading-relaxed text-[#333]">
      {mockQ && <MockInterviewModal item={mockQ} onClose={() => setMockQ(null)} />}

      <header className="sticky top-0 z-50 border-b border-[#E8E8E8] bg-white/95 shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-end justify-between gap-2 px-3 pt-3 md:max-w-5xl md:px-6">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`relative flex-1 pb-3 text-center text-xs font-semibold transition-colors duration-300 ease-out md:text-sm ${
                tab === t.id ? "text-brand" : "text-[#888] hover:text-[#333]"
              }`}
            >
              {t.label}
              <span
                className={`absolute bottom-0 left-1/4 right-1/4 h-0.5 rounded-full bg-brand transition-opacity duration-300 ease-out ${
                  tab === t.id ? "opacity-100" : "opacity-0"
                }`}
              />
            </button>
          ))}
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-3 pt-4 md:max-w-5xl md:px-6 md:pt-6">
        <div className="overflow-hidden">
          <div
            className="flex w-[300%] transition-transform duration-300 ease-out"
            style={{ transform: `translateX(-${(tabIndex * 100) / 3}%)` }}
          >
            {/* —— 匹配分析 —— */}
            <section className="w-1/3 shrink-0 pr-1 md:pr-2">
              <MatchCard match={match} barPercent={barPercent} />

              {!demoEmpty && gaps.length > 0 && (
                <div className="mt-6 space-y-4">
                  <h2 className="flex items-center gap-2 text-base font-bold text-[#1a1a1a] md:text-lg">
                    <span>📌</span> TOP 3 核心缺口
                  </h2>
                  {gaps.map((g) => (
                    <GapCard
                      key={g.id}
                      gap={g}
                      todoDone={completedTodos.has(g.todo.id)}
                      onToggleTodo={onToggleTodo}
                      onGoModify={onGoModify}
                    />
                  ))}
                </div>
              )}

              {demoEmpty && (
                <div className="mt-8 rounded-xl border border-dashed border-[#D9D9D9] bg-white p-10 text-center shadow-card">
                  <p className="text-4xl">✨</p>
                  <p className="mt-3 text-base font-semibold text-[#1a1a1a]">
                    当前岗位与简历高度匹配，无需修改
                  </p>
                  <p className="mt-2 text-xs text-[#888]">
                    仍可切换到「面试准备」积累话术。
                  </p>
                </div>
              )}

              {allDone && !demoEmpty && (
                <div className="mt-8 rounded-xl bg-gradient-to-r from-[#E6F4FF] to-[#F6FFED] p-6 text-center shadow-card">
                  <p className="text-lg font-bold text-[#1a1a1a]">
                    🎉 简历已就绪，建议立即投递
                  </p>
                  <button
                    type="button"
                    className="mt-4 rounded-lg bg-brand px-6 py-3 text-sm font-semibold text-white shadow hover:bg-[#0958d9]"
                  >
                    去 Boss 投递
                  </button>
                </div>
              )}
            </section>

            {/* —— 简历优化 —— */}
            <section className="w-1/3 shrink-0 px-1 md:px-2">
              <h2 className="mb-4 flex items-center gap-2 text-base font-bold md:text-lg">
                <span>📝</span> Before / After 翻译器
              </h2>
              {!demoEmpty && translators.length > 0 ? (
                <div className="space-y-6">
                  {translators.map((tr) => (
                    <ResumeTranslator
                      key={tr.id}
                      item={tr}
                      onCopy={onCopyTranslator}
                      copyLocked={copyLocked}
                      linkedTodoDone={
                        tr.linkedTodoId
                          ? completedTodos.has(tr.linkedTodoId)
                          : false
                      }
                    />
                  ))}
                </div>
              ) : (
                <p className="rounded-xl bg-white p-8 text-center text-[#888] shadow-card">
                  暂无优化条目（空状态）。
                </p>
              )}
            </section>

            {/* —— 面试准备 —— */}
            <section className="w-1/3 shrink-0 pl-1 md:pl-2">
              <h2 className="mb-4 flex items-center gap-2 text-base font-bold md:text-lg">
                <span>🎯</span> 面试弹药库
              </h2>
              {!demoEmpty && interview.length > 0 ? (
                <InterviewAccordion
                  items={interview}
                  onMockInterview={(it) => setMockQ(it)}
                />
              ) : (
                <p className="rounded-xl bg-white p-8 text-center text-[#888] shadow-card">
                  暂无面试题（空状态）。
                </p>
              )}
            </section>
          </div>
        </div>
      </main>

      <footer className="fixed bottom-0 left-0 right-0 border-t border-[#E8E8E8] bg-white/95 px-3 py-2 text-center text-xs text-[#888] backdrop-blur">
        <label className="inline-flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={demoEmpty}
            onChange={(e) => setDemoEmpty(e.target.checked)}
          />
          演示「高度匹配 · 空状态」
        </label>
        <span className="mx-2">|</span>
        <span>npm i &amp;&amp; npm run dev</span>
      </footer>
    </div>
  );
}
