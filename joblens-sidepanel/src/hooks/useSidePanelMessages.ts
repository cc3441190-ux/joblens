import { useCallback, useEffect, useRef, useState } from "react";
import type { MockPerspectiveResponse } from "../data/mockPerspective";
import { MOCK_PERSPECTIVE } from "../data/mockPerspective";

export type BossPanelMessage =
  | {
      action: "JOBFLOW_ACTIVE_JD";
      phase: "loading" | "ready";
      card?: { title?: string; company?: string; jobDetailUrl?: string };
      jd?: string;
    }
  | {
      action: "JOBLENS_PERSPECTIVE_RESULT";
      result: MockPerspectiveResponse;
      requestId: number;
    }
  | {
      action: "JOBLENS_BOSS_NAV";
      url?: string;
    };

function hasChromeRuntime(): boolean {
  return typeof chrome !== "undefined" && !!chrome.runtime?.sendMessage && !!chrome.runtime?.onMessage;
}

/**
 * Side Panel 与 Background：`chrome.runtime.sendMessage`。
 * 切换职位：`requestId` 递增并 `AbortController.abort()`；仅应用与当前 id 匹配的 `JOBLENS_PERSPECTIVE_RESULT`。
 */
export function useSidePanelMessages(useMockInitially = true) {
  const [perspective, setPerspective] = useState<MockPerspectiveResponse | null>(
    useMockInitially ? MOCK_PERSPECTIVE : null
  );
  const [loading, setLoading] = useState(false);
  const [requestId, setRequestId] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  const bumpRequestAndAbort = useCallback(() => {
    if (abortRef.current) {
      try {
        abortRef.current.abort();
      } catch {
        /* ignore */
      }
    }
    abortRef.current = new AbortController();
    setRequestId((n) => {
      const next = n + 1;
      requestIdRef.current = next;
      return next;
    });
    return abortRef.current;
  }, []);

  useEffect(() => {
    requestIdRef.current = requestId;
  }, [requestId]);

  useEffect(() => {
    if (!hasChromeRuntime()) {
      console.info("[JobLens] chrome.runtime unavailable — using mock.");
      return;
    }

    const onMsg = (msg: BossPanelMessage) => {
      if (!msg || typeof msg !== "object") return;

      if (msg.action === "JOBLENS_PERSPECTIVE_RESULT") {
        if (msg.requestId !== requestIdRef.current) return;
        setPerspective(msg.result);
        setLoading(false);
        return;
      }

      if (msg.action === "JOBFLOW_ACTIVE_JD") {
        /** 仅在 loading 相位 bump：避免 loading+ready 连发导致 requestId 连跳两次 */
        if (msg.phase === "loading") {
          bumpRequestAndAbort();
          setLoading(true);
        }
        if (msg.phase === "ready" && msg.card) {
          setPerspective((prev) => ({
            ...(prev || MOCK_PERSPECTIVE),
            jobDetailUrl: msg.card?.jobDetailUrl || prev?.jobDetailUrl || "",
            jobTitle: msg.card?.title,
          }));
          /** 实战：应由 JOBLENS_PERSPECTIVE_RESULT 清空 loading；无后台联调时可在此置 false */
          setLoading(false);
        }
        return;
      }

      if (msg.action === "JOBLENS_BOSS_NAV") {
        bumpRequestAndAbort();
        setLoading(true);
        return;
      }
    };

    chrome.runtime.onMessage.addListener(onMsg);
    return () => chrome.runtime.onMessage.removeListener(onMsg);
  }, [bumpRequestAndAbort]);

  const requestPerspectiveRefresh = useCallback(() => {
    if (!hasChromeRuntime()) return;
    const next = requestIdRef.current + 1;
    requestIdRef.current = next;
    setRequestId(next);
    setLoading(true);
    chrome.runtime.sendMessage({ action: "JOBLENS_REQUEST_PERSPECTIVE", requestId: next }, () => {
      void chrome.runtime.lastError;
    });
  }, []);

  return {
    perspective,
    setPerspective,
    loading,
    setLoading,
    requestId,
    bumpRequestAndAbort,
    getAbortSignal: () => abortRef.current?.signal,
    requestPerspectiveRefresh,
  };
}
