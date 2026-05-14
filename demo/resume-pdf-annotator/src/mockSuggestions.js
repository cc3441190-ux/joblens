/**
 * Mock API：返回带 PDF 用户空间坐标的 AI 建议（rect 左下角为原点、y 向上，与 PDF.js viewport 一致）。
 * 坐标针对常见 US Letter（612×792）第一页量级；演示 PDF 尺寸不同时仍可看到批注相对位置。
 */
export const MOCK_SUGGESTIONS_RESPONSE = {
  suggestions: [
    {
      id: "s1",
      type: "highlight",
      page: 1,
      rect: { x: 72, y: 640, width: 420, height: 16 },
      originalText: "本科 · 计算机科学与技术 · GPA 3.6",
      suggestedText:
        "本科 · 计算机科学与技术 · GPA 3.6 / 核心课程：数据结构、操作系统、机器学习",
      reason: "教育模块可补充与 JD 相关的核心课程关键词，提升简历检索命中率",
      confidence: 0.88,
    },
    {
      id: "s2",
      type: "highlight",
      page: 1,
      rect: { x: 72, y: 420, width: 220, height: 14 },
      originalText: "从0到1设计 AI Native 实习陪伴平台",
      suggestedText:
        "负责 UniPass AI 平台从0到1的需求调研与功能设计，协调研发、设计团队推动项目落地",
      reason: "JD 要求「跨部门协调」，当前表述缺少协作落地信息",
      confidence: 0.95,
    },
    {
      id: "s6",
      type: "highlight",
      page: 1,
      rect: { x: 130, y: 418, width: 160, height: 14 },
      originalText: "主导需求文档与原型",
      suggestedText: "输出 PRD 与可交互原型，组织评审并跟踪迭代闭环",
      reason: "与 s2 区域重叠：强化「闭环」与可量化产出",
      confidence: 0.82,
    },
    {
      id: "s7",
      type: "highlight",
      page: 1,
      rect: { x: 100, y: 412, width: 200, height: 22 },
      originalText: "技术栈：React / Node / LLM API",
      suggestedText: "技术栈：React 18、Node.js、OpenAI 兼容 API、RAG 流水线",
      reason: "与 s2、s6 同区堆叠：技术栈建议更贴近 JD 关键词",
      confidence: 0.79,
    },
    {
      id: "s3",
      type: "strikethrough",
      page: 1,
      rect: { x: 72, y: 300, width: 380, height: 13 },
      originalText: "熟练使用 Word、Excel、PPT、打字快",
      suggestedText:
        "Python、TypeScript、Docker、GitHub Actions、Prometheus 监控与告警",
      reason: "技能栏应突出岗位硬技能，删除泛办公描述并替换为工程化栈",
      confidence: 0.91,
    },
    {
      id: "s4",
      type: "underline",
      page: 1,
      rect: { x: 72, y: 708, width: 260, height: 14 },
      originalText: "求职意向：前端实习生",
      suggestedText: "求职意向：前端工程师（实习）｜B 端 / 生产力工具方向",
      reason: "岗位表述过窄，可对齐 JD 中的业务域与职级写法",
      confidence: 0.87,
    },
    {
      id: "s5",
      type: "highlight",
      page: 1,
      rect: { x: 72, y: 200, width: 300, height: 14 },
      originalText: "自我评价：学习能力强，善于沟通",
      suggestedText:
        "自我评价：在 3 个月实习中独立交付 2 个模块，跨 3 个团队同步需求",
      reason: "缺少可验证结果；低置信度模型对「软实力」改写不确定性较高",
      confidence: 0.6,
    },
  ],
};

export function fetchMockSuggestions() {
  return new Promise((resolve) => {
    setTimeout(
      () => resolve(JSON.parse(JSON.stringify(MOCK_SUGGESTIONS_RESPONSE))),
      400
    );
  });
}
