# 项目：AI 求职工作流增强插件 (Chrome Extension Manifest V3)

## 核心产品定位
- 目标用户：校招生 / 初级职场人
- 核心场景：Boss 直聘 Web 端，聚焦"求职决策工作流连续性"。
- 交互原则：零侵入（不覆盖原生 DOM），所有扩展信息收拢至 Side Panel。AI 仅做协同（提供 Diff），不越权接管。

## 技术栈与约束
- 前端：原生 HTML + JS + CSS（无框架、无 Webpack/Vite，Tailwind 已移除）
- 设计系统：`job-copilot-design`（`~/.claude/skills/job-copilot-design/`）
- 架构：Chrome Manifest V3 (Content Script + Side Panel + Background Service Worker + chrome.storage)
- 通信链路：Content Script → Background (relay) → Side Panel
- API 代理：所有 LLM 请求由 Background Service Worker 发出（API Key 仅存于 background.js）
- 严禁行为：不要随意修改现有的数据结构或拦截 Boss 直聘的原生跳转。
- 数据安全：Content Script / Side Panel 本地正则脱敏（手机号→[PHONE]、邮箱→[EMAIL]、身份证→[ID]）

## 设计系统 (job-copilot-design v1.0.0)

### Philosophy
UI 是安静的助手，不是主角。蓝色是唯一的信号色。暖灰中性底，8px 栅格，零阴影。像一份排版精良的简历，不是仪表盘。

### 色彩

**Light Mode：**

| Token | Hex | 用途 |
|-------|-----|------|
| `--bg` | `#FBFBFB` | 页面底色 |
| `--surface1` | `#F5F5F4` | 卡片、面板 |
| `--surface2` | `#E7E5E4` | 嵌套层、hover |
| `--surface3` | `#D6D3D1` | 输入框底 |
| `--border` | `#E7E5E4` | 微妙分割线 |
| `--border-visible` | `#D6D3D1` | 可见边框 |
| `--text1` | `#1C1917` | 标题、正文 |
| `--text2` | `#57534E` | 描述、标签 |
| `--text3` | `#78716C` | 占位符、引导文 |
| `--text4` | `#A8A29E` | 禁用文字、细体 |
| `--accent` | `#3B82F6` | 主按钮、高匹配 |
| `--accent-subtle` | `#EFF6FF` | 蓝色淡底 |
| `--accent-hover` | `#2563EB` | 按钮 hover |

**Dark Mode：**

| Token | Hex |
|-------|-----|
| `--bg` | `#0D0D0F` |
| `--surface1` | `#161616` |
| `--surface2` | `#1E1E1E` |
| `--surface3` | `#2A2A2A` |
| `--border` | `#1E1E1E` |
| `--border-visible` | `#2A2A2A` |
| `--text1` | `#F5F5F4` |
| `--text2` | `#B0B0AE` |
| `--text3` | `#888888` |
| `--text4` | `#5C5C5A` |
| `--accent` | `#4F8CF7` |
| `--accent-subtle` | `#15223A` |

**语义色：**

| Token | Hex | 用途 |
|------|-----|------|
| `--warning` | `#F59E0B` | 中匹配 ☆☆ |
| `--risk` | `#F97316` | 风险标签 |
| `--success` | `#22C55E` | 预留 |

### 渐变

| Token | Light | Dark |
|-------|-------|------|
| `--grad-high` | `135deg #EFF6FF→#DBEAFE` | `135deg #172554→#1E3A8A` |
| `--grad-med` | `135deg #FFFBEB→#FEF3C7` | `135deg #3D2E0A→#4A3510` |
| `--grad-low` | `135deg #F5F5F4→#E7E5E4` | `135deg #1C1C1A→#2A2A28` |

### 排版

| Token | Size | Weight | 用途 |
|-------|------|--------|------|
| `--display` | 18px | 600 | 页面标题 |
| `--h1` | 16px | 600 | 职位标题 |
| `--h2` | 14px | 500 | 卡片标题 |
| `--body` | 13px | 400 | 正文 |
| `--body-sm` | 12px | 400 | 元信息 |
| `--caption` | 11px | 400 | 引导文字 |
| `--label` | 10px | 500 | 细体隐私 |

字体：**Inter** (Google Fonts)，回退 `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`

### 圆角

| Token | Value | 用途 |
|-------|-------|------|
| `--radius` | `8px` | 卡片、按钮、输入框 |
| `--radius-pill` | `999px` | 标签 Pill |

### 间距：8px 栅格

`2xs:2` `xs:4` `sm:8` `md:16` `lg:24` `xl:32` `2xl:48`

### 立体：Flat
零 `box-shadow`。深度靠 `background→surface1` + `1px border`。

### 动效：Mechanical
`150ms ease-out`，无弹跳。

### 组件

| 类名 | 规格 |
|------|------|
| `.card` | `bg:surface1` `border:1px solid border` `radius:8px` `p:12px` |
| `.btn-primary` | `bg:accent` `color:#fff` `radius:8px` `py:8px px:16px` `font:13px/500` |
| `.btn-secondary` | `bg:#fff` `color:text2` `border:1px border-visible` `radius:8px` `py:6px px:12px` `font:12px` |
| `.btn-ghost` | `bg:transparent` `color:text4` `font:11px` `underline` |
| `.tag-positive` | `bg:accent-subtle` `color:#2563EB` `pill` `font:10px` |
| `.tag-warning` | `bg:warning-subtle` `color:#B45309` `pill` |
| `.tag-risk` | `bg:risk-subtle` `color:#C2410C` `pill` |
| `.tag-neutral` | `bg:surface2` `color:text3` `pill` |
| `.stat-card` | `radius:8px` `p:12px` `border:1px border` num:24px/700 |
| `.skeleton` | `bg:surface2` `radius:4px` `pulse 1.5s` |
| `.stars` | `bg:accent-subtle` `color:#2563EB` `pill` `font:10px` |

### 设计原则
1. **One accent.** 蓝色 = 行动 / 高匹配。无其他色彩竞争注意力。
2. **Cards earn their place.** 每个信息模块一张卡。无数据 = 无卡片。
3. **Type hierarchy.** 只靠 size + weight 分级，不靠颜色。
4. **Flat, not floating.** 零阴影，深度靠 bg 变化 + 边框。
5. **State before style.** Loading=skeleton，Empty=引导文，Error=内联。
6. **8px grid.** 所有间距是 8 的倍数。

### 反模式（禁止）
- 不引入 React、Vite、Webpack、Tailwind——纯原生 HTML/JS/CSS
- 不用绿色做正向（蓝色是唯一正向信号）
- 不用 box-shadow
- 卡片圆角不超过 12px
- 不用超过 2 个字重
- 不用彩色图标——统一 `text4`
- 不用 toast 弹窗
- 不展示空卡片
- 禁止喧哗渐变——仅统计卡用 135deg 微渐变

## 开发工作流原则
- 先逻辑后样式：优先输出纯逻辑版本，确保数据流转和 DOM 结构正确。
- 样式规范：使用 `job-copilot-design` CSS tokens + 组件类（`.card` `.btn-primary` `.tag-positive` 等）。
- API 调用全部走 Background Service Worker，Side Panel 不直接 fetch。
- 修改 background.js 或 manifest.json 后需完全移除插件再重新加载。
