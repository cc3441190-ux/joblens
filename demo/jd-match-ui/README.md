# AI 简历-JD 匹配分析 · Demo

可运行的 React + Tailwind 演示，按 PRD 输出 3 个 Tab 结构（匹配分析 / 简历优化 / 面试准备），
包含组件：

- `MatchCard`：首屏决策区（环形进度、48px 巨型分数、投递建议胶囊、一句话结论、待办进度条）
- `GapCard`：TOP 3 缺口卡（左侧色条 + 折叠正文 + 内嵌 `TodoItem` + 跳转到翻译器）
- `ResumeTranslator`：Before/After 翻译器（删除线 vs 高亮 `<mark>`，复制按钮 2s 锁定 + 联动 Todo）
- `InterviewAccordion`：手风琴 + STAR + 30s 模拟面试遮罩
- `TodoItem`：受控勾选 + 完成置灰 + 「去修改 →」

## 启动

```bash
cd demo/jd-match-ui
npm install
npm run dev
```

## Mock 数据

- `MOCK_MATCH / MOCK_GAPS / MOCK_TRANSLATORS / MOCK_INTERVIEW`：默认 72% · 可尝试 · 3 待办（其中 1 已完成）
- 底部勾选 **「演示『高度匹配 · 空状态』」** 切到空状态：92% · 强烈推荐 · 无缺口
- 把 3 条 Todo 全部勾上 → 出现「🎉 简历已就绪，建议立即投递」与品牌主色投递按钮
