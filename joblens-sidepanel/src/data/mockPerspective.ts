/** Mock API 响应：与 Background / AI 透视结构对齐，便于替换为真实 sendMessage 结果 */

export type ApplyAdvice = "not_recommended" | "try" | "strongly_recommend";
export type GapTier = "must_fix" | "nice" | "highlight";

export interface TodoDef {
  id: string;
  label: string;
  etaMinutes: number | null;
  /** 点击「去修改」时滚动至简历优化区对应块 */
  translatorId?: string;
}

export interface GapCardData {
  id: string;
  tier: GapTier;
  title: string;
  icon: string;
  /** 默认展示约 2 行；展开后追加完整说明 */
  bodyShort: string;
  bodyFull?: string;
  confidence?: number;
  todo: TodoDef | null;
}

export interface AfterSegment {
  kind: "plain" | "new";
  text: string;
}

export interface ResumeTranslation {
  id: string;
  sectionTitle: string;
  before: string;
  afterSegments: AfterSegment[];
  jdNote: string;
  lowConfidence?: boolean;
  /** 复制/一键替换时自动勾选对应缺口 Todo */
  linkedTodoIds?: string[];
}

export interface STARBlock {
  s: string;
  t: string;
  a: string;
  r: string;
}

export interface InterviewItem {
  id: string;
  question: string;
  answer: STARBlock;
}

export interface MockPerspectiveResponse {
  matchScore: number;
  applyAdvice: ApplyAdvice;
  applyCapsuleLabel: string;
  conclusion: string;
  gaps: GapCardData[];
  translations: ResumeTranslation[];
  interviews: InterviewItem[];
  jobDetailUrl: string;
  jobTitle?: string;
  /** 全局待办总步数（含投递前自检等），UI 如「2/3」 */
  todoQuotaTotal?: number;
  /** Boss 抓取失败时使用 */
  errorCode?: "boss_dom" | "image_jd" | "analysis_failed";
  errorMessage?: string;
}

export const MOCK_PERSPECTIVE: MockPerspectiveResponse = {
  matchScore: 72,
  applyAdvice: "try",
  applyCapsuleLabel: "🟡 可尝试投",
  conclusion:
    "📌 产品与 JD「B 端 + 策略闭环」有部分重叠，补强 UniPass 场景表述与数据一句即可投递试水。",
  jobDetailUrl: "https://www.zhipin.com/job_detail/example.html",
  jobTitle: "产品经理（实习生）",
  todoQuotaTotal: 3,
  gaps: [
    {
      id: "g1",
      tier: "must_fix",
      title: "硬伤 · Must Fix",
      icon: "🧱",
      bodyShort:
        "JD 侧重 B 端与企业服务，建议将 UniPass 项目第一句从「社交陪伴」改写为「企业级 AI 助手」场景。",
      bodyFull:
        "面试官会按 JD 关键词筛简历；若首句仍是 C 端社交叙事，容易被误判为方向不符。建议突出企业侧价值、服务规模或内部效率。",
      confidence: 0.92,
      todo: {
        id: "t1",
        label: "今晚改写 UniPass 项目第 1 句为 B 端场景",
        etaMinutes: 30,
        translatorId: "tr1",
      },
    },
    {
      id: "g2",
      tier: "nice",
      title: "加分项 · Nice to Have",
      icon: "⭐",
      bodyShort:
        "JD 提到数据能力与 SQL；当前技能栏未体现，可加一句交叉分析或与行为数据结合的案例。",
      bodyFull:
        "不必虚构项目，可写在课程大作业或用户行为周报里做过的简单 SQL 透视 + 结论，体现「能从表里取数」即可。",
      confidence: 0.6,
      todo: {
        id: "t2",
        label: "技能栏补充 SQL + 指标口径一句",
        etaMinutes: 60,
        translatorId: "tr2",
      },
    },
    {
      id: "g3",
      tier: "highlight",
      title: "已有优势 · Highlight",
      icon: "✨",
      bodyShort:
        "「AI Native 产品设计 + Prompt 链路」可直接映射 JD 的策略与闭环表述，面试时主动复述关键词。",
      todo: null,
    },
  ],
  translations: [
    {
      id: "tr1",
      sectionTitle: "UniPass 项目 · 建议写法",
      before: "从0到1设计 AI Native 实习陪伴平台",
      afterSegments: [
        {
          kind: "plain",
          text: "负责 UniPass AI 平台从0到1的需求调研与功能设计，协调研发、设计团队推动项目落地；",
        },
        { kind: "new", text: "聚焦企业实习生场景下的双边匹配与留存策略" },
        { kind: "plain", text: "，上线后迭代 5 版核心流程。" },
      ],
      jdNote: '*此处新增「跨部门协调」以匹配 JD 第 3 条要求',
      lowConfidence: false,
      linkedTodoIds: ["t1"],
    },
    {
      id: "tr2",
      sectionTitle: "芒果 TV 实习 · 建议写法",
      before: "在内容运营组负责日常活动页配置，协助推进专题上线。",
      afterSegments: [
        { kind: "plain", text: "在内容运营组负责活动页与专题配置，" },
        {
          kind: "new",
          text: "用 SQL 与埋点交叉分析活动转化漏斗，输出周度复盘并推动 2 次策略调整",
        },
        { kind: "plain", text: "，保障专题按期上线。" },
      ],
      jdNote: "*高亮部分对齐 JD「数据分析 + 闭环迭代」表述",
      lowConfidence: true,
      linkedTodoIds: ["t2"],
    },
  ],
  interviews: [
    {
      id: "iv1",
      question: "请举一个你通过用户研究推动产品决策的例子。",
      answer: {
        s:
          "在 UniPass AI 社交平台初期，用户激活后次日留存只有 18%，团队怀疑是「匹配冷启动」导致体验断层。",
        t:
          "我需要在两周内找到核心流失原因，并给出可落地的首周体验改造方案，避免影响校招推广节奏。",
        a:
          "我主导安排了 10+ 场深度用户访谈，结合行为埋点把用户分为「强社交」与「工具型」两类；针对工具型用户设计「任务清单 + 轻提醒」首周路径，并与研发排期 3 个实验开关做 A/B。",
        r:
          "新版本上线后首周次日留存提升到 22%，团队将结论沉淀为「首周任务模板」，后续两个需求迭代持续沿用。",
      },
    },
    {
      id: "iv2",
      question: "如果业务方坚持加功能，但你觉得会伤害核心体验，你怎么处理？",
      answer: {
        s:
          "在芒果 TV 实习时，业务方希望在活动页增加第四块营销 banner，但会挤压主 CTA 点击区域。",
        t:
          "我需要在不阻塞上线的前提下，既保护转化，又让业务方理解风险，并给出可验证的替代方案。",
        a:
          "我拉通数据同学导出近三次同类活动的热图与点击分布，用一页纸说明「再压缩 CTA 预计损失 8%～12% 转化」；同时提出「二级浮层收纳营销」的设计，并用低保真原型和业务、设计开 30 分钟对齐会。",
        r:
          "最终采用浮层方案按期上线，活动页主 CTA 点击率与历史峰值持平，业务方同意后续大促统一用该模板。",
      },
    },
    {
      id: "iv3",
      question: "描述一次你协调研发与设计按期交付的经历。",
      answer: {
        s:
          "UniPass 版本要在双选会前两周上线「企业侧邀约」最小可用版本，研发排期已满，设计还在多方案探索。",
        t:
          "目标是保证「企业可发起邀约 + 学生可响应」闭环上线，任何非 P0 需求必须砍掉或后置。",
        a:
          "我整理 P0 用户故事并与研发估点，和设计约定 48 小时内定稿交互；每日 15 分钟站会同步阻塞，遇到 scope 蔓延当场记录进下一迭代。",
        r:
          "双选会前 3 天完成联调上线，覆盖 12 家企业试用，无 P0 bug；多出的可视化动效顺延到下一版本。",
      },
    },
  ],
};
