import { useCallback, useEffect, useState } from "react";
import { MatchAnalysisTab } from "./components/MatchAnalysisTab";
import { InterviewPrepTab } from "./components/InterviewPrepTab";
import { ResumeOptimizerTab, scrollTranslatorIntoView } from "./components/ResumeOptimizerTab";
import { useSidePanelMessages } from "./hooks/useSidePanelMessages";

export type TabKey = "match" | "resume" | "interview";

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: "match", label: "匹配分析", icon: "🔍" },
  { key: "resume", label: "简历优化", icon: "📝" },
  { key: "interview", label: "面试准备", icon: "🎯" },
];

function openBossJobPage(url: string) {
  if (!url) return;
  try {
    if (typeof chrome !== "undefined" && chrome.tabs?.create) {
      chrome.tabs.create({ url });
      return;
    }
  } catch {
    /* fallback */
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * Side Panel 主容器：吸顶 Tab + 三联滑屏（固定 360px 视宽）。
 * 需求文档「SidePanel.jsx」→ 本项目使用 `SidePanel.tsx`。
 */
export function SidePanel() {
  const { perspective, loading, requestPerspectiveRefresh } = useSidePanelMessages(true);
  const [tab, setTab] = useState<TabKey>("match");
  const [todoDone, setTodoDone] = useState<Record<string, boolean>>({});
  const [dispatchCheck, setDispatchCheck] = useState(false);

  const tabIndex = Math.max(0, TABS.findIndex((x) => x.key === tab));

  /** 切换职位 URL 后重置勾选（避免上一份 To-do 串联） */
  useEffect(() => {
    const u = perspective?.jobDetailUrl || "";
    if (!u) return;
    setTodoDone({});
    setDispatchCheck(false);
  }, [perspective?.jobDetailUrl]);

  const onTodoToggle = useCallback((id: string, next: boolean) => {
    setTodoDone((m) => ({ ...m, [id]: next }));
  }, []);

  const onMarkTodosDone = useCallback((ids: string[]) => {
    if (!ids.length) return;
    setTodoDone((m) => {
      const next = { ...m };
      for (const id of ids) next[id] = true;
      return next;
    });
  }, []);

  const onGoModifyTranslator = useCallback((translatorId: string | undefined) => {
    setTab("resume");
    window.requestAnimationFrame(() => {
      if (translatorId) scrollTranslatorIntoView(translatorId);
    });
  }, []);

  return (
    <div className="relative mx-auto flex h-[min(100dvh,100vh)] max-h-[min(100dvh,100vh)] max-w-[360px] flex-col overflow-hidden bg-page text-neutral-900">
      <header className="sticky top-0 z-[60] bg-page/98 pb-2 backdrop-blur-sm">
        <div className="flex border-b border-black/[0.06] px-1 pt-1">
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`relative flex-1 whitespace-nowrap py-3 text-center text-[13px] font-semibold transition-colors duration-200 ${
                  active ? "text-brand" : "text-neutral-500 hover:text-neutral-800"
                }`}
              >
                <span aria-hidden>{t.icon}</span>
                {" "}{t.label}
                <span
                  className={`absolute bottom-0 left-3 right-3 h-[2px] rounded-full bg-brand transition-opacity duration-300 ease-out motion-reduce:transition-none ${
                    active ? "opacity-100" : "opacity-0"
                  }`}
                  aria-hidden
                />
              </button>
            );
          })}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden px-0">
        <div
          className="flex h-full w-[1080px] max-w-none transition-transform duration-300 ease-out motion-reduce:transition-none motion-reduce:transform-none"
          style={{ transform: `translateX(-${tabIndex * 360}px)` }}
        >
          <section className="h-full w-[360px] shrink-0 overflow-y-auto overflow-x-hidden">
            <MatchAnalysisTab
              data={perspective}
              loading={loading}
              todoDone={todoDone}
              dispatchCheck={dispatchCheck}
              onTodoToggle={onTodoToggle}
              onGoModifyTranslator={onGoModifyTranslator}
              onDispatchCheck={setDispatchCheck}
              onOpenBossJob={openBossJobPage}
              onRefresh={() => requestPerspectiveRefresh()}
            />
          </section>
          <section className="h-full w-[360px] shrink-0 overflow-y-auto overflow-x-hidden">
            {perspective ? (
              <ResumeOptimizerTab data={perspective} onMarkTodosDone={onMarkTodosDone} />
            ) : (
              <p className="px-6 py-10 text-center text-sm text-neutral-500">📌 暂无透视数据。</p>
            )}
          </section>
          <section className="h-full w-[360px] shrink-0 overflow-y-auto overflow-x-hidden">
            {perspective ? (
              <InterviewPrepTab interviews={perspective.interviews} />
            ) : (
              <p className="px-6 py-10 text-center text-sm text-neutral-500">📌 暂无面试题草稿。</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

export default SidePanel;
