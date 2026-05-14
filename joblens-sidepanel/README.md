# JobLens Side Panel（React + Tailwind）

面向 Boss Web 插件的窄屏侧栏演示包：首屏匹配决策 · Tab 分发 · Todo / BeforeAfter / STAR 弹药库。

## 开发与构建

```bash
cd joblens-sidepanel
npm install
npm run dev
npm run build
```

`dist/` 产物可挂载为扩展页面的 `side_panel.default_path`。

> 主入口：**`SidePanel.tsx`**（与需求中的 `SidePanel.jsx` 同义）。

## Manifest V3：`side_panel` 配置示例

```json
{
  "manifest_version": 3,
  "name": "JobLens",
  "version": "0.2.0",
  "permissions": ["sidePanel", "storage", "tabs"],
  "host_permissions": ["https://*.zhipin.com/*"],
  "background": { "service_worker": "background.js" },
  "side_panel": { "default_path": "panel/index.html" },
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'"
  }
}
```

将 `vite build` 得到的 `dist/*` 拷入扩展目录下的 `panel/`（文件名与路径需与 manifest 一致）。

## Background 联调

侧栏监听 `JOBFLOW_ACTIVE_JD`（`phase: loading | ready`）与 `JOBLENS_PERSPECTIVE_RESULT`。完成分析后发：

```js
chrome.runtime.sendMessage({
  action: "JOBLENS_PERSPECTIVE_RESULT",
  requestId,
  result: { /* MockPerspectiveResponse 结构，见 mockPerspective.ts */ },
});
```

## 组件一览

详见 `README` 小节：MatchAnalysisTab、GapCard、TodoItem、ResumeOptimizerTab、BeforeAfterCard、InterviewPrepTab、AccordionItem、MockInterviewModal、`hooks/useSidePanelMessages.ts`。
