/** Mock：覆盖默认 / 悬停 / Todo 完成 / 空状态 / 全部完成 */

export const MOCK_MATCH = {
  score: 72,
  advice: "try",
  oneLiner:
    "你的 UniPass 项目与 JD 的「Query 理解 / 策略链路」高度相关，但缺少 SQL 与搜索侧量化指标，建议投递并在首屏补一条数据结果。",
  todosTotal: 3,
  todosDone: 2,
};

export const MOCK_GAPS = [
  {
    id: "g1",
    tier: "must_fix",
    title: "硬伤 · Must Fix",
    icon: "🧱",
    body:
      "JD 侧重 B 端与企业服务，建议将 UniPass 项目第一句从「社交陪伴」改写为「企业级 AI 助手 / 服务体验」场景，避免面试官误判为纯 C 端社交。",
    todo: {
      id: "t1",
      label: "今晚改写 UniPass 项目第 1 句为 B 端场景",
      eta: "预计 30 分钟",
      translatorId: "tr1",
    },
  },
  {
    id: "g2",
    tier: "nice",
    title: "加分项 · Nice to have",
    icon: "⭐",
    body:
      "补充「SQL + 行为数据交叉分析」一句到技能栏，对齐 JD 的数据分析表述；面试前可背 1 个指标口径。",
    todo: {
      id: "t2",
      label: "技能栏增加 SQL + 行为分析一句",
      eta: "预计 20 分钟",
      translatorId: "tr2",
    },
  },
  {
    id: "g3",
    tier: "highlight",
    title: "已有优势 · Highlight",
    icon: "✨",
    body:
      "「双边平台 + 触发机制」可直接映射到 JD 的供需匹配与增长策略，面试时主动用 JD 关键词复述一遍。",
    todo: {
      id: "t3",
      label: "面试话术：把双边平台映射到「供需匹配」",
      eta: "预计 15 分钟",
      translatorId: null,
    },
  },
];

export const MOCK_TRANSLATORS = [
  {
    id: "tr1",
    sectionTitle: "📝 UniPass 项目 · 建议写法",
    before: "将产品定位为经验共享型双边平台，侧重社交陪伴与情绪价值。",
    after:
      "将产品定位为**企业级 AI 服务体验**场景下的经验共享型双边平台，侧重供需匹配、转化漏斗与可量化留存指标。",
    afterHtml:
      "将产品定位为<mark>企业级 AI 服务体验</mark>场景下的经验共享型双边平台，侧重<mark>供需匹配、转化漏斗与可量化留存指标</mark>。",
    footnote: "* 标亮处新增「企业级 AI 服务体验 / 供需匹配 / 留存指标」以匹配 JD 第 2、3 条要求",
    linkedTodoId: "t1",
  },
  {
    id: "tr2",
    sectionTitle: "📝 技能栏 · 建议写法",
    before: "用户访谈、竞品分析、PRD。",
    after:
      "用户访谈与<mark>行为数据交叉分析</mark>、竞品分析、PRD；熟练使用 <mark>SQL</mark> 做漏斗与留存拆解。",
    afterHtml:
      "用户访谈与<mark>行为数据交叉分析</mark>、竞品分析、PRD；熟练使用 <mark>SQL</mark> 做漏斗与留存拆解。",
    footnote: "* 新增「行为数据交叉分析」「SQL」对齐 JD 数据分析表述",
    linkedTodoId: "t2",
  },
];

export const MOCK_INTERVIEW = [
  {
    id: "q1",
    q: "请举一个你通过用户研究推动产品决策的例子。",
    star: {
      S: "在 UniPass AI 社交平台初期，留存波动明显，团队对「陪伴 vs 工具」定位分歧大。",
      T: "我需要在两周内给出可落地的方向，并说服产研用同一套指标体系对齐。",
      A: "我主导了 10+ 场深度用户访谈，结合行为埋点做交叉分析，输出机会地图与 3 套假设，推动 A/B 验证节奏。",
      R: "核心路径完成率提升 18%，次周留存提升约 20%，后续迭代按同一框架复盘。",
    },
  },
  {
    id: "q2",
    q: "你没有搜索经验，怎么理解「Query 理解」？",
    star: {
      S: "岗位强调搜索策略与 Query 理解，我过往在 UniPass 做意图识别与召回链路。",
      T: "需要把「意图识别」翻译成面试官熟悉的搜索语言。",
      A: "我把用户输入拆成槽位与意图标签，设计语义解析→场景召回→排序的链路，并用离线评测集迭代 badcase。",
      R: "意图 Top1 命中率提升两位数（脱敏），与搜索侧 Query 理解逻辑可类比。",
    },
  },
];

/** 空状态演示：切换 App 内 demoMode 为 "emptyMatch" 时使用 */
export const MOCK_EMPTY = {
  match: { score: 92, advice: "strong", oneLiner: "岗位核心要求与简历主线一致，差异主要在表述颗粒度。", todosTotal: 0, todosDone: 0 },
  gaps: [],
  translators: [],
  interview: [],
};
