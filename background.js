try {
  importScripts("secrets.js");
} catch (e) {
  /* 可选本地密钥文件，见 secrets.example.js */
}
try {
  importScripts("jobflow-default-api.js");
} catch (e) {
  /* 可选：产品内置体验 Key，见 jobflow-default-api.example.js */
}

var DEEPSEEK_CHAT_URL = "https://api.deepseek.com/chat/completions";
var DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";

/**
 * DeepSeek 鉴权优先级：① 用户侧栏/存储 ② secrets.js ③ jobflow-default-api.js（产品内置体验 Key）
 * @returns {{ apiKey: string, model: string, source: "user"|"secrets"|"shared"|"none" }}
 */
function getDeepSeekAuth(store) {
  store = store || {};
  var fromStorage = String((store && store.deepseekApiKey) || "").trim();
  if (fromStorage) {
    var msUser = String((store && store.deepseekModel) || "").trim();
    var modelUser =
      msUser ||
      (typeof LOCAL_DEEPSEEK_MODEL !== "undefined" && String(LOCAL_DEEPSEEK_MODEL).trim()) ||
      DEFAULT_DEEPSEEK_MODEL;
    return { apiKey: fromStorage, model: modelUser, source: "user" };
  }
  var fromFile =
    typeof LOCAL_DEEPSEEK_API_KEY !== "undefined" &&
    String(LOCAL_DEEPSEEK_API_KEY).trim();
  if (fromFile) {
    var ms2 = String((store && store.deepseekModel) || "").trim();
    var model2 =
      ms2 ||
      (typeof LOCAL_DEEPSEEK_MODEL !== "undefined" && String(LOCAL_DEEPSEEK_MODEL).trim()) ||
      DEFAULT_DEEPSEEK_MODEL;
    return { apiKey: fromFile, model: model2, source: "secrets" };
  }
  var fromShared =
    typeof JOBFLOW_DEFAULT_SHARED_DEEPSEEK_API_KEY !== "undefined" &&
    String(JOBFLOW_DEFAULT_SHARED_DEEPSEEK_API_KEY).trim();
  if (fromShared) {
    var ms3 = String((store && store.deepseekModel) || "").trim();
    var modelShared =
      ms3 ||
      (typeof JOBFLOW_DEFAULT_SHARED_DEEPSEEK_MODEL !== "undefined" &&
        String(JOBFLOW_DEFAULT_SHARED_DEEPSEEK_MODEL).trim()) ||
      DEFAULT_DEEPSEEK_MODEL;
    return { apiKey: fromShared, model: modelShared, source: "shared" };
  }
  var modelOnly =
    String((store && store.deepseekModel) || "").trim() ||
    (typeof LOCAL_DEEPSEEK_MODEL !== "undefined" && String(LOCAL_DEEPSEEK_MODEL).trim()) ||
    DEFAULT_DEEPSEEK_MODEL;
  return { apiKey: "", model: modelOnly, source: "none" };
}

function stripModelJsonString(raw) {
  var s = String(raw).trim();
  if (s.indexOf("```") === 0) {
    s = s.replace(/^```[a-zA-Z]*\s*/, "");
    var end = s.lastIndexOf("```");
    if (end > 0) {
      s = s.substring(0, end).trim();
    }
  }
  var i = s.indexOf("{");
  var j = s.lastIndexOf("}");
  if (i >= 0 && j >= i) {
    s = s.substring(i, j + 1);
  }
  return s;
}

/**
 * 修复因 max_tokens 截断导致的非法 JSON：
 *  - 切掉末尾不完整的字符串（最后一个未闭合的 ）
 *  - 切掉末尾不完整的字段名/值
 *  - 按栈补齐 ]、}
 * 不能 100% 保证语义正确，但能让 JSON.parse 通过，丢失的只有最后一两项。
 */
function repairTruncatedJson(s) {
  if (!s || typeof s !== "string") return s;
  var src = s;
  var inStr = false;
  var esc = false;
  var stack = [];
  var lastSafe = -1;
  for (var k = 0; k < src.length; k++) {
    var ch = src.charAt(k);
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{" || ch === "[") {
      stack.push(ch);
    } else if (ch === "}") {
      if (stack[stack.length - 1] === "{") stack.pop();
    } else if (ch === "]") {
      if (stack[stack.length - 1] === "[") stack.pop();
    }
    if (!stack.length) {
      lastSafe = k;
    }
  }
  if (lastSafe === src.length - 1) return src;
  var body = src;
  if (inStr) {
    var lastQuote = body.lastIndexOf('"');
    if (lastQuote > 0) {
      body = body.substring(0, lastQuote);
    }
  }
  body = body.replace(/[\s,:]+$/, "");
  body = body.replace(/,\s*"[^"]*"\s*:\s*$/, "");
  body = body.replace(/,\s*"[^"]*$/, "");
  body = body.replace(/[\s,]+$/, "");
  var stack2 = [];
  var inStr2 = false;
  var esc2 = false;
  for (var m = 0; m < body.length; m++) {
    var c = body.charAt(m);
    if (esc2) { esc2 = false; continue; }
    if (c === "\\") { esc2 = true; continue; }
    if (c === '"') { inStr2 = !inStr2; continue; }
    if (inStr2) continue;
    if (c === "{" || c === "[") stack2.push(c);
    else if (c === "}" && stack2[stack2.length - 1] === "{") stack2.pop();
    else if (c === "]" && stack2[stack2.length - 1] === "[") stack2.pop();
  }
  while (stack2.length) {
    var top = stack2.pop();
    body += top === "{" ? "}" : "]";
  }
  return body;
}

function parseModelJson(raw) {
  var cleaned = stripModelJsonString(raw);
  try {
    return JSON.parse(cleaned);
  } catch (e1) {
    var repaired = repairTruncatedJson(cleaned);
    try {
      console.warn("[Background] JSON repaired from truncation. orig len=" + cleaned.length + " new len=" + repaired.length);
      return JSON.parse(repaired);
    } catch (e2) {
      var err = new Error(
        "模型返回的 JSON 无法解析（可能被截断）。" +
        "原始尾部: " + cleaned.substring(Math.max(0, cleaned.length - 120)) +
        " | 修复后尾部: " + repaired.substring(Math.max(0, repaired.length - 60))
      );
      err.cause = e1;
      throw err;
    }
  }
}

var JOBFLOW_RESUME_PROFILE_KEY = "jobflow_resume_profile";

function normalizeResumeProfile(raw) {
  var p = raw && typeof raw === "object" ? raw : {};
  function arr(x) {
    if (!Array.isArray(x)) return [];
    return x
      .map(function (t) {
        return String(t || "").trim();
      })
      .filter(Boolean)
      .slice(0, 20);
  }
  return {
    skills: arr(p.skills),
    strengths: arr(p.strengths),
    highlights: arr(p.highlights),
    gaps: arr(p.gaps),
    suggestedRoles: arr(p.suggestedRoles),
    fullAnalysis: String(p.fullAnalysis || "").trim().substring(0, 4000)
  };
}

function resumeProfileBriefJson(profile) {
  if (!profile || typeof profile !== "object") {
    return "（暂无简历画像）";
  }
  return JSON.stringify({
    skills: profile.skills || [],
    strengths: profile.strengths || [],
    highlights: profile.highlights || [],
    gaps: profile.gaps || []
  }).substring(0, 3800);
}

function deepSeekCompletion(apiKey, model, messages, maxTokens, opts) {
  opts = opts || {};
  var payload = {
    model: model,
    temperature: 0.2,
    max_tokens: maxTokens || 256,
    messages: messages
  };
  if (opts.jsonMode) {
    payload.response_format = { type: "json_object" };
  }
  return fetch(DEEPSEEK_CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + apiKey
    },
    body: JSON.stringify(payload)
  }).then(function (res) {
    if (!res.ok) {
      return res.text().then(function (t) {
        throw new Error("HTTP " + res.status + " " + t.substring(0, 200));
      });
    }
    return res.json();
  }).then(function (data) {
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error("Bad response format");
    }
    var content = data.choices[0].message.content || "";
    var finishReason = data.choices[0].finish_reason;
    var usage = data.usage || {};
    console.log(
      "[Background] DeepSeek resp model=" + (data.model || model) +
      " finish=" + finishReason +
      " contentLen=" + content.length +
      " usage=" + (usage.completion_tokens || "?") + "/" + (usage.total_tokens || "?")
    );
    if (finishReason === "length") {
      console.warn("[Background] response truncated by max_tokens, content len=" + content.length);
    }
    if (!content.trim()) {
      var emptyErr = new Error(
        "模型返回空内容（finish_reason=" + finishReason +
        ", jsonMode=" + (opts.jsonMode ? "on" : "off") +
        "）。可能原因：响应被过滤、json_object 模式拒答、或 token 上限过低。"
      );
      emptyErr.isEmptyContent = true;
      emptyErr.finishReason = finishReason;
      // finish_reason=length 但正文为空：多为输出预算被 reasoning/格式占满，交给上层用更大 max_tokens 重试
      emptyErr.isLengthEmpty = finishReason === "length";
      throw emptyErr;
    }
    return content;
  });
}

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(console.error);

chrome.runtime.onInstalled.addListener(function () {
  chrome.contextMenus.create({
    id: "analyze-job",
    title: "用 AI 插件分析该岗位",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener(function (info, tab) {
  if (info.menuItemId === "analyze-job") {
    chrome.sidePanel.open({ windowId: tab.windowId });
    chrome.runtime.sendMessage({
      action: "analyze_selection",
      text: info.selectionText
    }).catch(function () {});
  }
});

// ========== 通信中继 ==========
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message.action === "JOBFLOW_DEEPSEEK_STATUS") {
    chrome.storage.local.get(["deepseekApiKey", "deepseekModel"], function (store) {
      var auth = getDeepSeekAuth(store);
      sendResponse({
        ok: true,
        hasUsableKey: !!auth.apiKey,
        hasUserKey: !!String((store && store.deepseekApiKey) || "").trim(),
        source: auth.source || "none"
      });
    });
    return true;
  }

  if (message.action === "JD_EXTRACTED") {
    console.log("[Background] JD_EXTRACTED len:", message.text.length);
    chrome.runtime.sendMessage({
      action: "PUSH_JD",
      text: message.text,
      title: message.title
    }).catch(function (err) {
      console.error("[Background] PUSH_JD fail:", err);
    });
  }

  if (message.action === "REQUEST_JD") {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs[0]) {
        chrome.runtime.sendMessage({ action: "PUSH_JD_ERROR", error: "no active tab" });
        return;
      }
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: function () {
          var c = document.querySelector(".job-sec-text") ||
            document.querySelector(".job-description") ||
            document.querySelector(".job-detail .detail-content") ||
            document.querySelector("[class*='job-sec']") ||
            document.querySelector(".job-sec-text .text") ||
            document.querySelector(".job-detail-box") ||
            document.querySelector(".job-detail") ||
            document.querySelector(".detail-content");
          if (!c) return "";
          return c.innerText.trim();
        }
      }, function (results) {
        if (chrome.runtime.lastError) {
          chrome.runtime.sendMessage({ action: "PUSH_JD_ERROR", error: chrome.runtime.lastError.message });
          return;
        }
        var text = (results && results[0] && results[0].result) || "";
        console.log("[Background] REQUEST_JD result len:", text.length);
        chrome.runtime.sendMessage({ action: "PUSH_JD", text: text }).catch(function () {});
      });
    });
    return true;
  }

  // ========== 简历画像（存储 jobflow_resume_profile + jobflow_resume_text） ==========
  if (message.action === "AI_ANALYZE_RESUME") {
    var resumeText = (message.resumeText || "").trim().substring(0, 14000);
    if (resumeText.length < 80) {
      sendResponse({ ok: false, error: "简历内容过短，请至少粘贴约 80 字以上有效描述。" });
      return;
    }
    chrome.storage.local.get(["deepseekApiKey", "deepseekModel"], function (store) {
      var auth = getDeepSeekAuth(store);
      if (!auth.apiKey) {
        sendResponse({
          ok: false,
          error:
            "未配置 DeepSeek API Key。侧栏填写、secrets.js 或 jobflow-default-api.js（内置体验 Key）。"
        });
        return;
      }
      deepSeekCompletion(
        auth.apiKey,
        auth.model,
        [
          {
            role: "system",
            content:
              "你是资深职业顾问。只输出严格合法的 JSON 对象，不要任何 markdown 或解释。字段：" +
              "skills(字符串数组，4-8 项核心技能标签，每项不超过 10 字)、" +
              "strengths(字符串数组，2-4 条优势方向短句，每条不超过 30 字)、" +
              "highlights(字符串数组，2-4 条项目/经验亮点短句，每条不超过 35 字)、" +
              "gaps(字符串数组，1-3 条待补充能力短句，每条不超过 25 字)、" +
              "suggestedRoles(字符串数组，3-5 条建议关注的岗位方向，每条不超过 18 字)、" +
              "fullAnalysis(一段不超过 150 字的中文总结)。" +
              "数组项请保持精炼，不要长段落。内容必须严格基于简历文本，勿编造未出现的经历。"
          },
          { role: "user", content: "以下为用户简历全文：\n" + resumeText }
        ],
        2000,
        { jsonMode: true }
      )
        .then(function (raw) {
          var parsed = parseModelJson(raw);
          var profile = normalizeResumeProfile(parsed);
          chrome.storage.local.set(
            {
              jobflow_resume_profile: profile,
              jobflow_resume_text: resumeText
            },
            function () {
              sendResponse({ ok: true, profile: profile });
            }
          );
        })
        .catch(function (err) {
          console.error("[Background] AI_ANALYZE_RESUME:", err);
          sendResponse({ ok: false, error: err.message || String(err) });
        });
    });
    return true;
  }

  // ========== 语义筛选：意图拆成标签 ==========
  if (message.action === "AI_PARSE_FILTER") {
    var rawIn = (message.text || "").trim().substring(0, 500);
    if (!rawIn) {
      sendResponse({ ok: false, error: "empty", tags: [] });
      return;
    }
    chrome.storage.local.get(
      ["deepseekApiKey", "deepseekModel", JOBFLOW_RESUME_PROFILE_KEY],
      function (store) {
      var auth = getDeepSeekAuth(store);
      if (!auth.apiKey) {
        sendResponse({
          ok: false,
          tags: [rawIn],
          error:
            "未配置 DeepSeek API Key。任选：① 侧栏填写；② secrets.js；③ 分发包内 jobflow-default-api.js（内置体验 Key）。申请：platform.deepseek.com/api_keys"
        });
        return;
      }
      var prof = store[JOBFLOW_RESUME_PROFILE_KEY];
      var brief = resumeProfileBriefJson(prof);
      deepSeekCompletion(
        auth.apiKey,
        auth.model,
        [
          {
            role: "system",
            content:
              "你是求职助手。只输出纯JSON，不要markdown。格式：{\"tags\":[\"\"]}。tags为2-5个中文筛选标签（每个不超过8字）。要结合用户原话与简历画像，标签用于在招聘网站筛选岗位。"
          },
          {
            role: "user",
            content:
              "简历画像摘要(JSON)：" +
              brief +
              "\n\n用户本次补充/修改的筛选说法：" +
              rawIn
          }
        ],
        300,
        { jsonMode: true }
      )
        .then(function (raw) {
          var p = parseModelJson(raw);
          var tags = p.tags || [];
          if (!Array.isArray(tags)) {
            tags = [];
          }
          tags = tags
            .map(function (t) {
              return String(t).trim();
            })
            .filter(function (t) {
              return t;
            })
            .slice(0, 5);
          sendResponse({ ok: true, tags: tags.length ? tags : [rawIn] });
        })
        .catch(function () {
          sendResponse({ ok: true, tags: [rawIn] });
        });
    });
    return true;
  }

  // ========== JD 透视：两阶段 —— 先快出匹配度+缺口（推送侧栏），再补简历翻译与面试弹药 ==========
  if (message.action === "AI_JD_PERSPECTIVE") {
    var jpCard = message.card || {};
    var jpJd = String(message.jd || "").trim().substring(0, 2800);
    if (!jpCard.title) {
      sendResponse({ ok: false, error: "缺少卡片信息" });
      return true;
    }
    chrome.storage.local.get(
      ["deepseekApiKey", "deepseekModel", JOBFLOW_RESUME_PROFILE_KEY],
      function (store) {
        var auth = getDeepSeekAuth(store);
        if (!auth.apiKey) {
          sendResponse({
            ok: false,
            error:
              "未配置 DeepSeek API Key。侧栏填写、secrets.js 或 jobflow-default-api.js（内置体验 Key）。"
          });
          return;
        }
        var jpProfile = store[JOBFLOW_RESUME_PROFILE_KEY] || null;
        if (!jpProfile || !jpProfile.skills) {
          sendResponse({ ok: false, error: "请先完成简历画像，再使用 JD 透视。" });
          return;
        }
        var jpBrief = resumeProfileBriefJson(jpProfile);
        var jdBlock = jpJd
          ? "JD 正文（最多 1800 字）：\n" + jpJd
          : "JD 正文：（未抓到，请只依赖卡片标题/公司/薪资做保守判断，并在 oneLiner 中提示「未拿到 JD」）";
        var cardBlock =
          "职位标题：" + (jpCard.title || "") +
          "\n公司：" + (jpCard.company || "") +
          "\n薪资：" + (jpCard.salary || "") +
          "\n地点：" + (jpCard.location || "");
        var userPromptBase =
          "【简历画像 (JSON)】\n" + jpBrief +
          "\n\n【岗位卡片元信息】\n" + cardBlock +
          "\n\n【" + jdBlock + "】";
        var jpCacheKey =
          String(jpCard.idHash || "").trim() ||
          (String(jpCard.title || "").trim() + "|" + String(jpCard.company || "").trim());

        var sysPromptQuick =
          "你同时扮演两个角色：① 目标公司该岗位的直接业务面试官（负责筛简历、问项目）；② 资深产品招聘顾问。" +
          "你的任务不是「做文本匹配」，而是站在面试官桌前，判断这份简历能不能过初筛、面试会被怎么问倒。" +
          "只输出严格合法 JSON，禁止 markdown、代码块、寒暄。" +
          "【在写出最终 JSON 之前，你必须在脑中完成思考链（不得输出思考过程），再落笔字段】" +
          "1）JD 拆解：列出该 JD 的 3 个核心能力要求（硬技能/软技能/行业经验均可），按重要性排序；" +
          "2）简历举证：从用户画像中找出 3 个最强相关证据（项目/技能/经历），分别对应 JD 的哪一项；" +
          "3）缺口推演：基于「面试官看到简历后会质疑什么」，列出 2-3 个最可能的质疑点（关注经验深度能否扛深挖，而非单纯关键词缺失）；" +
          "4）匹配定级：据此给出 matchScore 与 applyAdvice。" +
          "【根字段仅允许】matchScore、applyAdvice、hardCount、oneLiner、gapItems、hits、analysisProcess；禁止 resumeLines、interviewAmmo 及任何未列出的根键。" +
          "【matchScore 0-100】须体现上述推理，严禁仅按关键词出现次数打分。" +
          "显性档位的内部标尺（输出时只给整数）：≥80 表示 3 项核心要求中至少 2 项有「强证据」可扛深挖；" +
          "60-79 表示有相关性但深度不足或缺 1 项关键；<60 表示缺 2 项以上或方向明显不符。" +
          "【applyAdvice】strong|try|avoid。strong=简历证据足以支撑约 30 分钟面试深挖；try=能过初筛但面试需补准备；avoid=初筛即挂或方向不符。" +
          "与 hardCount 自洽：hardCount≥2 时不得为 strong；仅当 hardCount=0 且 matchScore≥75 时才可为 strong。" +
          "【hardCount】0-5，表示「面试必挂级」硬伤条数（与 applyAdvice 逻辑一致）。" +
          "【oneLiner】40-100 字，格式强制为两段式：先写【判断逻辑】再写【结论】，中间可用逗号或分号衔接；" +
          "必须引用画像里真实出现的项目/公司/技能名 + JD 侧能力词。" +
          "【gapItems】最多 3 条，排序 must_fix → nice → highlight。每条对象字段：" +
          "tier、insight（≤80字，面试官视角：为何缺会挂/为何有能加分，禁止「建议加强XX能力」式空话）、action（≤36字，可执行下一步）。" +
          "【hits】最多 6 个短标签（每个≤28字），必须是「画像中真实出现的项目/技能/公司名」与「JD 能力词」的交叉，如「UniPass×AI 产品」。" +
          "【analysisProcess】字符串≤300字：浓缩写出 JD 核心要求摘要、简历最强证据、面试官质疑点（供下游阶段使用，勿写 JSON 嵌套）。" +
          "【JD 未抓取正文时】matchScore≤55、applyAdvice 不得为 strong、oneLiner 须含「JD 未抓取」字样。" +
          "严禁编造画像里没有的项目、公司、数据。" +
          "【结构示例（勿照抄内容，只学结构与信息密度）】" +
          "输入画像 JSON 含 skills/strengths 与 UniPass、芒果 TV；JD 要求搜索策略、AB 实验、B 端增长。" +
          "输出示例：{\"matchScore\":68,\"applyAdvice\":\"try\",\"hardCount\":1," +
          "\"oneLiner\":\"【判断逻辑】画像在 UniPass 的 Query 意图与芒果 TV 用研上能对应搜索与实验，但 JD 要的 B 端增长闭环缺少直接叙事；【结论】建议投递，面试前把 C 端项目翻译成 B 端指标语言。\"" +
          ",\"gapItems\":[{\"tier\":\"must_fix\",\"insight\":\"JD 写清搜索策略，你 UniPass 实为 Query 理解，但简历未出现召回/排序词，面试官易判无搜索经验。\",\"action\":\"UniPass 段首补写「Query 意图、场景召回与排序」\"}," +
          "{\"tier\":\"nice\",\"insight\":\"AB 实验在 JD 为硬加分，你画像有实验思维但缺与搜索指标绑定的结果句。\",\"action\":\"为任一实验补 1 句核心指标变化\"}," +
          "{\"tier\":\"highlight\",\"insight\":\"用研方法论可对冲「只会做功能」质疑。\",\"action\":\"面试主动抛芒果 TV 用研案例\"}]," +
          "\"hits\":[\"UniPass×Query\",\"芒果 TV×用研\",\"AB 测试×指标\"]," +
          "\"analysisProcess\":\"JD三要：搜索策略、AB、B端增长。证据：UniPass意图、芒果用研、实验。质疑：B端叙事弱、搜索词未对齐。\"}";

        var sysPromptTail =
          "你是资深大厂产品经理 + 简历优化顾问。任务不是「与阶段一结果机械一致」，而是基于相同事实做深度翻译与面试弹药准备。" +
          "若阶段一对能力映射有偏差，你可在 resumeLines 的改写与 interviewAmmo 的 STAR 中做更精准的映射（隐性修正），并在 answerStar 叙事中自然体现，无需声明矛盾。" +
          "只输出严格合法 JSON，禁止 markdown、代码块、寒暄。【根字段仅允许】resumeLines、interviewAmmo。" +
          "【resumeLines】固定 2-3 条。每项含：original（严格来自画像原文，勿编造）、jdKw（JD 能力词 3-8 字顿号连接）、" +
          "suggested（可直接粘贴简历的一句）、matchLogic（≤40字，解释该改写为何能命中 JD）、nextAction（如「贴到 UniPass 项目段首」）。" +
          "【interviewAmmo】固定 3 条。每项含：question（压力型追问，带质疑口吻）、answerStar（STAR 四段各 1-2 句，总 120-280 字，嵌入画像真实项目名）、" +
          "pressureFollowUp（≤30字，面试官听完 STAR 后最可能的一个深挖点）。" +
          "用户消息将包含【简历与 JD 材料】、【第一期决策 JSON】及【阶段一 analysisProcess 摘要】。" +
          "优先依据 analysisProcess 理解「为什么阶段一这么判断」；若摘要为空或明显被截断，则仅依据简历与 JD 材料独立完成。" +
          "JD 未抓取时仍输出保守、可执行的改写与问答，禁止编造画像未出现的项目。";

        function strArr(x, maxLen, maxItems) {
          if (!Array.isArray(x)) return [];
          return x
            .map(function (s) { return String(s || "").trim(); })
            .filter(Boolean)
            .map(function (s) { return s.length > maxLen ? s.substring(0, maxLen) : s; })
            .slice(0, maxItems);
        }
        function clampStr(s, max) {
          s = String(s || "").trim();
          return s.length > max ? s.substring(0, max) : s;
        }

        function buildQuickPartialResult(parsed) {
          var tierOrder = { must_fix: 0, nice: 1, highlight: 2 };
          var jdIsEmpty = !jpJd;
          var gapItems = [];
          if (Array.isArray(parsed.gapItems)) {
            for (var gi = 0; gi < parsed.gapItems.length; gi++) {
              var g = parsed.gapItems[gi];
              if (!g || typeof g !== "object") continue;
              var tier = String(g.tier || "must_fix").trim().toLowerCase();
              if (tier !== "must_fix" && tier !== "nice" && tier !== "highlight") tier = "must_fix";
              var ins = clampStr(g.insight, 90);
              var act = clampStr(g.action, 42);
              var cp = clampStr(g.copy, 130);
              var na = clampStr(g.nextAction, 42);
              if (!ins && cp) ins = cp;
              if (!act && na) act = na;
              if (!ins) ins = cp || "（模型未返回洞察，请结合 JD 在「AI 修订简历」中细化）";
              if (!act) act = na || "打开「AI 修订简历」落实本条";
              gapItems.push({
                tier: tier,
                insight: ins,
                action: act,
                copy: ins,
                nextAction: act
              });
            }
            gapItems.sort(function (a, b) {
              return (tierOrder[a.tier] || 9) - (tierOrder[b.tier] || 9);
            });
            gapItems = gapItems.slice(0, 3);
          }
          var score = parseInt(parsed.matchScore, 10);
          if (isNaN(score)) {
            var olv = String(parsed.level || "").trim().toLowerCase();
            if (olv === "high") score = 76;
            else if (olv === "low") score = 38;
            else score = 56;
          } else {
            if (score < 0) score = 0;
            if (score > 100) score = 100;
          }
          var advice = String(parsed.applyAdvice || "").trim().toLowerCase();
          if (advice !== "strong" && advice !== "try" && advice !== "avoid") advice = "";
          var hardCt = parseInt(parsed.hardCount, 10);
          if (isNaN(hardCt) || hardCt < 0) hardCt = 0;
          if (hardCt > 5) hardCt = 5;

          if (!gapItems.length && (Array.isArray(parsed.gaps) || Array.isArray(parsed.hits))) {
            var legacyGaps = strArr(parsed.gaps, 80, 3);
            for (var lg = 0; lg < legacyGaps.length; lg++) {
              var leg = legacyGaps[lg];
              gapItems.push({
                tier: "must_fix",
                insight: leg,
                action: "打开「AI 修订简历」按条修改",
                copy: leg,
                nextAction: "打开「AI 修订简历」按条修改"
              });
            }
          }
          if (hardCt === 0 && gapItems.length) {
            var mf = 0;
            for (var hc = 0; hc < gapItems.length; hc++) {
              if (gapItems[hc].tier === "must_fix") mf++;
            }
            if (mf) hardCt = mf;
          }
          if (!advice) {
            if (score >= 75 && hardCt === 0) advice = "strong";
            else if (score >= 45) advice = "try";
            else advice = "avoid";
          }
          if (advice === "avoid" && hardCt < 2 && score >= 50) advice = "try";

          if (!gapItems.length) {
            gapItems.push({
              tier: "highlight",
              insight: "模型未返回分级缺口，请重新点开岗位触发分析，或直接使用「AI 修订简历」。",
              action: "点击「AI 修订简历到此岗位」",
              copy: "模型未返回分级缺口，请重新点开岗位触发分析，或直接使用「AI 修订简历」。",
              nextAction: "点击「AI 修订简历到此岗位」"
            });
          }
          var oneL = clampStr(parsed.oneLiner, 120);
          if (jdIsEmpty) {
            if (score > 55) score = 55;
            if (!/JD\s*未抓取/.test(oneL) && !/JD未抓取/.test(oneL)) {
              oneL = clampStr("JD 未抓取：" + (oneL || "仅依据卡片信息，结论偏保守。"), 120);
            }
          }
          if (advice === "strong" && (hardCt !== 0 || score < 75 || jdIsEmpty)) {
            advice = "try";
          }
          var lv =
            advice === "strong" ? "high" :
            advice === "avoid" ? "low" : "medium";

          var analysisProcess = clampStr(parsed.analysisProcess, 500);

          return {
            schemaVersion: 2,
            level: lv,
            matchScore: score,
            applyAdvice: advice,
            hardCount: hardCt,
            oneLiner: oneL,
            gapItems: gapItems,
            resumeLines: [],
            interviewAmmo: [],
            hits: strArr(parsed.hits, 28, 6),
            gaps: gapItems.map(function (it) {
              var act = it.action || it.nextAction;
              return (it.insight || it.copy) + (act ? " → " + act : "");
            }),
            talkingPoints: [],
            resumeTweaks: [],
            analysisProcess: analysisProcess,
            __pendingTail: true
          };
        }

        function extractTailArrays(parsed) {
          var resumeLines = [];
          if (Array.isArray(parsed.resumeLines)) {
            for (var ri = 0; ri < parsed.resumeLines.length; ri++) {
              var row = parsed.resumeLines[ri];
              if (!row || typeof row !== "object") continue;
              resumeLines.push({
                original: clampStr(row.original, 120),
                jdKw: clampStr(row.jdKw, 40),
                suggested: clampStr(row.suggested, 160),
                matchLogic: clampStr(row.matchLogic, 48),
                nextAction: clampStr(row.nextAction, 45)
              });
            }
            resumeLines = resumeLines.slice(0, 3);
          }
          var interviewAmmo = [];
          if (Array.isArray(parsed.interviewAmmo)) {
            for (var ii = 0; ii < parsed.interviewAmmo.length; ii++) {
              var am = parsed.interviewAmmo[ii];
              if (!am || typeof am !== "object") continue;
              interviewAmmo.push({
                question: clampStr(am.question, 120),
                answerStar: clampStr(am.answerStar, 400),
                pressureFollowUp: clampStr(am.pressureFollowUp, 36)
              });
            }
            interviewAmmo = interviewAmmo.slice(0, 3);
          }
          if (!resumeLines.length && Array.isArray(parsed.resumeTweaks)) {
            var tweaks = strArr(parsed.resumeTweaks, 80, 3);
            var hits0 = strArr(parsed.hits, 60, 1)[0] || "岗位相关能力";
            for (var ti = 0; ti < tweaks.length; ti++) {
              resumeLines.push({
                original: hits0,
                jdKw: "岗位匹配",
                suggested: tweaks[ti],
                matchLogic: "",
                nextAction: "粘贴到简历对应段落"
              });
            }
          }
          if (!interviewAmmo.length && Array.isArray(parsed.talkingPoints)) {
            var talks = strArr(parsed.talkingPoints, 120, 3);
            for (var tj = 0; tj < talks.length; tj++) {
              interviewAmmo.push({
                question: "请结合你的经历，谈谈你如何胜任该岗位？（追问 " + (tj + 1) + "）",
                answerStar: talks[tj],
                pressureFollowUp: ""
              });
            }
          }
          return { resumeLines: resumeLines, interviewAmmo: interviewAmmo };
        }

        function finalizeTailFields(qr, p1oneLiner) {
          if (!qr.resumeLines.length) {
            qr.resumeLines.push({
              original: "（请对照简历画像中的项目原文）",
              jdKw: "岗位关键词",
              suggested:
                clampStr(p1oneLiner, 100) ||
                "请结合 JD 在简历中用「动词+对象+结果」重写项目 bullet。",
              matchLogic: "",
              nextAction: "在简历项目下增加一条可量化成果"
            });
          }
          while (qr.interviewAmmo.length < 3) {
            qr.interviewAmmo.push({
              question: "补充面试问答（模型输出不足）",
              answerStar:
                "请用 STAR 自行准备：Situation 公司/业务背景；Task 你的职责；Action 你用的方法与协作；Result 可量化结果。绑定简历中真实项目名。",
              pressureFollowUp: ""
            });
          }
          delete qr.__pendingTail;
          qr.gaps = qr.gapItems.map(function (it) {
            var act = it.action || it.nextAction;
            return (it.insight || it.copy) + (act ? " → " + act : "");
          });
          qr.talkingPoints = qr.interviewAmmo.map(function (x) {
            return x.question + "：" + (x.answerStar || "").substring(0, 80);
          });
          qr.resumeTweaks = qr.resumeLines.map(function (r) {
            return r.suggested;
          });
        }

        function callPerspQuick(useJsonMode) {
          return deepSeekCompletion(
            auth.apiKey,
            auth.model,
            [
              { role: "system", content: sysPromptQuick },
              { role: "user", content: userPromptBase }
            ],
            1400,
            { jsonMode: useJsonMode }
          );
        }
        function callPerspTail(coreSnap, stageOneAnalysis, useJsonMode) {
          var sa = clampStr(String(stageOneAnalysis || ""), 500);
          var userTail =
            userPromptBase +
            "\n\n【第一期决策 JSON（数值与 gap 结果，供对齐）】\n" +
            coreSnap +
            "\n\n【阶段一 analysisProcess（理解「为什么」；若为空请仅依据简历与 JD）】\n" +
            (sa || "（空）");
          return deepSeekCompletion(
            auth.apiKey,
            auth.model,
            [
              { role: "system", content: sysPromptTail },
              { role: "user", content: userTail }
            ],
            2000,
            { jsonMode: useJsonMode }
          );
        }

        var quickResult = null;
        callPerspQuick(true)
          .catch(function (err) {
            if (err && err.isEmptyContent) {
              console.warn("[Background] AI_JD_PERSPECTIVE phase1 empty, retry without json_object");
              return callPerspQuick(false);
            }
            throw err;
          })
          .then(function (raw1) {
            var p1 = parseModelJson(raw1);
            quickResult = buildQuickPartialResult(p1);
            try {
              chrome.runtime.sendMessage(
                {
                  action: "JOBFLOW_PERSPECTIVE_PARTIAL",
                  cacheKey: jpCacheKey,
                  card: jpCard,
                  result: quickResult
                },
                function () {
                  void chrome.runtime.lastError;
                }
              );
            } catch (ePush) {
              console.warn("[Background] JOBFLOW_PERSPECTIVE_PARTIAL push:", ePush);
            }
            var coreSnap = JSON.stringify({
              matchScore: quickResult.matchScore,
              applyAdvice: quickResult.applyAdvice,
              hardCount: quickResult.hardCount,
              oneLiner: quickResult.oneLiner,
              gapItems: quickResult.gapItems
            });
            if (coreSnap.length > 4200) {
              coreSnap = coreSnap.substring(0, 4200);
            }
            var stageSnap = quickResult.analysisProcess || "";
            return callPerspTail(coreSnap, stageSnap, true).catch(function (err2) {
              if (err2 && err2.isEmptyContent) {
                console.warn("[Background] AI_JD_PERSPECTIVE phase2 empty, retry without json_object");
                return callPerspTail(coreSnap, stageSnap, false);
              }
              throw err2;
            });
          })
          .then(function (raw2) {
            if (!quickResult) {
              throw new Error("透视阶段状态异常");
            }
            var p2 = parseModelJson(raw2);
            var tail = extractTailArrays(p2);
            quickResult.resumeLines = tail.resumeLines;
            quickResult.interviewAmmo = tail.interviewAmmo;
            finalizeTailFields(quickResult, quickResult.oneLiner);
            sendResponse({ ok: true, result: quickResult });
          })
          .catch(function (err) {
            console.error("[Background] AI_JD_PERSPECTIVE:", err);
            if (quickResult) {
              finalizeTailFields(quickResult, quickResult.oneLiner);
              sendResponse({ ok: true, result: quickResult });
            } else {
              sendResponse({ ok: false, error: err.message || String(err) });
            }
          });
      }
    );
    return true;
  }

  // ========== AI_RESUME_DIFF：锚定式简历改写建议 ==========
  if (message.action === "AI_RESUME_DIFF") {
    var rdResume = String(message.resume || "").trim();
    var rdJd = String(message.jd || "").trim().substring(0, 1200);
    var rdGaps = Array.isArray(message.gaps) ? message.gaps.slice(0, 5) : [];
    var rdCard = message.card || {};
    if (!rdResume) {
      sendResponse({ ok: false, error: "缺少简历原文" });
      return true;
    }
    if (rdResume.length < 60) {
      sendResponse({ ok: false, error: "简历原文太短，无法进行有效适配" });
      return true;
    }
    chrome.storage.local.get(
      ["deepseekApiKey", "deepseekModel"],
      function (store) {
        var rdAuth = getDeepSeekAuth(store);
        if (!rdAuth.apiKey) {
          sendResponse({
          ok: false,
          error:
            "未配置 DeepSeek API Key。侧栏填写、secrets.js 或 jobflow-default-api.js（内置体验 Key）。"
        });
          return;
        }
        // 与发给模型的正文必须一致，否则 anchor 校验会错位；压缩长度避免占满上下文导致输出为空
        var RD_RESUME_MAX = 2000;
        var rdResumeForModel =
          rdResume.length <= RD_RESUME_MAX
            ? rdResume
            : rdResume.substring(0, RD_RESUME_MAX);
        var gapLines = rdGaps.map(function (g) {
          var s = String(g || "").trim();
          return s.length > 90 ? s.substring(0, 90) + "…" : s;
        });
        var jdHint = rdJd
          ? "JD 正文（最多 1200 字）：\n" + rdJd
          : "（未拿到 JD 正文，请仅依据下方岗位标题/公司与 gaps 做保守、克制的修改建议）";
        var gapBlock = gapLines.length
          ? "AI 已发现的 gaps：\n- " + gapLines.join("\n- ")
          : "（暂无 gap 信息）";
        var cardBlock =
          "职位标题：" + (rdCard.title || "") +
          "\n公司：" + (rdCard.company || "") +
          "\n薪资：" + (rdCard.salary || "") +
          "\n地点：" + (rdCard.location || "");

        var rdSys =
          "你是严谨的简历顾问。给定【简历原文】与【目标 JD】，输出针对该 JD 的精准修改建议。" +
          "只输出严格合法 JSON 对象，禁止 markdown / 解释 / 寒暄。" +
          "JSON 字段：" +
          "{\"edits\":[" +
          "{\"anchor\":\"简历原文中【逐字存在】的一段，作为定位用，6-40 字\"," +
          "\"before\":\"要被替换掉的原文文本，必须是 anchor 的子串或与 anchor 完全一致\"," +
          "\"after\":\"建议改写后的文本，可适度扩写，但≤before长度的2.5倍且≤80字\"," +
          "\"reason\":\"≤30字的简短理由，说明为什么这样改更贴 JD\"}]," +
          "\"floatingTips\":[\"无法精准锚定到原文的补充建议，每条≤40字\"]}" +
          "硬性约束：" +
          "(A) anchor 与 before 必须严格来自【简历原文】，禁止伪造；如果某条建议无法在原文找到对应锚点，请放入 floatingTips，不要进 edits；" +
          "(B) edits 最多 5 条，floatingTips 最多 4 条，总输出务必简短；" +
          "(C) 严禁编造经历/项目/数字；只能基于原文措辞润色、扩写、对齐 JD 关键词；" +
          "(D) 不要修改个人信息、联系方式、教育时间；" +
          "(E) anchor / before 必须保留原文的标点和空白，便于前端做字符串查找。";

        var rdUser =
          "【简历原文】\n" + rdResumeForModel +
          "\n\n【岗位卡片元信息】\n" + cardBlock +
          "\n\n【" + jdHint + "】" +
          "\n\n【" + gapBlock + "】";

        function callRdAI(useJsonMode, maxTok) {
          return deepSeekCompletion(
            rdAuth.apiKey,
            rdAuth.model,
            [
              { role: "system", content: rdSys },
              { role: "user", content: rdUser }
            ],
            maxTok || 4096,
            { jsonMode: useJsonMode }
          );
        }
        callRdAI(true, 4096)
          .catch(function (err) {
            if (err && err.isEmptyContent) {
              console.warn("[Background] AI_RESUME_DIFF empty, retry no json_object @4096");
              return callRdAI(false, 4096);
            }
            throw err;
          })
          .catch(function (err2) {
            if (err2 && err2.isEmptyContent && err2.isLengthEmpty) {
              console.warn("[Background] AI_RESUME_DIFF still empty @length, retry json @8192");
              return callRdAI(true, 8192);
            }
            throw err2;
          })
          .catch(function (err3) {
            if (err3 && err3.isEmptyContent) {
              console.warn("[Background] AI_RESUME_DIFF last resort: no json @8192");
              return callRdAI(false, 8192);
            }
            throw err3;
          })
          .then(function (raw) {
            var parsed = parseModelJson(raw);
            var rawEdits = Array.isArray(parsed.edits) ? parsed.edits : [];
            var tips = Array.isArray(parsed.floatingTips) ? parsed.floatingTips : [];

            var verified = [];
            var rejected = [];
            for (var i = 0; i < rawEdits.length; i++) {
              var ed = rawEdits[i] || {};
              var anchor = String(ed.anchor || "").trim();
              var before = String(ed.before || "").trim();
              var after = String(ed.after || "").trim();
              var reason = String(ed.reason || "").trim().substring(0, 40);
              if (!anchor || !before || !after) continue;
              // 锚点必须在发给模型的同一段原文中能找到（与侧栏 PDF/文本锚定一致）
              if (rdResumeForModel.indexOf(anchor) === -1) {
                rejected.push(anchor + " → " + after);
                continue;
              }
              // before 必须是 anchor 的子串或与 anchor 一致
              if (anchor.indexOf(before) === -1 && before !== anchor) {
                rejected.push(anchor + " → " + after);
                continue;
              }
              // 长度合理性
              if (after.length > Math.max(80, before.length * 3)) {
                after = after.substring(0, Math.max(80, before.length * 3));
              }
              verified.push({
                id: "ed" + i + "_" + Math.abs((anchor + before).length),
                anchor: anchor,
                before: before,
                after: after,
                reason: reason
              });
              if (verified.length >= 8) break;
            }

            // 被拒的锚点合并进 floatingTips（轻量保留信息）
            var floats = tips
              .map(function (s) { return String(s || "").trim(); })
              .filter(Boolean)
              .map(function (s) { return s.length > 50 ? s.substring(0, 50) : s; })
              .slice(0, 6);
            for (var k = 0; k < rejected.length && floats.length < 8; k++) {
              floats.push(rejected[k]);
            }

            sendResponse({
              ok: true,
              result: {
                edits: verified,
                floatingTips: floats
              }
            });
          })
          .catch(function (err) {
            console.error("[Background] AI_RESUME_DIFF:", err);
            sendResponse({ ok: false, error: err.message || String(err) });
          });
      }
    );
    return true;
  }

  // ========== AI 分析代理（keep channel open with sendResponse） ==========
  if (message.action === "AI_ANALYZE") {
    var jdText = (message.text || "").substring(0, 3000);
    console.log("[Background] AI_ANALYZE start, JD len:", jdText.length);

    chrome.storage.local.get(
      ["deepseekApiKey", "deepseekModel", JOBFLOW_RESUME_PROFILE_KEY],
      function (store) {
      var auth = getDeepSeekAuth(store);
      if (!auth.apiKey) {
        sendResponse({
          ok: false,
          error:
            "未配置 DeepSeek API Key。任选：① 侧栏「API」；② secrets.js；③ jobflow-default-api.js。申请：platform.deepseek.com/api_keys"
        });
        return;
      }

      var brief = resumeProfileBriefJson(store[JOBFLOW_RESUME_PROFILE_KEY]);

      deepSeekCompletion(
        auth.apiKey,
        auth.model,
        [
          {
            role: "system",
            content:
              "你是冷酷理性的资深HR专家。只输出纯JSON，不要markdown。字段：matchLevel(1-3数字)、coreAdvantage(不超过45字)、risk(不超过15字)。必须结合简历画像与JD：coreAdvantage 要引用简历画像中的具体点（可括号标注「核心技能」「经验亮点」等）并对应 JD 要求；勿编造简历未出现的内容。"
          },
          {
            role: "user",
            content:
              "简历画像(JSON)：" +
              brief +
              "\n\nJD全文：\n" +
              jdText
          }
        ],
        700,
        { jsonMode: true }
      )
        .then(function (raw) {
          console.log("[Background] Raw:", raw);
          var parsed = parseModelJson(raw);
          parsed._jdText = jdText;
          sendResponse({ ok: true, result: parsed });
        })
        .catch(function (err) {
          console.error("[Background] AI fail:", err.message || err);
          sendResponse({ ok: false, error: err.message || String(err) });
        });
    });

    return true;
  }
});
