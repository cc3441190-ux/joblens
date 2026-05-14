console.log("AI 求职工作流 Side Panel 已加载");
console.log("[jobflow] env check", {
  pdfjs: typeof pdfjsLib !== "undefined" ? (pdfjsLib && pdfjsLib.version) || "loaded" : "MISSING",
  tesseract: typeof Tesseract !== "undefined" ? "loaded" : "MISSING"
});
window.addEventListener("unhandledrejection", function (e) {
  console.error("[jobflow] unhandledrejection", e && e.reason);
});
window.addEventListener("error", function (e) {
  console.error("[jobflow] window error", e && (e.error || e.message));
});

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

/** 与 content.js simpleHash 一致，用于增量套壳 id 对齐 */
function jobflowCardIdHash(str) {
  var hash = 0;
  var s = String(str || "");
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    hash = ((hash << 5) - hash) + c;
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

/**
 * Content script 可能未注入（刚装扩展、未刷新页等）。先 sendMessage，失败则注入 content.js 再试一次。
 */
function tabsSendToContent(tabId, message, callback) {
  function trySend(injected) {
    chrome.tabs.sendMessage(tabId, message, function (res) {
      var err = chrome.runtime.lastError;
      if (err) {
        if (injected) {
          if (callback) callback(null, err.message || String(err));
          return;
        }
        chrome.scripting.executeScript(
          { target: { tabId: tabId }, files: ["content.js"] },
          function () {
            var injErr = chrome.runtime.lastError;
            if (injErr) {
              if (callback) callback(null, injErr.message || String(injErr));
              return;
            }
            setTimeout(function () {
              trySend(true);
            }, 150);
          }
        );
        return;
      }
      if (callback) callback(res, null);
    });
  }
  trySend(false);
}

// ========== 状态机 ==========
// states: onboarding | resume_upload | browsing | perspective | adapt

var JOBFLOW_RESUME_PROFILE_KEY = "jobflow_resume_profile";
var JOBFLOW_RESUME_TEXT_KEY = "jobflow_resume_text";
var JOBFLOW_RESUME_PDF_B64_KEY = "jobflow_resume_pdf_b64";
var JOBFLOW_RESUME_PDF_META_KEY = "jobflow_resume_pdf_meta";  // { name, size, mtime }
var JOBFLOW_RESUME_PDF_MAX_BYTES = 4 * 1024 * 1024;  // 4MB；超过此值不存（chrome.storage.local 单 key 上限 ≈5MB）

var resumeProfile = null;
var resumeRawText = "";
var resumePdfMeta = null;  // { name, size, mtime } 只是是否存在 PDF 的标记，不放真正的 base64

function hydrateResumeFromStorage(callback) {
  chrome.storage.local.get(
    [JOBFLOW_RESUME_PROFILE_KEY, JOBFLOW_RESUME_TEXT_KEY, JOBFLOW_RESUME_PDF_META_KEY],
    function (d) {
      resumeProfile = d[JOBFLOW_RESUME_PROFILE_KEY] || null;
      resumeRawText = (d[JOBFLOW_RESUME_TEXT_KEY] || "").trim();
      resumePdfMeta = d[JOBFLOW_RESUME_PDF_META_KEY] || null;
      if (callback) callback();
    }
  );
}

// 工具：ArrayBuffer ↔ base64（用 FileReader 走 dataURL 路线，对大文件比 String.fromCharCode 稳）
function arrayBufferToBase64(buf) {
  return new Promise(function (resolve, reject) {
    try {
      var blob = new Blob([buf], { type: "application/pdf" });
      var reader = new FileReader();
      reader.onload = function () {
        var s = String(reader.result || "");
        var idx = s.indexOf(",");
        resolve(idx === -1 ? s : s.substring(idx + 1));
      };
      reader.onerror = function () { reject(new Error("base64 编码失败")); };
      reader.readAsDataURL(blob);
    } catch (e) { reject(e); }
  });
}

function base64ToArrayBuffer(b64) {
  var bin = atob(b64 || "");
  var len = bin.length;
  var bytes = new Uint8Array(len);
  for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function storeResumePdf(file, arrayBuf) {
  // arrayBuf 可空（让函数自己读）；超大就不存，仅给提示
  if (file.size > JOBFLOW_RESUME_PDF_MAX_BYTES) {
    return Promise.resolve({
      stored: false,
      reason: "原 PDF 文件大于 4MB（" +
        (file.size / 1024 / 1024).toFixed(2) +
        "MB），暂不保留原稿。批注模式将回退到纯文本视图。"
    });
  }
  var p = arrayBuf ? Promise.resolve(arrayBuf) : new Promise(function (resolve, reject) {
    var r = new FileReader();
    r.onload = function () { resolve(r.result); };
    r.onerror = function () { reject(new Error("文件读取失败")); };
    r.readAsArrayBuffer(file);
  });
  return p.then(arrayBufferToBase64).then(function (b64) {
    return new Promise(function (resolve, reject) {
      var bag = {};
      bag[JOBFLOW_RESUME_PDF_B64_KEY] = b64;
      bag[JOBFLOW_RESUME_PDF_META_KEY] = {
        name: file.name,
        size: file.size,
        mtime: Date.now()
      };
      chrome.storage.local.set(bag, function () {
        var err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message || String(err)));
        } else {
          resumePdfMeta = bag[JOBFLOW_RESUME_PDF_META_KEY];
          resolve({ stored: true });
        }
      });
    });
  });
}

function loadStoredResumePdfBuffer() {
  return new Promise(function (resolve) {
    chrome.storage.local.get([JOBFLOW_RESUME_PDF_B64_KEY], function (d) {
      var b64 = d[JOBFLOW_RESUME_PDF_B64_KEY];
      if (!b64) { resolve(null); return; }
      try { resolve(base64ToArrayBuffer(b64)); }
      catch (e) { console.warn("[jobflow] base64 decode failed", e); resolve(null); }
    });
  });
}

function clearStoredResumePdf() {
  chrome.storage.local.remove([JOBFLOW_RESUME_PDF_B64_KEY, JOBFLOW_RESUME_PDF_META_KEY], function () {
    resumePdfMeta = null;
  });
}

function hasStoredResumeProfile(p) {
  if (!p || typeof p !== "object") return false;
  return (
    (Array.isArray(p.skills) && p.skills.length > 0) ||
    (Array.isArray(p.strengths) && p.strengths.length > 0)
  );
}

function profileSummaryLine(p) {
  if (!p) return "你的画像：尚未分析";
  var bits = []
    .concat((p.strengths || []).slice(0, 2))
    .concat((p.skills || []).slice(0, 2));
  bits = bits
    .map(function (x) {
      return String(x || "").trim();
    })
    .filter(Boolean);
  var s = bits.slice(0, 3).join(" · ");
  return s ? "你的画像：" + s : "你的画像：已保存（展开查看）";
}

function refreshBrowseProfileUI() {
  var sumEl = document.getElementById("browse-profile-summary-text");
  var detEl = document.getElementById("browse-profile-detail");
  if (!sumEl || !detEl) return;
  if (!resumeProfile) {
    sumEl.textContent = "你的画像：尚未分析";
    detEl.textContent = "请先在「简历上传」步骤完成分析。";
    renderRoleRadar();
    return;
  }
  sumEl.textContent = profileSummaryLine(resumeProfile);
  var p = resumeProfile;
  var html = "";
  if (p.fullAnalysis) {
    html += "<p class=\"mb-2\">" + escapeHtml(p.fullAnalysis.substring(0, 220)) + (p.fullAnalysis.length > 220 ? "…" : "") + "</p>";
  }
  if ((p.skills || []).length) {
    html += "<p style=\"color:var(--text4);margin-bottom:4px;\">技能</p><div class=\"tags mb-2\">";
    for (var i = 0; i < Math.min(p.skills.length, 8); i++) {
      html += '<span class="tag tag-positive">' + escapeHtml(p.skills[i]) + "</span>";
    }
    html += "</div>";
  }
  detEl.innerHTML = html || "（无摘要）";
  renderRoleRadar();
}

function renderRoleRadar() {
  var card = document.getElementById("role-radar-card");
  if (!card) return;
  var roles = (resumeProfile && resumeProfile.suggestedRoles) || [];
  if (!roles.length) {
    card.style.display = "none";
    return;
  }
  card.style.display = "block";
  var chipsBox = document.getElementById("role-radar-chips");
  chipsBox.innerHTML = "";
  var hintEl = document.getElementById("role-radar-copy-hint");
  for (var i = 0; i < roles.length; i++) {
    var role = String(roles[i] || "").replace(/^[·•\s]+/, "").trim();
    if (!role) continue;
    var chip = document.createElement("button");
    chip.type = "button";
    chip.className = "role-radar-chip";
    chip.setAttribute("data-role", role);
    chip.textContent = role;
    chip.addEventListener("click", function () {
      var r = this.getAttribute("data-role") || "";
      if (!r) return;
      var self = this;
      var doneCopy = function () {
        var prev = self.textContent;
        self.classList.add("role-radar-chip-copied");
        self.textContent = "✓ 已复制 " + r;
        if (hintEl) {
          hintEl.style.display = "block";
          hintEl.textContent = "已复制「" + r + "」，去 Boss 搜索框 Ctrl+V 粘贴即可。";
        }
        setTimeout(function () {
          self.classList.remove("role-radar-chip-copied");
          self.textContent = prev;
        }, 1600);
      };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(r).then(doneCopy, function () {
            fallbackCopy(r);
            doneCopy();
          });
        } else {
          fallbackCopy(r);
          doneCopy();
        }
      } catch (e) {
        fallbackCopy(r);
        doneCopy();
      }
    });
    chipsBox.appendChild(chip);
  }
}

function fallbackCopy(text) {
  try {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  } catch (e) {
    console.warn("fallback copy failed", e);
  }
}

function renderResumeProfileResult(p) {
  var wrap = document.getElementById("resume-profile-result");
  if (!wrap || !p) return;
  wrap.style.display = "block";
  var skillsEl = document.getElementById("resume-skills-tags");
  var sh = "";
  for (var s = 0; s < (p.skills || []).length; s++) {
    sh += '<span class="tag tag-positive">' + escapeHtml(p.skills[s]) + "</span>";
  }
  skillsEl.innerHTML = sh || '<span style="font-size:11px;color:var(--text4);">—</span>';

  function fillList(id, arr) {
    var el = document.getElementById(id);
    if (!el) return;
    var h = "";
    for (var j = 0; j < (arr || []).length; j++) {
      h += "<li>" + escapeHtml(arr[j]) + "</li>";
    }
    el.innerHTML = h || "<li style=\"color:var(--text4);\">—</li>";
  }
  fillList("resume-strengths-list", p.strengths);
  fillList("resume-highlights-list", p.highlights);
  fillList("resume-gaps-list", p.gaps);

  var rolesEl = document.getElementById("resume-suggested-roles");
  rolesEl.innerHTML = "";
  for (var r = 0; r < (p.suggestedRoles || []).length; r++) {
    var line = document.createElement("div");
    line.className = "suggest-role-line";
    line.textContent = "· " + p.suggestedRoles[r];
    rolesEl.appendChild(line);
  }
}

var currentState = "onboarding";
var jdData = null;
var perspectiveQuota = 20;
var adaptQuota = 3;

/** true = 不扣透视/适配次数、不拦截「额度用完」。测试阶段保持 true；商业化计费时改为 false。 */
var JOBFLOW_QUOTA_DISABLED = true;

function saveQuota() {
  chrome.storage.local.set({ perspectiveQuota: perspectiveQuota, adaptQuota: adaptQuota });
}

function updateQuotaBar() {
  var el = document.getElementById("quota-bar");
  if (!el) return;
  if (JOBFLOW_QUOTA_DISABLED) {
    el.textContent = "测试模式：透视与适配暂不扣次（上线计费前将 JOBFLOW_QUOTA_DISABLED 改为 false）";
    return;
  }
  el.textContent = "今日剩余透视：" + perspectiveQuota + " 次 | 适配：" + adaptQuota + " 次";
}

function switchState(newState) {
  if (currentState === newState) return;
  currentState = newState;

  var ids = [
    "state-onboarding",
    "state-resume_upload",
    "state-browsing",
    "state-perspective",
    "state-adapt"
  ];
  for (var i = 0; i < ids.length; i++) {
    var el = document.getElementById(ids[i]);
    if (el) el.style.display = "none";
  }

  var target = document.getElementById("state-" + newState);
  if (!target) return;

  target.style.display = "block";
  target.style.opacity = "0";
  target.style.transition = "opacity 150ms";
  requestAnimationFrame(function () {
    target.style.opacity = "1";
  });
}

// ========== Mock 数据 ==========

var MOCK_REASONS = [
  "你的 AIGC 项目经验与该岗位「参与 AI 产品生产」要求高度相关",
  "你的用户研究背景与该岗位「把控用户体验」职责匹配",
  "你的校园项目经历覆盖了该岗位「跨团队协作」的核心要求",
  "你的 AI 工具使用经验与该岗位「提升研发效率」目标一致"
];

var MOCK_RISK_SPECIFIC = [
  "岗位要求5天/周，需确认你的时间安排",
  "JD强调懂营销，你的简历缺少相关经验",
  "岗位需要熟悉SQL，建议提前准备",
  "该职位期望立即到岗，请确认你的入职时间"
];

function extractJDInfo(text) {
  var title = "AI 产品实习生";
  var company = "某科技公司";
  var salary = "8K-12K";

  var tm = text.match(/(?:职位|岗位|Title)[：:\s]*([^\n]{4,30})/i);
  if (tm) title = tm[1].trim();

  var cm = text.match(/(?:公司)[：:\s]*([^\n]{2,20})/i);
  if (cm) company = cm[1].trim();

  var sm = text.match(/(\d+[kK]\s*-\s*\d+[kK]|\d+[kK]以上)/);
  if (sm) salary = sm[0];

  var keywords = [];
  var kws = text.match(/(?:AI|AIGC|大模型|Python|SQL|Java|React|Vue|数据分析|用户研究|产品设计|Prompt|用户增长|项目管理|协作|营销|运营)/gi);
  if (kws) {
    var seen = {};
    for (var k = 0; k < kws.length; k++) {
      var kw = kws[k];
      if (!seen[kw]) { seen[kw] = true; keywords.push(kw); }
    }
  }

  return { title: title, company: company, salary: salary, keywords: keywords.slice(0, 8) };
}

function buildPerspective(info) {
  var allKw = info.keywords;
  var haveSkills = allKw.slice(0, Math.min(2, allKw.length));
  if (haveSkills.length === 0) haveSkills = ["Prompt", "用户调研"];
  var missSkills = allKw.slice(2, Math.min(4, allKw.length));
  if (missSkills.length === 0) missSkills = ["SQL", "数据分析"];

  var coreTags = allKw.slice(0, Math.min(4, allKw.length));
  if (coreTags.length === 0) coreTags = ["AI工具优先", "有转正", "用户增长", "回复快"];

  var riskTags = [
    MOCK_RISK_SPECIFIC[Math.floor(Math.random() * MOCK_RISK_SPECIFIC.length)],
    "需确认到岗时间"
  ];

  return {
    title: info.title,
    company: info.company,
    salary: info.salary,
    stars: "★★★",
    matchReason: MOCK_REASONS[Math.floor(Math.random() * MOCK_REASONS.length)],
    coreTags: coreTags,
    riskTags: riskTags,
    haveSkills: haveSkills,
    missSkills: missSkills,
    gapAdvice: "建议简历中补充 " + missSkills.join("、") + " 相关经验描述",
    keywords: allKw
  };
}

function renderPerspective(data) {
  document.getElementById("jd-title").textContent = data.title;
  document.getElementById("jd-meta").textContent = data.company + "  |  " + data.salary;
  document.getElementById("jd-stars").innerHTML =
    '<span class="stars">' + data.stars + ' 高匹配</span>';

  document.getElementById("match-reason").textContent = data.matchReason;

  var tagsHtml = "";
  for (var i = 0; i < data.coreTags.length; i++) {
    tagsHtml += '<span class="tag tag-positive">' + data.coreTags[i] + '</span>';
  }
  for (var j = 0; j < data.riskTags.length; j++) {
    tagsHtml += '<span class="tag tag-risk">' + data.riskTags[j] + '</span>';
  }
  document.getElementById("match-tags").innerHTML = tagsHtml;

  var haveHtml = "";
  for (var k = 0; k < data.haveSkills.length; k++) {
    haveHtml += '<span class="tag tag-positive">' + data.haveSkills[k] + '</span>';
  }
  document.getElementById("have-skills").innerHTML = haveHtml;

  var missHtml = "";
  for (var m = 0; m < data.missSkills.length; m++) {
    missHtml += '<span class="tag tag-neutral">' + data.missSkills[m] + '</span>';
  }
  document.getElementById("miss-skills").innerHTML = missHtml;
  document.getElementById("gap-advice").textContent = data.gapAdvice;
}

// ========== JD 接收 → perspective ==========

function onJDReceived(text) {
  console.log("[SidePanel] onJDReceived 调用, currentState=" + currentState + ", 文本长度=" + (text ? text.length : 0));

  if (!hasStoredResumeProfile(resumeProfile)) {
    alert("请先在侧栏完成「简历上传与 AI 分析」，并点击「确认并开始求职」。");
    switchState("resume_upload");
    return;
  }

  if (!JOBFLOW_QUOTA_DISABLED) {
    if (perspectiveQuota <= 0) {
      alert("透视额度已用完");
      return;
    }
    perspectiveQuota--;
    saveQuota();
  }
  updateQuotaBar();

  switchState("perspective");

  document.getElementById("skeleton-loading").style.display = "block";
  document.getElementById("jd-header").style.display = "none";
  document.getElementById("match-card").style.display = "none";
  document.getElementById("gap-card").style.display = "none";

  callAIJD(text);
}

function callAIJD(jdText) {
  chrome.runtime.sendMessage({ action: "AI_ANALYZE", text: jdText }, function (resp) {
    if (!resp) {
      showAIError("Background 无响应");
      return;
    }
    if (!resp.ok) {
      showAIError(resp.error);
      return;
    }
    renderAIResult(resp.result);
  });
}

function showAIError(errMsg) {
  console.error("[SidePanel] AI 调用失败:", errMsg);
  document.getElementById("skeleton-loading").style.display = "none";
  document.getElementById("jd-header").style.display = "block";
  document.getElementById("match-card").style.display = "block";
  document.getElementById("gap-card").style.display = "none";
  document.getElementById("jd-title").textContent = "AI 解析遇到了一点小麻烦";
  document.getElementById("jd-meta").textContent = "";
  document.getElementById("jd-stars").innerHTML = "";
  document.getElementById("match-reason").textContent = errMsg || "未知错误";
  document.getElementById("match-tags").innerHTML = '<span class="tag tag-risk">请求失败</span>';
}

function renderAIResult(parsed) {
  var stars = "";
  if (parsed.matchLevel >= 3) stars = "★★★";
  else if (parsed.matchLevel === 2) stars = "★★☆";
  else stars = "★☆☆";

  document.getElementById("skeleton-loading").style.display = "none";
  document.getElementById("jd-header").style.display = "block";
  document.getElementById("match-card").style.display = "block";
  document.getElementById("gap-card").style.display = "block";

  var info = extractJDInfo(parsed._jdText || "");
  var data = buildPerspective(info);
  data.stars = stars;
  data.matchReason = parsed.coreAdvantage;
  data.coreTags = [parsed.coreAdvantage];
  data.riskTags = [parsed.risk];
  data.rawText = parsed._jdText || "";
  jdData = data;
  renderPerspective(data);
}

// (AI_RESULT/AI_ERROR onMessage handlers kept for backward compat)


// ========== 通信监听 ==========

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  // 只打印我们能处理的消息
  var act = message.action || message.type;
  if (act) {
    console.log("[SidePanel] onMessage action=" + act, "keys=" + Object.keys(message).join(","));
  }

  // ===== Legacy 旧版 perspective 消息：仅在用户尚未进入 browsing 流程时兼容 =====
  // 进入 browsing 后，所有岗位透视一律走 JOBFLOW_ACTIVE_JD（卡片点击）。
  var inBrowsing = currentState === "browsing";

  if (message.action === "PUSH_JD") {
    if (inBrowsing) {
      console.log("[SidePanel] ignore legacy PUSH_JD in browsing state");
    } else {
      console.log("[SidePanel] ✅ PUSH_JD 收到（legacy）→ onJDReceived");
      onJDReceived(message.text);
    }
  }
  if (message.action === "PUSH_JD_ERROR") {
    if (!inBrowsing) alert("抓取失败: " + message.error);
  }

  if (message.action === "AI_RESULT") {
    if (inBrowsing) {
      console.log("[SidePanel] ignore legacy AI_RESULT in browsing state");
    } else {
      var parsed = message.result;
      var stars = "";
      if (parsed.matchLevel >= 3) stars = "★★★";
      else if (parsed.matchLevel === 2) stars = "★★☆";
      else stars = "★☆☆";

      document.getElementById("skeleton-loading").style.display = "none";
      document.getElementById("jd-header").style.display = "block";
      document.getElementById("match-card").style.display = "block";
      document.getElementById("gap-card").style.display = "block";

      var info = extractJDInfo(parsed._jdText || "");
      var data = buildPerspective(info);
      data.stars = stars;
      data.matchReason = parsed.coreAdvantage;
      data.coreTags = [parsed.coreAdvantage];
      data.riskTags = [parsed.risk];
      data.rawText = parsed._jdText || "";
      jdData = data;
      renderPerspective(data);
    }
  }

  if (message.action === "AI_ERROR") {
    if (inBrowsing) {
      console.log("[SidePanel] ignore legacy AI_ERROR in browsing state");
    } else {
      console.error("[SidePanel] AI_ERROR:", message.error);
      document.getElementById("skeleton-loading").style.display = "none";
      document.getElementById("jd-header").style.display = "block";
      document.getElementById("match-card").style.display = "block";
      document.getElementById("gap-card").style.display = "none";

      document.getElementById("jd-title").textContent = "AI 解析遇到了一点小麻烦";
      document.getElementById("jd-meta").textContent = "";
      document.getElementById("jd-stars").innerHTML = "";
      document.getElementById("match-reason").textContent = message.error;
      document.getElementById("match-tags").innerHTML =
        '<span class="tag tag-risk">' + (message.error || "").substring(0, 30) + '</span>';
    }
  }
  if (message.action === "JD_EXTRACTED") {
    if (!inBrowsing) {
      console.log("[SidePanel] ✅ JD_EXTRACTED 直收（legacy）→ onJDReceived");
      onJDReceived(message.text);
    }
  }
  if (message.action === "UPDATE_JD") {
    if (!inBrowsing) {
      onJDReceived(message.text);
    }
  }
  if (message.action === "analyze_selection") {
    if (!inBrowsing) onJDReceived(message.text);
  }
  if (message.type === "PAGE_TITLE") {
    if (!inBrowsing) onJDReceived(message.title);
  }

  if (message.action === "JOBFLOW_ACTIVE_JD") {
    console.log(
      "[SidePanel] JOBFLOW_ACTIVE_JD phase=" + (message.phase || "?") +
      " title=" + (message.card && message.card.title) +
      " jdLen=" + (message.jd ? message.jd.length : 0)
    );
    onActiveJDFromBoss(message);
  }

  if (message.action === "JOBFLOW_PERSPECTIVE_PARTIAL") {
    if (currentState !== "browsing") return;
    if (!message.cacheKey || message.cacheKey !== activePerspectiveCacheKey) {
      return;
    }
    if (!message.card || !message.result) return;
    renderPerspectiveCard(message.card, message.result);
    sendMarkCardDot(message.card.idHash, message.result.level);
  }
});

// ========== onboarding ==========

(function initOnboarding() {
  /** 与 background 同步：是否已有可用 Key（含内置体验 Key） */
  function fetchDeepSeekApiStatus(cb) {
    try {
      chrome.runtime.sendMessage({ action: "JOBFLOW_DEEPSEEK_STATUS" }, function (res) {
        if (chrome.runtime.lastError || !res || !res.ok) {
          cb({ hasUsableKey: false, hasUserKey: false, source: "none" });
          return;
        }
        cb(res);
      });
    } catch (e) {
      cb({ hasUsableKey: false, hasUserKey: false, source: "none" });
    }
  }

  function refreshDeepSeekPlaceholders(hasUserKey, apiSt) {
    apiSt = apiSt || { hasUsableKey: false, source: "none" };
    var onb = document.getElementById("deepseek-api-key-onboarding");
    var br = document.getElementById("deepseek-api-key-browsing");
    var st = document.getElementById("deepseek-api-status");
    if (onb) {
      if (hasUserKey) {
        onb.placeholder = "已保存，修改请重新输入";
      } else if (apiSt.hasUsableKey && apiSt.source === "shared") {
        onb.placeholder = "可选：留空则使用插件内置体验 Key";
      } else if (apiSt.hasUsableKey && apiSt.source === "secrets") {
        onb.placeholder = "可选：已配置 secrets.js，此处可留空";
      } else {
        onb.placeholder = "在 platform.deepseek.com 申请（或等分发方配置内置 Key）";
      }
    }
    if (br) {
      if (hasUserKey) {
        br.placeholder = "已保存，输入新 Key 可覆盖；留空并保存可切回内置 Key";
      } else if (apiSt.hasUsableKey && apiSt.source === "shared") {
        br.placeholder = "留空则使用内置体验 Key；填写 sk-… 可改为自有 Key";
      } else {
        br.placeholder = "DeepSeek API Key（sk-…）";
      }
    }
    if (st) {
      if (hasUserKey) {
        st.textContent = "已保存自有 Key";
      } else if (apiSt.hasUsableKey && apiSt.source === "shared") {
        st.textContent = "当前使用内置体验 Key（额度由分发方承担，可在上方改为自有 Key）";
      } else if (apiSt.hasUsableKey && apiSt.source === "secrets") {
        st.textContent = "当前使用 secrets.js 中的 Key";
      } else {
        st.textContent = "";
      }
    }
  }

  chrome.storage.local.get(
    [
      "agreed",
      "perspectiveQuota",
      "adaptQuota",
      "deepseekApiKey",
      "deepseekModel",
      JOBFLOW_RESUME_PROFILE_KEY,
      JOBFLOW_RESUME_TEXT_KEY
    ],
    function (data) {
    if (data.perspectiveQuota !== undefined) perspectiveQuota = data.perspectiveQuota;
    if (data.adaptQuota !== undefined) adaptQuota = data.adaptQuota;

    resumeProfile = data[JOBFLOW_RESUME_PROFILE_KEY] || null;
    resumeRawText = (data[JOBFLOW_RESUME_TEXT_KEY] || "").trim();

    var hasKey = !!(data.deepseekApiKey && String(data.deepseekApiKey).trim());
    fetchDeepSeekApiStatus(function (apiSt) {
      refreshDeepSeekPlaceholders(hasKey, apiSt);

      var modelEl = document.getElementById("deepseek-model-browsing");
      if (modelEl && data.deepseekModel) {
        modelEl.value = String(data.deepseekModel).trim();
      }

      if (data.agreed) {
        if (hasStoredResumeProfile(resumeProfile)) {
          switchState("browsing");
          refreshBrowseProfileUI();
        } else {
          switchState("resume_upload");
          var ta = document.getElementById("resume-paste-input");
          if (ta) {
            ta.value = resumeRawText || "";
          }
        }
        updateQuotaBar();
      }
    });

    var cb = document.getElementById("agree-checkbox");
  var btn = document.getElementById("btn-start");
  if (cb && btn) {
    cb.onclick = function () {
      btn.disabled = !cb.checked;
    };
    btn.onclick = function () {
      var inputKey = document.getElementById("deepseek-api-key-onboarding");
      var pasted = inputKey ? inputKey.value.trim() : "";
      chrome.storage.local.get(["deepseekApiKey"], function (store) {
        var existing = (store.deepseekApiKey && String(store.deepseekApiKey).trim()) || "";
        fetchDeepSeekApiStatus(function (apiSt) {
          if (!pasted && !existing && !apiSt.hasUsableKey) {
            alert(
              "请填写 DeepSeek API Key，或由分发方在扩展内配置内置体验 Key（jobflow-default-api.js）。"
            );
            return;
          }
          var toSet = { agreed: true };
          if (pasted) {
            toSet.deepseekApiKey = pasted;
          }
          chrome.storage.local.set(toSet, function () {
            chrome.storage.local.get(["deepseekApiKey"], function (sx) {
              var hk = !!(sx.deepseekApiKey && String(sx.deepseekApiKey).trim());
              fetchDeepSeekApiStatus(function (st2) {
                refreshDeepSeekPlaceholders(hk, st2);
              });
            });
            switchState("resume_upload");
            document.getElementById("resume-profile-result").style.display = "none";
            document.getElementById("resume-analyze-error").style.display = "none";
            var ta = document.getElementById("resume-paste-input");
            if (ta) {
              ta.value = resumeRawText || "";
            }
            updateQuotaBar();
          });
        });
      });
    };
  }

  var btnSaveDs = document.getElementById("btn-save-deepseek-api");
  if (btnSaveDs) {
    btnSaveDs.addEventListener("click", function () {
      var keyInput = document.getElementById("deepseek-api-key-browsing").value.trim();
      var modelInput = document.getElementById("deepseek-model-browsing")
        ? document.getElementById("deepseek-model-browsing").value.trim()
        : "";
      chrome.storage.local.get(["deepseekApiKey"], function (store) {
        var existingKey = (store.deepseekApiKey && String(store.deepseekApiKey).trim()) || "";
        fetchDeepSeekApiStatus(function (apiSt) {
          if (!keyInput && !existingKey && !apiSt.hasUsableKey) {
            alert(
              "请先填写 DeepSeek API Key，或由分发方配置内置体验 Key（jobflow-default-api.js）。"
            );
            return;
          }
          function afterSave() {
            chrome.storage.local.get(["deepseekApiKey"], function (s2) {
              var hk = !!(s2.deepseekApiKey && String(s2.deepseekApiKey).trim());
              fetchDeepSeekApiStatus(function (st2) {
                refreshDeepSeekPlaceholders(hk, st2);
              });
            });
            var st = document.getElementById("deepseek-api-status");
            if (st) {
              if (keyInput) {
                st.textContent = modelInput
                  ? "已保存自有 Key 与模型名"
                  : "已保存自有 Key（默认 deepseek-v4-flash）";
              } else if (existingKey) {
                st.textContent = "已移除自有 Key，将使用内置 / secrets 中的 Key";
              } else {
                st.textContent = modelInput ? "已更新模型名" : "";
              }
            }
          }
          if (keyInput) {
            chrome.storage.local.set(
              { deepseekApiKey: keyInput, deepseekModel: modelInput },
              afterSave
            );
          } else if (existingKey) {
            chrome.storage.local.remove("deepseekApiKey", function () {
              chrome.storage.local.set({ deepseekModel: modelInput }, afterSave);
            });
          } else {
            chrome.storage.local.set({ deepseekModel: modelInput }, afterSave);
          }
        });
      });
    });
  }
  });
})();


(function initResumeUpload() {
  var errEl = document.getElementById("resume-analyze-error");
  var resultWrap = document.getElementById("resume-profile-result");

  function showErr(msg) {
    if (!errEl) return;
    errEl.textContent = msg || "";
    errEl.style.display = msg ? "block" : "none";
  }

  document.getElementById("btn-resume-pick-file").addEventListener("click", function () {
    document.getElementById("resume-file-input").click();
  });

  var btnClearResume = document.getElementById("btn-resume-clear");
  if (btnClearResume) {
    btnClearResume.addEventListener("click", function () {
      var ta = document.getElementById("resume-paste-input");
      if (ta) ta.value = "";
      setResumeFileStatus("");
      showErr("");
    });
  }

  function setResumeFileStatus(text, isError) {
    var el = document.getElementById("resume-file-status");
    if (!el) return;
    el.textContent = text || "";
    el.style.display = text ? "block" : "none";
    el.style.color = isError ? "#C2410C" : "var(--text3)";
  }

  function readTextFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || "")); };
      reader.onerror = function () { reject(new Error("文件读取失败")); };
      reader.readAsText(file, "UTF-8");
    });
  }

  function readArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error("文件读取失败")); };
      reader.readAsArrayBuffer(file);
    });
  }

  function describeError(err) {
    if (err == null) return "未知错误（err 为空）";
    if (typeof err === "string") return err;
    var parts = [];
    try {
      if (err.name && err.name !== "Error") parts.push("[" + err.name + "]");
      if (err.message) parts.push(String(err.message));
      if (!parts.length) {
        var keys = Object.getOwnPropertyNames(err || {});
        var bag = {};
        keys.forEach(function (k) {
          try {
            var v = err[k];
            if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
              bag[k] = v;
            }
          } catch (_) {}
        });
        var j = JSON.stringify(bag);
        if (j && j !== "{}") parts.push(j);
      }
      if (!parts.length) parts.push(String(err));
    } catch (_) {
      parts.push("(无法序列化的错误对象)");
    }
    return parts.join(" ").slice(0, 400);
  }

  function tag(stage, err) {
    var msg = describeError(err);
    var e = new Error("[" + stage + "] " + msg);
    e.original = err;
    if (err && err.stack) e.stack = err.stack;
    return e;
  }

  function openPdfFromBuffer(buf) {
    if (typeof pdfjsLib === "undefined") {
      return Promise.reject(new Error("pdf.js 未加载（pdfjsLib undefined）—— 请确认 lib/pdf.min.js 存在并已重新加载扩展。"));
    }
    try {
      pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("lib/pdf.worker.min.js");
    } catch (e0) {
      console.warn("[jobflow] set workerSrc failed", e0);
    }
    var loadingTask;
    try {
      loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(buf),
        cMapUrl: chrome.runtime.getURL("lib/cmaps/"),
        cMapPacked: true,
        standardFontDataUrl: chrome.runtime.getURL("lib/standard_fonts/"),
        disableFontFace: true,
        useSystemFonts: false,
        isEvalSupported: false,
        verbosity: 0
      });
    } catch (eSync) {
      return Promise.reject(tag("pdf.getDocument-sync", eSync));
    }
    return loadingTask.promise.catch(function (e) {
      throw tag("pdf.getDocument", e);
    });
  }

  function extractPdfText(file, onProgress) {
    return readArrayBuffer(file).catch(function (e) {
      throw tag("readArrayBuffer", e);
    }).then(openPdfFromBuffer).then(function (pdf) {
      var pages = [];
      var totalItems = 0;
      var failedPages = [];
      var seq = Promise.resolve();
      var nPages = pdf.numPages;
      for (var i = 1; i <= nPages; i++) {
        (function (n) {
          seq = seq.then(function () {
            return pdf.getPage(n).then(function (page) {
              return page.getTextContent().then(function (tc) {
                totalItems += (tc.items || []).length;
                if (typeof onProgress === "function") onProgress(n, nPages, "text");
                var lastY = null;
                var line = [];
                var lines = [];
                tc.items.forEach(function (it) {
                  var y = it.transform && it.transform[5];
                  if (lastY !== null && Math.abs(y - lastY) > 2) {
                    lines.push(line.join(" "));
                    line = [];
                  }
                  line.push(it.str || "");
                  lastY = y;
                });
                if (line.length) lines.push(line.join(" "));
                pages.push(lines.join("\n"));
              });
            }).catch(function (pageErr) {
              console.warn("[jobflow] page " + n + " parse failed", pageErr);
              failedPages.push(n);
              pages.push("");
            });
          });
        })(i);
      }
      return seq.then(function () {
        return {
          text: pages.join("\n\n"),
          numPages: nPages,
          totalItems: totalItems,
          failedPages: failedPages
        };
      });
    });
  }

  function extractPdfOcr(file, onProgress) {
    if (typeof Tesseract === "undefined") {
      return Promise.reject(new Error("OCR 模块未加载，请重新加载插件。"));
    }
    var workerInst = null;
    return readArrayBuffer(file).then(openPdfFromBuffer).then(function (pdf) {
      var nPages = pdf.numPages;
      var twOpts = {
        workerPath: chrome.runtime.getURL("lib/tesseract/worker.min.js"),
        corePath: chrome.runtime.getURL("lib/tesseract/"),
        langPath: chrome.runtime.getURL("lib/tessdata/"),
        workerBlobURL: false,
        gzip: false,
        legacyCore: false,
        legacyLang: false,
        cacheMethod: "none",
        logger: function (m) {
          if (m.status === "recognizing text" && typeof onProgress === "function") {
            var pct = Math.round((m.progress || 0) * 100);
            onProgress(0, nPages, "ocr_pct", pct);
          }
        }
      };
      return Tesseract.createWorker("chi_sim+eng", 1, twOpts).catch(function (e) {
        throw tag("Tesseract.createWorker", e);
      }).then(function (w) {
        workerInst = w;
        return w.setParameters({ tessedit_pageseg_mode: "6" }).then(function () {
          var parts = [];
          var seq = Promise.resolve();
          for (var pi = 1; pi <= nPages; pi++) {
            (function (pageNum) {
              seq = seq.then(function () {
                if (typeof onProgress === "function") onProgress(pageNum, nPages, "ocr_page");
                return pdf.getPage(pageNum).then(function (page) {
                  var scale = 2.35;
                  var viewport = page.getViewport({ scale: scale });
                  var canvas = document.createElement("canvas");
                  var pw = Math.ceil(viewport.width);
                  var ph = Math.ceil(viewport.height);
                  canvas.width = pw;
                  canvas.height = ph;
                  var ctx = canvas.getContext("2d", { alpha: false });
                  if (ctx) {
                    ctx.fillStyle = "#ffffff";
                    ctx.fillRect(0, 0, pw, ph);
                  }
                  var renderTask = page.render({ canvasContext: ctx, viewport: viewport });
                  var rp = renderTask && renderTask.promise ? renderTask.promise : renderTask;
                  return Promise.resolve(rp).then(function () {
                    return w.recognize(canvas);
                  }).then(function (r) {
                    var t = (r && r.data && r.data.text) ? r.data.text : "";
                    parts.push(t);
                  });
                });
              });
            })(pi);
          }
          return seq.then(function () {
            return w.terminate().then(function () {
              workerInst = null;
              return {
                text: parts.join("\n\n"),
                numPages: nPages,
                totalItems: 0,
                viaOcr: true
              };
            });
          });
        });
      });
    }).catch(function (err) {
      if (workerInst && typeof workerInst.terminate === "function") {
        return Promise.resolve(workerInst.terminate()).catch(function () {}).then(function () {
          workerInst = null;
          return Promise.reject(err);
        });
      }
      return Promise.reject(err);
    });
  }

  document.getElementById("resume-file-input").addEventListener("change", function (e) {
    var f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    var isPdf = /\.pdf$/i.test(f.name) || f.type === "application/pdf";
    var isTxt = /\.txt$/i.test(f.name) || f.type === "text/plain";
    if (!isPdf && !isTxt) {
      setResumeFileStatus("仅支持 PDF 或 TXT，Word 请另存为 PDF 或复制文本粘贴。", true);
      return;
    }
    showErr("");
    setResumeFileStatus("正在读取 " + f.name + " …");
    var ta = document.getElementById("resume-paste-input");

    // 仅 PDF 走文本提取；同时把 PDF 二进制存起来（用于批注模式）
    if (isPdf) {
      // 注意：先清掉旧 PDF，避免新旧不一致
      clearStoredResumePdf();
      storeResumePdf(f).then(function (r) {
        if (r && r.stored) {
          console.log("[jobflow] resume PDF binary saved to storage");
        } else if (r && r.reason) {
          console.warn("[jobflow] resume PDF NOT saved:", r.reason);
        }
      }).catch(function (err) {
        console.warn("[jobflow] storeResumePdf failed:", err && err.message);
      });
    } else {
      // 文本简历会清除已存的 PDF 二进制（保持一致性）
      clearStoredResumePdf();
    }

    var task = isPdf
      ? extractPdfText(f, function (n, total, phase, pct) {
          if (phase === "text") {
            setResumeFileStatus("正在解析 " + f.name + " (" + n + "/" + total + " 页) …");
          }
        })
      : readTextFile(f).then(function (t) { return { text: t, numPages: 0, totalItems: 0 }; });
    task.then(function (res) {
      var text = String(res.text || "").replace(/\u0000/g, "").trim();
      console.log("[jobflow] pdf parse result", { pages: res.numPages, items: res.totalItems, chars: text.length, ocr: !!res.viaOcr });
      if (text) {
        if (ta) ta.value = text;
        var meta = isPdf ? "(" + res.numPages + " 页 / " + text.length + " 字" + (res.viaOcr ? " · OCR" : "") + ")" : "(" + text.length + " 字)";
        setResumeFileStatus("已导入 " + f.name + " " + meta + "，可继续编辑或点击「开始分析」。");
        return;
      }
      if (isPdf && (res.totalItems || 0) === 0) {
        setResumeFileStatus("未检测到可选中文字，正在本地 OCR（首次需加载中英文模型，约 10–60 秒）…", false);
        return extractPdfOcr(f, function (n, total, phase, pct) {
          if (phase === "ocr_page") {
            setResumeFileStatus("OCR 识别 " + f.name + " 第 " + n + "/" + total + " 页…");
          } else if (phase === "ocr_pct" && pct != null) {
            setResumeFileStatus("OCR 识别中… " + pct + "%");
          }
        });
      }
      var hint = isPdf
        ? "PDF 共 " + (res.numPages || 0) + " 页 / " + (res.totalItems || 0) + " 个文本对象，但提取到 0 字。请复制简历正文粘贴，或换用「可搜索的 PDF」导出。"
        : "未读取到文字，请检查文件。";
      setResumeFileStatus(hint, true);
      return Promise.resolve();
    }).then(function (ocrRes) {
      if (!ocrRes || !ocrRes.viaOcr) return;
      var ocrText = String(ocrRes.text || "").replace(/\u0000/g, "").trim();
      if (!ocrText) {
        setResumeFileStatus("OCR 仍无法识别出文字。可尝试：① 用 Word「另存为 PDF」并勾选可搜索；② 在 PDF 阅读器里全选复制后粘贴。", true);
        return;
      }
      if (ta) ta.value = ocrText;
      setResumeFileStatus("已通过本地 OCR 导入 " + f.name + "（" + ocrRes.numPages + " 页 / " + ocrText.length + " 字），请核对后再点「开始分析」。", false);
    }).catch(function (err) {
      var detail = describeError(err);
      console.error("[jobflow] resume file parse error", err);
      if (err && err.stack) console.error("[jobflow] stack:", err.stack);
      if (err && err.original) console.error("[jobflow] original:", err.original);
      setResumeFileStatus("解析失败：" + detail + "（请按 F12 → Console，复制 [jobflow] 开头的日志发给我排查）", true);
    });
  });

  document.getElementById("btn-analyze-resume").addEventListener("click", function () {
    var btn = this;
    var text = document.getElementById("resume-paste-input").value.trim();
    showErr("");
    btn.disabled = true;
    chrome.runtime.sendMessage({ action: "AI_ANALYZE_RESUME", resumeText: text }, function (resp) {
      btn.disabled = false;
      if (!resp || !resp.ok) {
        showErr((resp && resp.error) || "分析失败，请检查 API Key 与网络。");
        return;
      }
      resumeProfile = resp.profile;
      resumeRawText = text;
      renderResumeProfileResult(resp.profile);
    });
  });

  document.getElementById("btn-confirm-resume").addEventListener("click", function () {
    if (!hasStoredResumeProfile(resumeProfile)) {
      alert("请先点击「开始分析」生成简历画像。");
      return;
    }
    switchState("browsing");
    refreshBrowseProfileUI();
    updateQuotaBar();
    resetPerspectiveUI();
  });

  document.getElementById("btn-edit-resume-inline").addEventListener("click", function () {
    hydrateResumeFromStorage(function () {
      switchState("resume_upload");
      var ta = document.getElementById("resume-paste-input");
      if (ta) ta.value = resumeRawText || "";
      showErr("");
      if (hasStoredResumeProfile(resumeProfile)) {
        renderResumeProfileResult(resumeProfile);
      } else if (resultWrap) {
        resultWrap.style.display = "none";
      }
    });
  });

  var reUp = document.getElementById("btn-reupload-resume-settings");
  if (reUp) {
    reUp.addEventListener("click", function () {
      document.getElementById("browse-more-drawer").open = false;
      document.getElementById("btn-edit-resume-inline").click();
    });
  }
})();

// ========== browsing：JD 透视模式 ==========
//
// 流程：用户在 Boss 列表点开任一卡片
//   → content.js 抓 JD 文本，发 JOBFLOW_ACTIVE_JD 到 sidepanel
//   → sidepanel 显示 loading，调 AI_JD_PERSPECTIVE（background 两阶段：先快出匹配+缺口推送 PARTIAL，再补全尾段）
//   → 渲染透视卡（先匹配度条 + 投递建议 + TOP3；简历翻译与面试弹药随后出现）
//   → 同时发 JOBFLOW_MARK_CARD_DOT 通知 content 在该卡片角落点亮 dot

// ========== 透视卡状态 ==========

var activeCardInfo = null;     // 当前正在分析 / 已分析的卡片元数据
var activePerspectiveInFlight = false;  // 是否有 AI_JD_PERSPECTIVE 调用正在飞
/** 与 background 推送的 partial 对齐，避免旧请求的尾段刷新到新岗位 */
var activePerspectiveCacheKey = null;
var perspectiveCache = {};     // idHash -> { card, result, at, jd, jdKey }

/** 用于透视缓存命中：同一张卡片若 JD 正文已变（修复错位后），不得复用旧 AI 结果 */
function perspectiveJdFingerprint(jd) {
  var s = String(jd || "").replace(/\s+/g, " ").trim();
  if (s.length < 24) return "";
  return s.substring(0, 200) + "@@" + String(s.length);
}

// ===== UI 切换：empty / loading / card / error =====

function resetPerspectiveUI() {
  showPerspectiveState("empty");
}

function showPerspectiveState(state, payload) {
  var idMap = {
    empty: "jd-perspective-empty",
    loading: "jd-perspective-loading",
    card: "jd-perspective-card",
    error: "jd-perspective-error"
  };
  for (var k in idMap) {
    var el = document.getElementById(idMap[k]);
    if (el) el.style.display = "none";
  }
  var target = document.getElementById(idMap[state]);
  if (!target) return;
  if (state === "loading") {
    var t = document.getElementById("jd-perspective-loading-title");
    if (t) t.textContent = (payload && payload.title) ? payload.title : "正在读取岗位…";
  }
  if (state === "error") {
    target.querySelector("p").textContent = (payload && payload.message) || "未知错误";
  }
  target.style.display = "block";
}

/** 将旧版透视缓存 / 部分字段升级为 v2 结构（决策卡 + TOP3 + 翻译器 + 面试折叠） */
function normalizePerspectiveCardResult(r) {
  if (!r || typeof r !== "object") {
    return {
      schemaVersion: 2,
      level: "medium",
      matchScore: 50,
      applyAdvice: "try",
      hardCount: 0,
      oneLiner: "",
      gapItems: [],
      resumeLines: [],
      interviewAmmo: [],
      gaps: [],
      hits: [],
      talkingPoints: [],
      resumeTweaks: [],
      analysisProcess: ""
    };
  }
  if (r.schemaVersion >= 2) return r;

  var advice = r.level === "high" ? "strong" : r.level === "low" ? "avoid" : "try";
  var score = r.level === "high" ? 80 : r.level === "low" ? 35 : 55;
  var gapItems = [];
  var gaps = r.gaps || [];
  for (var i = 0; i < Math.min(3, gaps.length); i++) {
    gapItems.push({
      tier: "must_fix",
      insight: String(gaps[i]),
      action: "在「AI 修订简历」中逐条落实",
      copy: String(gaps[i]),
      nextAction: "在「AI 修订简历」中逐条落实"
    });
  }
  if (!gapItems.length) {
    gapItems.push({
      tier: "highlight",
      insight: r.oneLiner || "（暂无缺口项，可先展开底部面试弹药库）",
      action: "重新点开本岗位以拉取完整 JD",
      copy: r.oneLiner || "（暂无缺口项，可先展开底部面试弹药库）",
      nextAction: "重新点开本岗位以拉取完整 JD"
    });
  }
  var resumeLines = [];
  var tweaks = r.resumeTweaks || [];
  var hits = r.hits || [];
  for (var j = 0; j < Math.min(3, tweaks.length); j++) {
    resumeLines.push({
      original: hits[0] || "（简历中的相关经历摘要）",
      jdKw: "岗位关键词",
      suggested: String(tweaks[j]),
      matchLogic: "",
      nextAction: "粘贴到简历对应项目 bullet"
    });
  }
  if (!resumeLines.length) {
    resumeLines.push({
      original: "—",
      jdKw: "—",
      suggested: r.oneLiner || "请重新点开岗位以使用新版透视输出",
      matchLogic: "",
      nextAction: "保存简历画像后刷新本卡"
    });
  }
  var am = [];
  var tp = r.talkingPoints || [];
  for (var k = 0; k < Math.min(3, tp.length); k++) {
    am.push({
      question: "针对本岗位的相关追问（" + (k + 1) + "）",
      answerStar: String(tp[k]),
      pressureFollowUp: ""
    });
  }
  while (am.length < 3) {
    am.push({
      question: "（缓存简略）请用 STAR 自拟一条追问",
      answerStar:
        "Situation：业务/团队背景。\nTask：你的职责与目标。\nAction：具体动作、协作与方法。\nResult：可量化结果。（务必嵌入简历里真实项目名）",
      pressureFollowUp: ""
    });
  }
  return {
    schemaVersion: 2,
    level: r.level || "medium",
    matchScore: score,
    applyAdvice: advice,
    hardCount: gapItems.filter(function (x) {
      return x.tier === "must_fix";
    }).length,
    oneLiner: r.oneLiner || "",
    gapItems: gapItems,
    resumeLines: resumeLines,
    interviewAmmo: am,
    gaps: (r.gaps || []).slice(),
    hits: r.hits,
    talkingPoints: r.talkingPoints,
    resumeTweaks: r.resumeTweaks
  };
}

function jdpCopyToClipboard(s) {
  if (!s) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(s).catch(function () {
      fallbackCopy(s);
    });
  } else {
    fallbackCopy(s);
  }
}

function renderPerspectiveCard(card, result) {
  showPerspectiveState("card");
  result = normalizePerspectiveCardResult(result);

  document.getElementById("jdp-title").textContent = card.title || "";
  var metaBits = [];
  if (card.company) metaBits.push(card.company);
  if (card.salary) metaBits.push(card.salary);
  if (card.location) metaBits.push(card.location);
  document.getElementById("jdp-meta").textContent = metaBits.join(" · ");

  var sc = typeof result.matchScore === "number" ? result.matchScore : parseInt(result.matchScore, 10);
  if (isNaN(sc)) sc = 0;
  if (sc < 0) sc = 0;
  if (sc > 100) sc = 100;
  document.getElementById("jdp-score-num").textContent = sc + "%";
  var fill = document.getElementById("jdp-score-fill");
  if (fill) fill.style.width = sc + "%";

  var tag = document.getElementById("jdp-apply-tag");
  var adv = result.applyAdvice || "try";
  tag.className =
    "jdp-apply-tag " +
    (adv === "strong" ? "tag-strong" : adv === "avoid" ? "tag-avoid" : "tag-try");
  tag.textContent =
    adv === "strong"
      ? "强烈推荐 · 建议优先投递"
      : adv === "avoid"
        ? "不建议投 · 硬伤或方向风险偏高"
        : "可尝试投 · 核心大体匹配";

  document.getElementById("jdp-oneliner").textContent =
    result.oneLiner || "分析完成，请看下方行动项。";

  var ul = document.getElementById("jdp-top3");
  ul.innerHTML = "";
  var items = result.gapItems || [];
  for (var gi = 0; gi < items.length; gi++) {
    var it = items[gi];
    var tier = it.tier || "must_fix";
    var liClass =
      tier === "nice" ? "jdp-tier-nice" : tier === "highlight" ? "jdp-tier-highlight" : "jdp-tier-must";
    var pill =
      tier === "nice"
        ? "加分项 · Nice to have"
        : tier === "highlight"
          ? "已有优势 · Highlight"
          : "硬伤 · Must fix";
    var li = document.createElement("li");
    li.className = liClass;
    var insightText = it.insight != null && String(it.insight).trim() ? it.insight : it.copy || "";
    var actionText = it.action != null && String(it.action).trim() ? it.action : it.nextAction || "";
    li.innerHTML =
      '<span class="jdp-tier-pill">' +
      escapeHtml(pill) +
      "</span><br>" +
      '<div style="font-size:12px;color:var(--text2);line-height:1.55;margin-top:4px;">' +
      escapeHtml(insightText) +
      "</div>" +
      '<div class="jdp-next-line">行动：' +
      escapeHtml(actionText) +
      "</div>";
    ul.appendChild(li);
  }

  var tailP = document.getElementById("jdp-tail-pending");
  var tw = document.getElementById("jdp-translator-wrap");
  var idet = document.getElementById("jdp-interview-details");
  if (result && result.__pendingTail) {
    if (tailP) tailP.style.display = "block";
    if (tw) tw.style.display = "none";
    if (idet) idet.style.display = "none";
  } else {
    if (tailP) tailP.style.display = "none";
    if (tw) tw.style.display = "block";
    if (idet) idet.style.display = "";
  }

  var transHost = document.getElementById("jdp-translator");
  transHost.innerHTML = "";
  var rlines = result.resumeLines || [];
  var suggestedTexts = [];
  for (var ri = 0; ri < rlines.length; ri++) {
    var row = rlines[ri];
    suggestedTexts.push(row.suggested || "");
    var blk = document.createElement("div");
    blk.className = "jdp-trans-block";
    blk.innerHTML =
      '<div class="jdp-trans-row"><b>原简历表述</b>：' +
      escapeHtml(row.original || "") +
      "</div>" +
      '<div class="jdp-trans-row"><b>目标 JD 关键词</b>：' +
      escapeHtml(row.jdKw || "") +
      "</div>" +
      '<div class="jdp-suggested"><b>建议改写（可直接贴简历）</b><br>' +
      escapeHtml(row.suggested || "") +
      "</div>" +
      (row.matchLogic
        ? '<div class="jdp-next-line" style="margin-top:6px;color:var(--text3);">命中逻辑：' +
          escapeHtml(row.matchLogic) +
          "</div>"
        : "") +
      '<div class="jdp-next-line">下一步：' +
      escapeHtml(row.nextAction || "") +
      "</div>";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-secondary jdp-copy-btn";
    btn.textContent = "复制建议文本";
    btn.setAttribute("data-jdp-copy-idx", String(ri));
    blk.appendChild(btn);
    transHost.appendChild(blk);
  }
  transHost._jdpCopyList = suggestedTexts;
  transHost.onclick = function (ev) {
    var btnEl = ev.target;
    if (!btnEl || btnEl.tagName !== "BUTTON") return;
    var ix = btnEl.getAttribute("data-jdp-copy-idx");
    if (ix == null) return;
    var list = transHost._jdpCopyList || [];
    var text = list[parseInt(ix, 10)];
    if (text) jdpCopyToClipboard(text);
  };

  var det = document.getElementById("jdp-interview-details");
  if (det) {
    det.open = false;
    var ib = document.getElementById("jdp-interview-body");
    ib.innerHTML = "";
    var ammo = result.interviewAmmo || [];
    for (var ai = 0; ai < ammo.length; ai++) {
      var qb = document.createElement("div");
      qb.className = "jdp-qa-block";
      var qh = document.createElement("p");
      qh.className = "jdp-qa-q";
      qh.textContent = "Q" + (ai + 1) + "：" + (ammo[ai].question || "");
      var ah = document.createElement("p");
      ah.className = "jdp-qa-a";
      ah.textContent = ammo[ai].answerStar || "";
      qb.appendChild(qh);
      qb.appendChild(ah);
      var pf = (ammo[ai].pressureFollowUp || "").trim();
      if (pf) {
        var pfEl = document.createElement("p");
        pfEl.className = "jdp-qa-follow";
        pfEl.style.cssText = "font-size:11px;color:var(--text3);margin:6px 0 0 0;line-height:1.45;";
        pfEl.textContent = "可能追问：" + pf;
        qb.appendChild(pfEl);
      }
      ib.appendChild(qb);
    }
  }
}

// ===== 收到 ACTIVE_JD：调用 AI =====

function onActiveJDFromBoss(payload) {
  if (!payload || !payload.card) {
    console.warn("[SidePanel] onActiveJDFromBoss: missing card payload");
    return;
  }
  if (currentState !== "browsing") {
    console.log("[SidePanel] onActiveJDFromBoss: switching to browsing");
    switchState("browsing");
    refreshBrowseProfileUI();
  }
  if (!hasStoredResumeProfile(resumeProfile)) {
    console.warn("[SidePanel] onActiveJDFromBoss: no resume profile yet");
    showPerspectiveState("error", { message: "请先完成简历画像，再使用 JD 透视。" });
    return;
  }

  var card = payload.card;
  activeCardInfo = card;

  if (payload.phase === "loading") {
    showPerspectiveState("loading", { title: card.title });
    return;
  }

  // payload.phase === "ready"
  var cacheKey = card.idHash || (card.title + "|" + card.company);
  var jdFp = perspectiveJdFingerprint(payload.jd || "");
  var cached = perspectiveCache[cacheKey];
  if (
    cached &&
    jdFp &&
    cached.jdKey === jdFp &&
    Date.now() - cached.at < 30 * 60 * 1000
  ) {
    renderPerspectiveCard(card, cached.result);
    sendMarkCardDot(card.idHash, cached.result.level);
    return;
  }

  if (activePerspectiveInFlight) return;
  activePerspectiveInFlight = true;
  activePerspectiveCacheKey = cacheKey;
  showPerspectiveState("loading", { title: card.title });

  chrome.runtime.sendMessage(
    {
      action: "AI_JD_PERSPECTIVE",
      card: card,
      jd: payload.jd || ""
    },
    function (resp) {
      activePerspectiveInFlight = false;
      activePerspectiveCacheKey = null;
      if (!resp || !resp.ok || !resp.result) {
        var msg = (resp && resp.error) || "AI 未返回结果";
        showPerspectiveState("error", { message: msg });
        return;
      }
      perspectiveCache[cacheKey] = {
        card: card,
        result: resp.result,
        at: Date.now(),
        jd: payload.jd || "",
        jdKey: perspectiveJdFingerprint(payload.jd || "")
      };
      renderPerspectiveCard(card, resp.result);
      sendMarkCardDot(card.idHash, resp.result.level);
    }
  );
}

function sendMarkCardDot(idHash, level) {
  if (!idHash) return;
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (!tabs[0]) return;
    tabsSendToContent(
      tabs[0].id,
      { action: "JOBFLOW_MARK_CARD_DOT", idHash: idHash, level: level },
      function () {}
    );
  });
}

// ========== 截图 OCR 容灾（粘贴 + 拖拽 + 上传三合一） ==========

document.getElementById("btn-toggle-fallback").addEventListener("click", function () {
  var panel = document.getElementById("fallback-panel");
  panel.style.display = panel.style.display === "none" ? "block" : "none";
});

var dropZone = document.getElementById("ocr-drop-zone");
var fileInput = document.getElementById("ocr-file-input");
var currentOcrFile = null;

function handleImageFile(file) {
  if (!file || !file.type.match(/image\//)) return;
  currentOcrFile = file;

  var reader = new FileReader();
  reader.onload = function (ev) {
    document.getElementById("ocr-preview").src = ev.target.result;
    document.getElementById("ocr-preview").style.display = "block";
    dropZone.style.display = "none";
    document.getElementById("ocr-actions").style.display = "flex";
    document.getElementById("ocr-result-textarea").style.display = "none";
    document.getElementById("btn-manual-analyze").style.display = "none";
  };
  reader.readAsDataURL(file);
}

// 点击上传
dropZone.addEventListener("click", function () {
  fileInput.click();
});

fileInput.addEventListener("change", function (e) {
  if (e.target.files[0]) handleImageFile(e.target.files[0]);
});

// 拖拽上传
dropZone.addEventListener("dragover", function (e) {
  e.preventDefault();
  dropZone.style.borderColor = "#10b981";
});

dropZone.addEventListener("dragleave", function () {
  dropZone.style.borderColor = "#d1d5db";
});

dropZone.addEventListener("drop", function (e) {
  e.preventDefault();
  dropZone.style.borderColor = "#d1d5db";
  var file = e.dataTransfer.files[0];
  if (file) handleImageFile(file);
});

// Ctrl+V 粘贴
document.addEventListener("paste", function (e) {
  var panel = document.getElementById("fallback-panel");
  if (panel.style.display === "none") return;

  var items = e.clipboardData && e.clipboardData.items;
  if (!items) return;

  for (var i = 0; i < items.length; i++) {
    if (items[i].type.match(/image\//)) {
      e.preventDefault();
      handleImageFile(items[i].getAsFile());
      return;
    }
  }
});

// 重新选择
document.getElementById("btn-reselect").addEventListener("click", function () {
  fileInput.click();
});

// 开始识别（Mock OCR）
document.getElementById("btn-start-ocr").addEventListener("click", function () {
  document.getElementById("ocr-loading").style.display = "block";
  document.getElementById("ocr-actions").style.display = "none";
  document.getElementById("ocr-preview").style.display = "none";

  setTimeout(function () {
    document.getElementById("ocr-loading").style.display = "none";
    var mockJD = "AI 产品实习生\n公司：某头部互联网公司\n薪资：8K-12K\n\n" +
      "职位描述：\n1. 参与 AI 产品需求分析与功能设计\n" +
      "2. 协助产品经理进行用户调研与竞品分析\n" +
      "3. 负责 Prompt 优化与 AIGC 效果评估\n" +
      "4. 参与用户增长与留存策略制定\n\n" +
      "任职要求：\n1. 熟悉 AI 工具使用，了解大模型基本原理\n" +
      "2. 有数据分析能力，熟练使用 SQL\n" +
      "3. 每周至少到岗 4 天，实习 3 个月以上";

    var textarea = document.getElementById("ocr-result-textarea");
    textarea.value = mockJD;
    textarea.style.display = "block";
    document.getElementById("btn-manual-analyze").style.display = "block";
    dropZone.style.display = "none";
  }, 1000);
});

document.getElementById("btn-manual-analyze").addEventListener("click", function () {
  var text = document.getElementById("ocr-result-textarea").value.trim();
  if (!text) return;
  onJDReceived(text);
});

document.getElementById("btn-clear-data").addEventListener("click", function () {
  chrome.storage.local.clear(function () {
    window.location.reload();
  });
});

// ========== adapt：track-changes 简历适配 ==========
//
// 数据模型：
//   adaptState.resume      — 简历原文（不可变）
//   adaptState.edits       — AI 返回的锚定式 edits，每项 { id, anchor, before, after, reason }
//                             同时缓存计算后的 { absStart, absEnd } 用于排序拼接
//   adaptState.editStates  — { editId: "pending" | "accepted" | "rejected" }
//   adaptState.editCustom  — { editId: 用户自定义的 after }
//   adaptState.floatingTips — string[]，无法锚定的补充建议
//   adaptState.card        — 当前岗位卡 { title, company, salary, location }
//   adaptState.jd          — 用于本次适配的 JD 正文
//
// 渲染：把简历原文按 edits 切片，每个 edit 处插入 <del>+<ins>+操作条。
// 接受 / 忽略 / 自定义只切换 CSS class，不重排 DOM。

var adaptState = {
  mode: "text",          // "pdf" | "text"
  resume: "",            // 简历纯文本（textContent 提取或粘贴版本）
  edits: [],             // 已 verified 的 edits（含 absStart/absEnd 用于文本模式）
  editStates: {},        // editId → "pending" | "accepted" | "rejected"
  editCustom: {},        // editId → 用户自定义的 after
  editLocations: {},     // editId → { pageIdx, rects[] }（PDF 模式专用，文本模式留空）
  floatingTips: [],
  card: null,
  jd: "",
  pdfDoc: null,
  pdfPages: [],          // [{ pageNum, viewport, items, flatChars, pageText, pageEl, overlay, width, height }]
  pdfBuffer: null,
  pdfText: ""            // 跨页拼接后的全局文本，用于把 edit 锚定到「全局位置」
};
var adaptInFlight = false;

function escapeHtmlForRedline(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function showAdaptState(state) {
  var ids = ["adapt-loading", "adapt-error", "adapt-mode-pdf", "adapt-mode-text"];
  for (var i = 0; i < ids.length; i++) {
    var el = document.getElementById(ids[i]);
    if (el) el.style.display = "none";
  }
  var t = document.getElementById(state);
  if (t) t.style.display = "block";
}

function updateAdaptStatusPill() {
  var pill = document.getElementById("adapt-status-pill");
  if (!pill) return;
  var edits = adaptState.edits;
  if (!edits.length) {
    pill.style.display = "none";
    return;
  }
  var accepted = 0, rejected = 0, pending = 0;
  for (var i = 0; i < edits.length; i++) {
    var st = adaptState.editStates[edits[i].id] || "pending";
    if (st === "accepted") accepted++;
    else if (st === "rejected") rejected++;
    else pending++;
  }
  pill.style.display = "inline-block";
  pill.textContent = "已采纳 " + accepted + " / " + edits.length + (pending ? "（待定 " + pending + "）" : "");
}

function enterAdaptMode(card, jd) {
  if (!hasStoredResumeProfile(resumeProfile)) {
    alert("请先完成简历画像后再使用适配功能。");
    switchState("resume_upload");
    return;
  }
  if (!resumeRawText || String(resumeRawText).trim().length < 60) {
    alert("简历原文太短或未保存，请先在「编辑简历」里补充原文。");
    switchState("resume_upload");
    return;
  }
  if (!JOBFLOW_QUOTA_DISABLED) {
    if (adaptQuota <= 0) {
      alert("适配额度已用完");
      return;
    }
    adaptQuota--;
    saveQuota();
  }
  updateQuotaBar();

  adaptState = {
    mode: "text",
    resume: String(resumeRawText).trim(),
    edits: [],
    editStates: {},
    editCustom: {},
    editLocations: {},
    floatingTips: [],
    card: card || null,
    jd: String(jd || ""),
    pdfDoc: null,
    pdfPages: [],
    pdfBuffer: null,
    pdfText: "",
    pdfZoom: null
  };

  switchState("adapt");

  // 头部岗位信息
  var titleEl = document.getElementById("adapt-job-title");
  var subEl = document.getElementById("adapt-job-sub");
  if (titleEl) titleEl.textContent = (card && card.title) || "未指定岗位";
  if (subEl) {
    var bits = [];
    if (card && card.company) bits.push(card.company);
    if (card && card.salary) bits.push(card.salary);
    if (card && card.location) bits.push(card.location);
    subEl.textContent = bits.join(" · ");
  }

  updateAdaptStatusPill();
  showAdaptState("adapt-loading");

  // 尝试加载已保存的 PDF；若有则进入「批注模式」，否则回退到「纯文本模式」
  loadStoredResumePdfBuffer().then(function (buf) {
    if (buf && typeof pdfjsLib !== "undefined") {
      adaptState.pdfBuffer = buf;
      return renderAdaptPdfPages(buf).then(function () {
        adaptState.mode = "pdf";
        runResumeDiff();
      }).catch(function (err) {
        console.warn("[jobflow] PDF render for adapt failed, fallback to text:", err && err.message);
        adaptState.mode = "text";
        adaptState.pdfBuffer = null;
        adaptState.pdfPages = [];
        runResumeDiff();
      });
    }
    adaptState.mode = "text";
    runResumeDiff();
  });
}

// ===== PDF 模式：把原 PDF 逐页渲染到 stage，并建立 textContent 几何索引 =====
function clampAdaptPdfZoom(z) {
  if (typeof z !== "number" || isNaN(z)) return 0.55;
  if (z < 0.35) return 0.35;
  if (z > 1.5) return 1.5;
  return z;
}

function applyAdaptPdfZoom() {
  var root = document.getElementById("adapt-pdf-pages-root");
  var pctEl = document.getElementById("adapt-pdf-zoom-pct");
  if (!root || !adaptState) return;
  var z = clampAdaptPdfZoom(adaptState.pdfZoom);
  adaptState.pdfZoom = z;
  try {
    root.style.zoom = String(z);
  } catch (e1) {
    try {
      root.style.zoom = z;
    } catch (e2) {}
  }
  if (pctEl) pctEl.textContent = Math.round(z * 100) + "%";
}

function fitAdaptPdfZoomToWidth() {
  var stage = document.getElementById("adapt-pdf-stage");
  if (!adaptState || !adaptState.pdfPages || !adaptState.pdfPages.length) return;
  var pw = adaptState.pdfPages[0].width || 1;
  var sw = 320;
  if (stage && stage.clientWidth > 40) {
    sw = stage.clientWidth - 28;
  }
  if (sw < 120) sw = 280;
  adaptState.pdfZoom = clampAdaptPdfZoom((sw / pw) * 0.96);
  applyAdaptPdfZoom();
}

function renderAdaptPdfPages(buf) {
  var stage = document.getElementById("adapt-pdf-stage");
  var root = document.getElementById("adapt-pdf-pages-root");
  if (!stage || !root) return Promise.reject(new Error("adapt-pdf-stage or pages-root missing"));
  var savedZoom =
    adaptState && typeof adaptState.pdfZoom === "number" && !isNaN(adaptState.pdfZoom)
      ? adaptState.pdfZoom
      : null;
  root.innerHTML = "";
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("lib/pdf.worker.min.js");
  } catch (e) {}
  var task = pdfjsLib.getDocument({
    data: new Uint8Array(buf),
    cMapUrl: chrome.runtime.getURL("lib/cmaps/"),
    cMapPacked: true,
    standardFontDataUrl: chrome.runtime.getURL("lib/standard_fonts/"),
    disableFontFace: true,
    useSystemFonts: false,
    isEvalSupported: false,
    verbosity: 0
  });
  return task.promise.then(function (pdf) {
    adaptState.pdfDoc = pdf;
    adaptState.pdfPages = [];
    var globalText = "";
    var seq = Promise.resolve();
    for (var i = 1; i <= pdf.numPages; i++) {
      (function (n, accBefore) {
        seq = seq.then(function () {
          return renderOneAdaptPage(pdf, n).then(function (pg) {
            // 全局拼接：每页之间用换行隔开
            pg.globalOffset = globalText.length;
            globalText += pg.pageText;
            if (n < pdf.numPages) globalText += "\n\n";
            adaptState.pdfPages.push(pg);
          });
        });
      })(i, globalText);
    }
    return seq.then(function () {
      adaptState.pdfText = globalText;
      console.log("[jobflow] adapt PDF rendered:", pdf.numPages, "pages, globalText len=", globalText.length);
      function applyZoomAfterLayout() {
        if (savedZoom != null && savedZoom >= 0.35 && savedZoom <= 1.5) {
          adaptState.pdfZoom = savedZoom;
          applyAdaptPdfZoom();
        } else {
          fitAdaptPdfZoomToWidth();
        }
      }
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(function () {
          requestAnimationFrame(applyZoomAfterLayout);
        });
      } else {
        setTimeout(applyZoomAfterLayout, 0);
      }
    });
  });
}

function renderOneAdaptPage(pdf, pageNum) {
  return pdf.getPage(pageNum).then(function (page) {
    var viewport = page.getViewport({ scale: 1.4 });
    var pageEl = document.createElement("div");
    pageEl.className = "adapt-pdf-page";
    pageEl.style.width = viewport.width + "px";
    pageEl.style.aspectRatio = (viewport.width / viewport.height).toFixed(4);
    pageEl.setAttribute("data-page", String(pageNum));

    var canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    pageEl.appendChild(canvas);

    var overlay = document.createElement("div");
    overlay.className = "adapt-pdf-overlay";
    pageEl.appendChild(overlay);

    var stage = document.getElementById("adapt-pdf-stage");
    var root = document.getElementById("adapt-pdf-pages-root");
    if (!root) return;
    root.appendChild(pageEl);

    var ctx = canvas.getContext("2d");
    return page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function () {
      return page.getTextContent();
    }).then(function (tc) {
      var items = tc.items || [];
      var flatChars = [];
      var pageText = "";
      var prevY = null;
      for (var idx = 0; idx < items.length; idx++) {
        var it = items[idx];
        var s = String(it.str || "");
        if (!s) continue;
        var ty = it.transform && it.transform[5];
        if (prevY !== null && Math.abs(ty - prevY) > 1.5) {
          flatChars.push({ ch: "\n", itemIdx: -1, charInItem: 0 });
          pageText += "\n";
        }
        prevY = ty;
        for (var c = 0; c < s.length; c++) {
          flatChars.push({ ch: s[c], itemIdx: idx, charInItem: c });
          pageText += s[c];
        }
      }
      return {
        pageNum: pageNum,
        viewport: viewport,
        items: items,
        flatChars: flatChars,
        pageText: pageText,
        pageEl: pageEl,
        overlay: overlay,
        width: viewport.width,
        height: viewport.height
      };
    });
  });
}

function runResumeDiff() {
  if (adaptInFlight) return;
  adaptInFlight = true;

  // 透视卡缓存里若有 gaps，一起带给后端，建议会更精准
  var gaps = [];
  try {
    var cacheKey = adaptState.card && (adaptState.card.idHash || (adaptState.card.title + "|" + adaptState.card.company));
    if (cacheKey && perspectiveCache && perspectiveCache[cacheKey] && perspectiveCache[cacheKey].result) {
      gaps = perspectiveCache[cacheKey].result.gaps || [];
    }
  } catch (e) {}

  // PDF 模式：用 PDF 实际文本流作为锚定底本，否则用粘贴文本
  var resumeForAI =
    (adaptState.mode === "pdf" && adaptState.pdfText && adaptState.pdfText.length > 60)
      ? adaptState.pdfText
      : adaptState.resume;

  chrome.runtime.sendMessage(
    {
      action: "AI_RESUME_DIFF",
      resume: resumeForAI,
      jd: adaptState.jd || "",
      gaps: gaps,
      card: adaptState.card || {}
    },
    function (resp) {
      adaptInFlight = false;
      if (!resp || !resp.ok || !resp.result) {
        var err = (resp && resp.error) || "AI 未返回结果";
        showAdaptError(err);
        return;
      }
      var result = resp.result;
      adaptState.editStates = {};
      adaptState.editCustom = {};
      adaptState.editLocations = {};
      adaptState.floatingTips = result.floatingTips || [];

      var regen = document.getElementById("btn-adapt-regenerate");
      if (regen) regen.style.display = "inline-block";

      if (adaptState.mode === "pdf") {
        var verified = [];
        var dropped = [];
        var rawEdits = result.edits || [];
        for (var i = 0; i < rawEdits.length; i++) {
          var e = rawEdits[i];
          if (!e || !e.before || !e.after) continue;
          var loc = locateInPdf(e.before, e.anchor);
          if (!loc) {
            if (typeof console !== "undefined" && console.debug) {
              var b0 = String(e.before || "").replace(/\s+/g, " ").trim();
              var a0 = String(e.anchor || "").replace(/\s+/g, " ").trim();
              console.debug(
                "[jobflow] locateInPdf miss beforeLen=" + b0.length +
                " anchorLen=" + a0.length +
                " beforeHead=" + JSON.stringify(b0.slice(0, 48)) +
                " anchorHead=" + JSON.stringify(a0.slice(0, 48))
              );
            }
            dropped.push(e);
            continue;
          }
          var edt = {
            id: e.id || "ed" + i,
            anchor: e.anchor || e.before,
            before: e.before,
            after: e.after,
            reason: e.reason || ""
          };
          verified.push(edt);
          adaptState.editLocations[edt.id] = loc;
          adaptState.editStates[edt.id] = "pending";
        }
        adaptState.edits = verified;
        // 没法定位的提示 fallback 进 floatingTips
        for (var d = 0; d < dropped.length && adaptState.floatingTips.length < 10; d++) {
          adaptState.floatingTips.push("AI 想改：" + (dropped[d].before || "") + " → " + (dropped[d].after || ""));
        }
        if (!verified.length && !adaptState.floatingTips.length) {
          showAdaptError("AI 没有给出可在 PDF 上定位的建议，可点「重新生成」再试。");
          return;
        }
        renderPdfAnnotations();
        renderSuggestList();
        renderFloatingTipsPdf();
        updateAdaptStatusPill();
        showAdaptState("adapt-mode-pdf");
      } else {
        // 文本模式（兜底）
        adaptState.edits = computeEditPositions(adaptState.resume, result.edits || []);
        for (var j = 0; j < adaptState.edits.length; j++) {
          adaptState.editStates[adaptState.edits[j].id] = "pending";
        }
        if (!adaptState.edits.length && !adaptState.floatingTips.length) {
          showAdaptError("AI 没有给出可定位的建议，可点「重新生成」再试。");
          return;
        }
        renderRedline();
        renderFloatingTips();
        updateAdaptStatusPill();
        showAdaptState("adapt-mode-text");
      }
    }
  );
}

// ===== 把 AI 给的 before/anchor 在 PDF 里找位置 =====
// 返回 { pageIdx, rects[] } 或 null。多级 fallback：
//   1) 单页 exact
//   2) 全局 pdfText + anchor（与 background 校验路径一致，最可靠）
//   3) 单页去空白
//   4) 单页归一化（去空白 + 全半角 + 标点统一）
//   5) anchor 归一化兜底

var JF_PUNCT_MAP = {
  "，": ",", "。": ".", "、": ",", "；": ";", "：": ":",
  "（": "(", "）": ")", "【": "[", "】": "]",
  "“": "\"", "”": "\"", "‘": "'", "’": "'",
  "—": "-", "–": "-", "·": "."
};

function jfNormalizeForMatch(s) {
  s = String(s || "");
  var out = "";
  for (var i = 0; i < s.length; i++) {
    var ch = s.charAt(i);
    var code = s.charCodeAt(i);
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" ||
        code === 0x3000 || code === 0x00A0) {
      continue;
    }
    if (code >= 0xFF01 && code <= 0xFF5E) {
      ch = String.fromCharCode(code - 0xFEE0);
    }
    if (JF_PUNCT_MAP[ch]) ch = JF_PUNCT_MAP[ch];
    out += ch.toLowerCase();
  }
  return out;
}

function jfBuildPageNormIndex(pg) {
  if (pg._normText != null) return;
  var s = "";
  var map = [];
  for (var i = 0; i < pg.flatChars.length; i++) {
    var n = jfNormalizeForMatch(pg.flatChars[i].ch);
    if (!n) continue;
    s += n;
    map.push(i);
  }
  pg._normText = s;
  pg._normMap = map;
}

function jfPageRangeFromGlobalOffset(absStart, absEnd) {
  var pages = adaptState.pdfPages;
  for (var p = 0; p < pages.length; p++) {
    var pg = pages[p];
    var gs = pg.globalOffset || 0;
    var ge = gs + pg.pageText.length;
    if (absStart >= gs && absStart < ge) {
      var s = absStart - gs;
      var e = Math.min(absEnd - gs, pg.pageText.length);
      if (e <= s) e = s + 1;
      return { pageIdx: p, startInPage: s, endInPage: e };
    }
  }
  return null;
}

function locateInPdf(before, anchor) {
  if (!before || !adaptState.pdfPages.length) return null;

  // 1) 单页 exact
  for (var p = 0; p < adaptState.pdfPages.length; p++) {
    var pg = adaptState.pdfPages[p];
    var idx = pg.pageText.indexOf(before);
    if (idx >= 0) {
      var chars = pg.flatChars.slice(idx, idx + before.length);
      return { pageIdx: p, rects: aggregateRectsForChars(chars, pg) };
    }
  }

  // 2) 全局 pdfText + anchor（背后端校验过 anchor 在 pdfText 里有；before 在 anchor 内）
  if (anchor && adaptState.pdfText) {
    var aIdx = adaptState.pdfText.indexOf(anchor);
    if (aIdx >= 0) {
      var bInAnchor = anchor.indexOf(before);
      if (bInAnchor < 0 && before === anchor) bInAnchor = 0;
      if (bInAnchor >= 0) {
        var absStart = aIdx + bInAnchor;
        var absEnd = absStart + before.length;
        var pi = jfPageRangeFromGlobalOffset(absStart, absEnd);
        if (pi) {
          var pgA = adaptState.pdfPages[pi.pageIdx];
          var charsA = pgA.flatChars.slice(pi.startInPage, pi.endInPage);
          if (charsA.length) {
            return { pageIdx: pi.pageIdx, rects: aggregateRectsForChars(charsA, pgA) };
          }
        }
      }
    }
  }

  // 3) 单页去空白
  var stripped = before.replace(/\s+/g, "");
  if (stripped.length >= 4) {
    for (var q = 0; q < adaptState.pdfPages.length; q++) {
      var pg2 = adaptState.pdfPages[q];
      var stripText = pg2.pageText.replace(/\s+/g, "");
      var k = stripText.indexOf(stripped);
      if (k < 0) continue;
      var nonSpaceCount = 0;
      var realStart = -1, realEnd = -1;
      for (var c = 0; c < pg2.flatChars.length; c++) {
        var ch = pg2.flatChars[c].ch;
        if (ch && !/\s/.test(ch)) {
          if (nonSpaceCount === k) realStart = c;
          if (nonSpaceCount === k + stripped.length - 1) { realEnd = c + 1; break; }
          nonSpaceCount++;
        }
      }
      if (realStart >= 0 && realEnd > realStart) {
        var chars2 = pg2.flatChars.slice(realStart, realEnd);
        return { pageIdx: q, rects: aggregateRectsForChars(chars2, pg2) };
      }
    }
  }

  // 4) 单页归一化（去空白 + 全半角 + 标点统一）
  var normBefore = jfNormalizeForMatch(before);
  if (normBefore.length >= 3) {
    for (var n = 0; n < adaptState.pdfPages.length; n++) {
      var pg3 = adaptState.pdfPages[n];
      jfBuildPageNormIndex(pg3);
      var i3 = pg3._normText.indexOf(normBefore);
      if (i3 < 0) continue;
      var startFlat = pg3._normMap[i3];
      var endFlat = pg3._normMap[i3 + normBefore.length - 1] + 1;
      var chars3 = pg3.flatChars.slice(startFlat, endFlat);
      return { pageIdx: n, rects: aggregateRectsForChars(chars3, pg3) };
    }
  }

  // 5) anchor 归一化兜底
  if (anchor) {
    var normAnchor = jfNormalizeForMatch(anchor);
    if (normAnchor.length >= 3 && normBefore.length >= 2) {
      for (var n2 = 0; n2 < adaptState.pdfPages.length; n2++) {
        var pg4 = adaptState.pdfPages[n2];
        jfBuildPageNormIndex(pg4);
        var ai = pg4._normText.indexOf(normAnchor);
        if (ai < 0) continue;
        var bi = normAnchor.indexOf(normBefore);
        if (bi < 0) bi = 0;
        var absS = ai + bi;
        var absE = absS + normBefore.length;
        if (absS >= 0 && absE > absS && absE <= pg4._normMap.length) {
          var startFlat2 = pg4._normMap[absS];
          var endFlat2 = pg4._normMap[absE - 1] + 1;
          var chars4 = pg4.flatChars.slice(startFlat2, endFlat2);
          return { pageIdx: n2, rects: aggregateRectsForChars(chars4, pg4) };
        }
      }
    }
  }

  return null;
}

function aggregateRectsForChars(chars, pg) {
  // 把同一个 item 内的连续字符合并成一个矩形
  var groups = [];
  var cur = null;
  for (var i = 0; i < chars.length; i++) {
    var c = chars[i];
    if (c.itemIdx === -1) { cur = null; continue; }
    if (!cur || cur.itemIdx !== c.itemIdx || cur.endChar !== c.charInItem) {
      cur = { itemIdx: c.itemIdx, startChar: c.charInItem, endChar: c.charInItem + 1 };
      groups.push(cur);
    } else {
      cur.endChar = c.charInItem + 1;
    }
  }
  var rects = [];
  for (var g = 0; g < groups.length; g++) {
    var gr = groups[g];
    var item = pg.items[gr.itemIdx];
    if (!item) continue;
    var tx = pdfjsLib.Util.transform(pg.viewport.transform, item.transform);
    var screenLeft = tx[4];
    var baselineY = tx[5];
    var screenWidth = (item.width || 0) * pg.viewport.scale;
    var fontH = Math.hypot(tx[2] || 0, tx[3] || 0);
    if (!fontH) fontH = (item.height || 12) * pg.viewport.scale;
    var perCharW = item.str && item.str.length > 0 ? screenWidth / item.str.length : screenWidth;
    var left = screenLeft + perCharW * gr.startChar;
    var width = perCharW * (gr.endChar - gr.startChar);
    var top = baselineY - fontH;
    rects.push({ left: left, top: top, width: width, height: fontH });
  }
  return rects;
}

function renderPdfAnnotations() {
  // 清空所有 overlay
  for (var p = 0; p < adaptState.pdfPages.length; p++) {
    var ov = adaptState.pdfPages[p].overlay;
    if (ov) ov.innerHTML = "";
  }
  // 逐条画
  for (var i = 0; i < adaptState.edits.length; i++) {
    drawOneAnnotation(i);
  }
}

function drawOneAnnotation(editIdx) {
  var ed = adaptState.edits[editIdx];
  if (!ed) return;
  var loc = adaptState.editLocations[ed.id];
  if (!loc) return;
  var pg = adaptState.pdfPages[loc.pageIdx];
  if (!pg) return;
  var overlay = pg.overlay;
  var st = adaptState.editStates[ed.id] || "pending";
  var stClass = st === "accepted" ? " is-accepted" : st === "rejected" ? " is-rejected" : "";

  // 删除线
  for (var r = 0; r < loc.rects.length; r++) {
    var rect = loc.rects[r];
    var strike = document.createElement("div");
    strike.className = "anno-strike" + stClass;
    strike.setAttribute("data-edit-id", ed.id);
    strike.style.left = (rect.left / pg.width * 100) + "%";
    strike.style.top = ((rect.top + rect.height * 0.55) / pg.height * 100) + "%";
    strike.style.width = (rect.width / pg.width * 100) + "%";
    overlay.appendChild(strike);
  }
  // 编号气泡：贴在最后一段矩形的右上
  var last = loc.rects[loc.rects.length - 1];
  if (last) {
    var bubble = document.createElement("div");
    bubble.className = "anno-bubble" + stClass;
    bubble.setAttribute("data-edit-id", ed.id);
    bubble.textContent = String(editIdx + 1);
    bubble.style.left = ((last.left + last.width + 6) / pg.width * 100) + "%";
    bubble.style.top = ((last.top + last.height * 0.5) / pg.height * 100) + "%";
    bubble.addEventListener("click", function () {
      focusSuggestion(this.getAttribute("data-edit-id"));
    });
    overlay.appendChild(bubble);
  }
}

function renderSuggestList() {
  var list = document.getElementById("adapt-suggest-list");
  var countEl = document.getElementById("adapt-suggest-count");
  if (!list) return;
  var edits = adaptState.edits;
  if (countEl) countEl.textContent = edits.length ? "共 " + edits.length + " 条" : "";
  if (!edits.length) {
    list.innerHTML = '<p style="font-size:11px;color:var(--text4);text-align:center;padding:12px;">AI 暂未给出可定位的修改。</p>';
    return;
  }
  var html = "";
  for (var i = 0; i < edits.length; i++) {
    var ed = edits[i];
    var st = adaptState.editStates[ed.id] || "pending";
    var afterShown = adaptState.editCustom[ed.id] != null ? adaptState.editCustom[ed.id] : ed.after;
    var itemCls = "adapt-suggest-item";
    if (st === "accepted") itemCls += " is-accepted";
    else if (st === "rejected") itemCls += " is-rejected";
    var numCls = "adapt-suggest-num";
    if (st === "accepted") numCls += " is-accepted";
    else if (st === "rejected") numCls += " is-rejected";

    html +=
      '<div class="' + itemCls + '" data-edit-id="' + ed.id + '">' +
        '<div class="adapt-suggest-head-row">' +
          '<span class="' + numCls + '" data-edit-id="' + ed.id + '" data-act="locate">' + (i + 1) + '</span>' +
          '<div class="adapt-suggest-quote">' +
            '<span class="q-before">' + escapeHtmlForRedline(ed.before) + '</span>' +
            '<span class="q-after">' + escapeHtmlForRedline(afterShown) + '</span>' +
          '</div>' +
        '</div>' +
        (ed.reason ? '<p class="adapt-suggest-reason">' + escapeHtmlForRedline(ed.reason) + '</p>' : '') +
        '<div class="adapt-suggest-btns" data-edit-id="' + ed.id + '">' +
          '<button data-act="locate" class="sg-locate">📍 跳转</button>' +
          '<button data-act="accept" class="sg-accept ' + (st === "accepted" ? "is-on" : "") + '">✓ 接受</button>' +
          '<button data-act="reject" class="sg-reject ' + (st === "rejected" ? "is-on" : "") + '">✗ 忽略</button>' +
          '<button data-act="custom" class="sg-custom">✎ 自定义</button>' +
        '</div>' +
      '</div>';
  }
  list.innerHTML = html;
  bindSuggestListActions(list);
}

function bindSuggestListActions(root) {
  // 编号本身也可点（locate）
  var nums = root.querySelectorAll(".adapt-suggest-num[data-act='locate']");
  for (var n = 0; n < nums.length; n++) {
    nums[n].addEventListener("click", function () {
      focusSuggestion(this.getAttribute("data-edit-id"));
    });
  }
  var btns = root.querySelectorAll(".adapt-suggest-btns button");
  for (var i = 0; i < btns.length; i++) {
    btns[i].addEventListener("click", function () {
      var act = this.getAttribute("data-act");
      var wrap = this.closest(".adapt-suggest-btns");
      var editId = wrap && wrap.getAttribute("data-edit-id");
      if (!editId) return;
      if (act === "locate") focusSuggestion(editId);
      else if (act === "accept") setPdfEditState(editId, "accepted");
      else if (act === "reject") setPdfEditState(editId, "rejected");
      else if (act === "custom") openPdfCustomEditor(editId);
    });
  }
}

function setPdfEditState(editId, newState) {
  adaptState.editStates[editId] = newState;
  // 同步刷新该条的 overlay 标记 + 清单项 + 编号气泡
  var allMarks = document.querySelectorAll('[data-edit-id="' + editId + '"]');
  for (var i = 0; i < allMarks.length; i++) {
    var el = allMarks[i];
    el.classList.remove("is-accepted", "is-rejected");
    if (newState === "accepted") el.classList.add("is-accepted");
    else if (newState === "rejected") el.classList.add("is-rejected");
  }
  // 重新渲染清单项以更新按钮高亮
  renderSuggestList();
  updateAdaptStatusPill();
  // 标记焦点项保持显眼
  focusSuggestion(editId, true);
}

function openPdfCustomEditor(editId) {
  var ed = null;
  for (var i = 0; i < adaptState.edits.length; i++) {
    if (adaptState.edits[i].id === editId) { ed = adaptState.edits[i]; break; }
  }
  if (!ed) return;
  var item = document.querySelector('.adapt-suggest-item[data-edit-id="' + editId + '"]');
  if (!item) return;
  // 移除旧的自定义区
  var oldCs = item.querySelector(".adapt-suggest-custom");
  if (oldCs) oldCs.remove();
  var current = adaptState.editCustom[editId] != null ? adaptState.editCustom[editId] : ed.after;
  var div = document.createElement("div");
  div.className = "adapt-suggest-custom";
  div.innerHTML =
    '<textarea class="cs-input">' + escapeHtmlForRedline(current) + '</textarea>' +
    '<div class="cs-btns">' +
      '<button class="sg-custom cs-ok">确认</button>' +
      '<button class="sg-reject cs-cancel">取消</button>' +
    '</div>';
  item.appendChild(div);
  var ta = div.querySelector(".cs-input");
  if (ta) ta.focus();
  div.querySelector(".cs-ok").addEventListener("click", function () {
    var v = (ta && ta.value || "").trim();
    if (!v) return;
    adaptState.editCustom[editId] = v;
    adaptState.editStates[editId] = "accepted";
    renderSuggestList();
    updateAdaptStatusPill();
  });
  div.querySelector(".cs-cancel").addEventListener("click", function () {
    div.remove();
  });
}

function focusSuggestion(editId, forceClassOnly) {
  if (!editId) return;
  // 清单项高亮
  var items = document.querySelectorAll(".adapt-suggest-item");
  for (var i = 0; i < items.length; i++) {
    items[i].classList.toggle("is-focus", items[i].getAttribute("data-edit-id") === editId);
  }
  var bubbles = document.querySelectorAll(".adapt-pdf-overlay .anno-bubble");
  for (var b = 0; b < bubbles.length; b++) {
    bubbles[b].classList.toggle("is-focus", bubbles[b].getAttribute("data-edit-id") === editId);
  }
  if (forceClassOnly) return;
  // 滚动到对应 PDF 位置
  var loc = adaptState.editLocations[editId];
  if (loc) {
    var pg = adaptState.pdfPages[loc.pageIdx];
    if (pg && pg.pageEl) {
      pg.pageEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }
  // 滚动到对应清单项
  var item = document.querySelector('.adapt-suggest-item[data-edit-id="' + editId + '"]');
  if (item) item.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function renderFloatingTipsPdf() {
  var wrap = document.getElementById("adapt-floating-tips-pdf");
  var list = document.getElementById("adapt-floating-list-pdf");
  if (!wrap || !list) return;
  var tips = adaptState.floatingTips || [];
  if (!tips.length) {
    wrap.style.display = "none";
    return;
  }
  list.innerHTML = tips.map(function (t) {
    return "<li>" + escapeHtmlForRedline(t) + "</li>";
  }).join("");
  wrap.style.display = "block";
}

// ========== 导出批注版 PDF（pdf-lib 在原稿上叠矢量批注 + 中文说明 PNG 页）==========

function wrapLineToWidth(ctx, text, maxW) {
  text = String(text || "");
  if (!text) return [""];
  var lines = [];
  var cur = "";
  for (var i = 0; i < text.length; i++) {
    var ch = text.charAt(i);
    var test = cur + ch;
    if (ctx.measureText(test).width > maxW && cur) {
      lines.push(cur);
      cur = ch;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function canvasToPngBytes(canvas) {
  return new Promise(function (resolve, reject) {
    try {
      canvas.toBlob(
        function (blob) {
          if (!blob) {
            reject(new Error("canvas.toBlob 失败"));
            return;
          }
          var fr = new FileReader();
          fr.onload = function () {
            resolve(new Uint8Array(fr.result));
          };
          fr.onerror = function () {
            reject(new Error("读取 PNG 失败"));
          };
          fr.readAsArrayBuffer(blob);
        },
        "image/png",
        0.92
      );
    } catch (e) {
      reject(e);
    }
  });
}

function viewportPointToPdf(viewport, vx, vy) {
  if (viewport && typeof viewport.convertToPdfPoint === "function") {
    return viewport.convertToPdfPoint(vx, vy);
  }
  try {
    var inv = pdfjsLib.Util.inverseTransform(viewport.transform);
    return pdfjsLib.Util.applyTransform([vx, vy], inv);
  } catch (e2) {
    return [vx, vy];
  }
}

function strikeColorForPdf(st) {
  if (st === "accepted") return PDFLib.rgb(0.145, 0.388, 0.922);
  if (st === "rejected") return PDFLib.rgb(0.66, 0.64, 0.62);
  return PDFLib.rgb(0.76, 0.25, 0.05);
}

function buildSummarySourceLines() {
  var lines = [];
  lines.push("Job Copilot · AI 修订建议说明（与 PDF 内编号一致）");
  lines.push("");
  lines.push(
    "岗位：" +
      (adaptState.card && adaptState.card.title ? adaptState.card.title : "") +
      "    " +
      (adaptState.card && adaptState.card.company ? adaptState.card.company : "")
  );
  lines.push("导出时间：" + new Date().toLocaleString("zh-CN"));
  lines.push("");
  var edits = adaptState.edits || [];
  for (var i = 0; i < edits.length; i++) {
    var ed = edits[i];
    var st = adaptState.editStates[ed.id] || "pending";
    var stZh = st === "accepted" ? "已采纳" : st === "rejected" ? "已忽略" : "待定";
    var afterShown = adaptState.editCustom[ed.id] != null ? adaptState.editCustom[ed.id] : ed.after;
    lines.push("【" + (i + 1) + "】 " + stZh);
    lines.push("  原文：" + ed.before);
    lines.push("  建议：" + afterShown);
    if (ed.reason) lines.push("  理由：" + ed.reason);
    lines.push("");
  }
  var tips = adaptState.floatingTips || [];
  if (tips.length) {
    lines.push("—— 未在版心精确定位的补充建议 ——");
    for (var t = 0; t < tips.length; t++) {
      lines.push("· " + tips[t]);
    }
  }
  return lines;
}

function rasterizeSummaryToPngPages() {
  var W = 560;
  var H = 780;
  var margin = 22;
  var lineH = 18;
  var maxTextW = W - margin * 2;

  var canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  var ctx = canvas.getContext("2d");
  ctx.font = '12px "Microsoft YaHei","PingFang SC","Segoe UI",sans-serif';

  var flat = [];
  var src = buildSummarySourceLines();
  for (var s = 0; s < src.length; s++) {
    var wrapped = wrapLineToWidth(ctx, src[s], maxTextW);
    for (var w = 0; w < wrapped.length; w++) flat.push(wrapped[w]);
  }

  var pages = [];
  var y = margin;

  function fillWhite() {
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#1C1917";
    ctx.font = '12px "Microsoft YaHei","PingFang SC","Segoe UI",sans-serif';
  }

  fillWhite();

  for (var i = 0; i < flat.length; i++) {
    if (y + lineH > H - margin) {
      pages.push(canvas);
      canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      ctx = canvas.getContext("2d");
      fillWhite();
      y = margin;
      ctx.fillText("（续页）", margin, y);
      y += lineH + 4;
    }
    ctx.fillText(flat[i], margin, y);
    y += lineH;
  }
  pages.push(canvas);

  return pages.reduce(function (p, cv) {
    return p.then(function (arr) {
      return canvasToPngBytes(cv).then(function (bytes) {
        arr.push(bytes);
        return arr;
      });
    });
  }, Promise.resolve([]));
}

function exportAdaptAnnotatedPdf() {
  if (typeof PDFLib === "undefined") {
    alert("pdf-lib 未加载。请确认 lib/pdf-lib.min.js 存在并已重新加载扩展。");
    return;
  }
  if (adaptState.mode !== "pdf") {
    alert("仅在「原 PDF 批注」模式下可导出批注版。");
    return;
  }
  if (!adaptState.edits || !adaptState.edits.length) {
    alert("当前没有已定位的修改点，无法导出。");
    return;
  }

  var btn = document.getElementById("btn-export-annotated-pdf");
  var oldTxt = btn ? btn.textContent : "导出批注版 PDF";
  if (btn) {
    btn.disabled = true;
    btn.textContent = "正在生成…";
  }

  var bufPromise = adaptState.pdfBuffer
    ? Promise.resolve(adaptState.pdfBuffer)
    : loadStoredResumePdfBuffer();

  bufPromise
    .then(function (buf) {
      if (!buf) {
        throw new Error("找不到已保存的简历 PDF，请重新上传 PDF 后再试。");
      }
      var u8;
      if (buf instanceof ArrayBuffer) {
        u8 = new Uint8Array(buf);
      } else if (buf && buf.buffer) {
        u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      } else {
        u8 = new Uint8Array(buf);
      }
      return PDFLib.PDFDocument.load(u8);
    })
    .then(function (pdfDoc) {
      return pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaBold).then(function (font) {
        return { pdfDoc: pdfDoc, font: font };
      });
    })
    .then(function (ctx) {
      var pdfDoc = ctx.pdfDoc;
      var font = ctx.font;
      var rgb = PDFLib.rgb;

      for (var ei = 0; ei < adaptState.edits.length; ei++) {
        var ed = adaptState.edits[ei];
        var loc = adaptState.editLocations[ed.id];
        if (!loc) continue;
        var pg = adaptState.pdfPages[loc.pageIdx];
        if (!pg || !pg.viewport) continue;
        var st = adaptState.editStates[ed.id] || "pending";
        var vp = pg.viewport;
        var page = pdfDoc.getPage(loc.pageIdx);
        var stroke = strikeColorForPdf(st);

        for (var r = 0; r < loc.rects.length; r++) {
          var rect = loc.rects[r];
          var vy = rect.top + rect.height * 0.55;
          var p1 = viewportPointToPdf(vp, rect.left, vy);
          var p2 = viewportPointToPdf(vp, rect.left + rect.width, vy);
          page.drawLine({
            start: { x: p1[0], y: p1[1] },
            end: { x: p2[0], y: p2[1] },
            thickness: 1.2,
            color: stroke,
            opacity: st === "rejected" ? 0.45 : 1
          });
        }

        var last = loc.rects[loc.rects.length - 1];
        if (last) {
          var bx = last.left + last.width + 6;
          var by = last.top + last.height * 0.5;
          var pc = viewportPointToPdf(vp, bx, by);
          var bubbleColor = strikeColorForPdf(st);
          page.drawCircle({
            x: pc[0],
            y: pc[1],
            size: 5.5,
            color: bubbleColor,
            borderColor: rgb(1, 1, 1),
            borderWidth: 0.35
          });
          var label = String(ei + 1);
          var tw = font.widthOfTextAtSize(label, 7);
          page.drawText(label, {
            x: pc[0] - tw / 2,
            y: pc[1] - 2.5,
            size: 7,
            font: font,
            color: rgb(1, 1, 1)
          });
        }
      }

      return rasterizeSummaryToPngPages().then(function (pngPages) {
        var chain = Promise.resolve();
        for (var p = 0; p < pngPages.length; p++) {
          (function (pngBytes) {
            chain = chain.then(function () {
              return pdfDoc.embedPng(pngBytes);
            }).then(function (img) {
              var pw = 595;
              var ph = 842;
              var page2 = pdfDoc.addPage([pw, ph]);
              var iw = pw - 40;
              var ih = (img.height * iw) / img.width;
              var drawH = ih > ph - 40 ? ph - 40 : ih;
              var drawW = ih > ph - 40 ? (img.width * drawH) / img.height : iw;
              page2.drawImage(img, {
                x: 20,
                y: ph - drawH - 20,
                width: drawW,
                height: drawH
              });
            });
          })(pngPages[p]);
        }
        return chain.then(function () {
          return pdfDoc.save();
        });
      });
    })
    .then(function (bytes) {
      var blob = new Blob([bytes], { type: "application/pdf" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download =
        "简历-批注-" +
        ((adaptState.card && adaptState.card.title) || "导出")
          .replace(/[\\/:*?"<>|]/g, "_")
          .slice(0, 40) +
        ".pdf";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 4000);
    })
    .catch(function (err) {
      console.error("[jobflow] export annotated pdf", err);
      alert("导出失败：" + (err && err.message ? err.message : String(err)));
    })
    .then(function () {
      if (btn) {
        btn.disabled = false;
        btn.textContent = oldTxt || "导出批注版 PDF";
      }
    });
}

function showAdaptError(msg) {
  showAdaptState("adapt-error");
  var box = document.getElementById("adapt-error");
  if (box) {
    var p = box.querySelector("p");
    if (p) p.textContent = msg;
  }
}

// 把每个 edit 的 anchor 在原文中的位置算出来；before 在 anchor 内的偏移也算出来
function computeEditPositions(resume, rawEdits) {
  var out = [];
  for (var i = 0; i < rawEdits.length; i++) {
    var e = rawEdits[i];
    if (!e || !e.anchor || !e.before || !e.after) continue;
    var anchorStart = resume.indexOf(e.anchor);
    if (anchorStart === -1) continue;
    var beforeOffsetInAnchor = e.anchor.indexOf(e.before);
    if (beforeOffsetInAnchor === -1) {
      // before == anchor 的情况
      if (e.before === e.anchor) {
        beforeOffsetInAnchor = 0;
      } else {
        continue;
      }
    }
    var absStart = anchorStart + beforeOffsetInAnchor;
    var absEnd = absStart + e.before.length;
    out.push({
      id: e.id || "ed" + i,
      anchor: e.anchor,
      before: e.before,
      after: e.after,
      reason: e.reason || "",
      absStart: absStart,
      absEnd: absEnd
    });
  }
  // 按起点排序，并丢弃区间重叠的后者
  out.sort(function (a, b) { return a.absStart - b.absStart; });
  var deduped = [];
  var lastEnd = -1;
  for (var k = 0; k < out.length; k++) {
    if (out[k].absStart >= lastEnd) {
      deduped.push(out[k]);
      lastEnd = out[k].absEnd;
    }
  }
  return deduped;
}

function renderRedline() {
  var box = document.getElementById("adapt-redline");
  if (!box) return;
  var resume = adaptState.resume;
  var edits = adaptState.edits;

  var pieces = [];
  var cursor = 0;
  for (var i = 0; i < edits.length; i++) {
    var ed = edits[i];
    if (ed.absStart > cursor) {
      pieces.push(escapeHtmlForRedline(resume.substring(cursor, ed.absStart)));
    }
    var st = adaptState.editStates[ed.id] || "pending";
    var stClass = st === "accepted" ? "is-accepted" : st === "rejected" ? "is-rejected" : "";
    var afterShown = adaptState.editCustom[ed.id] != null ? adaptState.editCustom[ed.id] : ed.after;

    var editHtml =
      '<span class="rl-edit ' + stClass + '" data-edit-id="' + ed.id + '">' +
        '<del class="rl-del">' + escapeHtmlForRedline(ed.before) + '</del>' +
        '<ins class="rl-ins" data-edit-id="' + ed.id + '">' + escapeHtmlForRedline(afterShown) + '</ins>' +
      '</span>';
    pieces.push(editHtml);

    var stateLabel =
      st === "accepted" ? '<span class="rl-state-label">✓ 已采纳</span>' :
      st === "rejected" ? '<span class="rl-state-label">✗ 已忽略</span>' :
      '<span class="rl-state-label">待定</span>';

    var actionsHtml =
      '<span class="rl-actions" data-edit-id="' + ed.id + '">' +
        (ed.reason ? '<em class="rl-reason">' + escapeHtmlForRedline(ed.reason) + '</em>' : '') +
        '<span class="rl-btns">' +
          '<button class="rl-accept ' + (st === "accepted" ? "rl-is-on" : "") + '" data-act="accept">✓ 接受</button>' +
          '<button class="rl-reject ' + (st === "rejected" ? "rl-is-on" : "") + '" data-act="reject">✗ 忽略</button>' +
          '<button class="rl-custom" data-act="custom">✎ 自定义</button>' +
          stateLabel +
        '</span>' +
      '</span>';
    pieces.push(actionsHtml);

    cursor = ed.absEnd;
  }
  if (cursor < resume.length) {
    pieces.push(escapeHtmlForRedline(resume.substring(cursor)));
  }
  box.innerHTML = pieces.join("");
  bindRedlineActions(box);
}

function bindRedlineActions(box) {
  var btns = box.querySelectorAll(".rl-actions button");
  for (var i = 0; i < btns.length; i++) {
    btns[i].addEventListener("click", function () {
      var act = this.getAttribute("data-act");
      var actionsEl = this.closest(".rl-actions");
      if (!actionsEl) return;
      var editId = actionsEl.getAttribute("data-edit-id");
      if (!editId) return;
      if (act === "accept") setEditState(editId, "accepted");
      else if (act === "reject") setEditState(editId, "rejected");
      else if (act === "custom") openCustomEditor(editId, actionsEl);
    });
  }
}

function setEditState(editId, newState) {
  adaptState.editStates[editId] = newState;
  // 找到对应 rl-edit 节点，切换 class
  var editEl = document.querySelector('.rl-edit[data-edit-id="' + editId + '"]');
  if (editEl) {
    editEl.classList.remove("is-accepted", "is-rejected");
    if (newState === "accepted") editEl.classList.add("is-accepted");
    else if (newState === "rejected") editEl.classList.add("is-rejected");
  }
  // 更新操作条上的按钮高亮 + state label
  var actionsEl = document.querySelector('.rl-actions[data-edit-id="' + editId + '"]');
  if (actionsEl) {
    var aBtn = actionsEl.querySelector(".rl-accept");
    var rBtn = actionsEl.querySelector(".rl-reject");
    if (aBtn) aBtn.classList.toggle("rl-is-on", newState === "accepted");
    if (rBtn) rBtn.classList.toggle("rl-is-on", newState === "rejected");
    var lab = actionsEl.querySelector(".rl-state-label");
    if (lab) {
      lab.textContent =
        newState === "accepted" ? "✓ 已采纳" :
        newState === "rejected" ? "✗ 已忽略" : "待定";
    }
  }
  updateAdaptStatusPill();
}

function openCustomEditor(editId, actionsEl) {
  // 复用 actionsEl 容器：暂时替换为输入框 + 确认/取消
  var ed = null;
  for (var i = 0; i < adaptState.edits.length; i++) {
    if (adaptState.edits[i].id === editId) { ed = adaptState.edits[i]; break; }
  }
  if (!ed) return;
  var currentAfter = adaptState.editCustom[editId] != null ? adaptState.editCustom[editId] : ed.after;

  actionsEl.innerHTML =
    '<div class="rl-custom-row">' +
      '<textarea class="rl-custom-input">' + escapeHtmlForRedline(currentAfter) + '</textarea>' +
      '<div class="rl-custom-btns">' +
        '<button class="rl-custom-ok">确认</button>' +
        '<button class="rl-custom-cancel">取消</button>' +
      '</div>' +
    '</div>';
  var ta = actionsEl.querySelector(".rl-custom-input");
  if (ta) ta.focus();
  actionsEl.querySelector(".rl-custom-ok").addEventListener("click", function () {
    var v = (ta && ta.value || "").trim();
    if (!v) return;
    adaptState.editCustom[editId] = v;
    adaptState.editStates[editId] = "accepted";
    renderRedline();
    updateAdaptStatusPill();
  });
  actionsEl.querySelector(".rl-custom-cancel").addEventListener("click", function () {
    renderRedline();
  });
}

function renderFloatingTips() {
  var wrap = document.getElementById("adapt-floating-tips");
  var list = document.getElementById("adapt-floating-list");
  if (!wrap || !list) return;
  var tips = adaptState.floatingTips || [];
  if (!tips.length) {
    wrap.style.display = "none";
    return;
  }
  list.innerHTML = tips.map(function (t) {
    return "<li>" + escapeHtmlForRedline(t) + "</li>";
  }).join("");
  wrap.style.display = "block";
}

// 把当前简历按 editStates 拼成「最终成稿」纯文本
function buildFinalResumeText() {
  var resume = adaptState.resume;
  var edits = adaptState.edits;
  var pieces = [];
  var cursor = 0;
  for (var i = 0; i < edits.length; i++) {
    var ed = edits[i];
    if (ed.absStart > cursor) {
      pieces.push(resume.substring(cursor, ed.absStart));
    }
    var st = adaptState.editStates[ed.id] || "pending";
    if (st === "accepted") {
      pieces.push(adaptState.editCustom[ed.id] != null ? adaptState.editCustom[ed.id] : ed.after);
    } else {
      pieces.push(ed.before);
    }
    cursor = ed.absEnd;
  }
  if (cursor < resume.length) pieces.push(resume.substring(cursor));
  return pieces.join("");
}

function exportResumeAsPdf() {
  var finalText = buildFinalResumeText();
  var jobLine = "";
  if (adaptState.card && adaptState.card.title) {
    jobLine = "适配岗位：" + adaptState.card.title;
    if (adaptState.card.company) jobLine += " @ " + adaptState.card.company;
  }
  var html =
    '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>简历 - ' +
    escapeHtmlForRedline((adaptState.card && adaptState.card.title) || "投递版本") +
    '</title>' +
    '<style>' +
    '@page { margin: 18mm 16mm; }' +
    'html, body { margin: 0; padding: 0; }' +
    'body { font-family: "Microsoft YaHei", "PingFang SC", "Inter", -apple-system, BlinkMacSystemFont, sans-serif; font-size: 11pt; line-height: 1.65; color: #1C1917; }' +
    '.head { font-size: 9pt; color: #888; margin-bottom: 10pt; }' +
    '.resume { white-space: pre-wrap; word-break: break-word; }' +
    '.print-btn { position: fixed; top: 16px; right: 16px; padding: 8px 18px; font-size: 13px; background: #3B82F6; color: #fff; border: 0; border-radius: 6px; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.15); }' +
    '@media print { .print-btn { display: none; } .head { display: none; } }' +
    '</style></head><body>' +
    (jobLine ? '<div class="head">' + escapeHtmlForRedline(jobLine) + '</div>' : '') +
    '<div class="resume">' + escapeHtmlForRedline(finalText) + '</div>' +
    '<button class="print-btn" onclick="window.print()">打印 / 另存为 PDF</button>' +
    '<script>setTimeout(function(){window.print();}, 350);</' + 'script>' +
    '</body></html>';

  // 在新窗口打开 → 自动弹出打印对话框 → 用户选「另存为 PDF」
  try {
    var w = window.open("", "_blank", "width=820,height=1000");
    if (!w) {
      alert("浏览器拦截了新窗口，请允许本扩展弹窗后重试");
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
  } catch (e) {
    alert("导出失败：" + (e && e.message));
  }
}

// ========== adapt 入口（来自透视卡） ==========
var jdpAdaptBtn = document.getElementById("btn-jdp-adapt");
if (jdpAdaptBtn) {
  jdpAdaptBtn.addEventListener("click", function () {
    if (!activeCardInfo) {
      alert("请先在 Boss 列表点开一个岗位");
      return;
    }
    var jdText = "";
    try {
      var key = activeCardInfo.idHash || (activeCardInfo.title + "|" + activeCardInfo.company);
      if (perspectiveCache[key] && perspectiveCache[key].jd != null) {
        jdText = perspectiveCache[key].jd;
      }
    } catch (e) {}
    enterAdaptMode(activeCardInfo, jdText);
  });
}

// 旧 perspective 状态的入口（兼容老 JD 流程）
var legacyAdaptBtn = document.getElementById("btn-adapt");
if (legacyAdaptBtn) {
  legacyAdaptBtn.addEventListener("click", function () {
    var card = activeCardInfo || (jdData ? { title: jdData.title || "未指定岗位" } : null);
    var jdText = (jdData && jdData.rawText) || "";
    enterAdaptMode(card, jdText);
  });
}

// 重新生成 / 重试
var btnRegen = document.getElementById("btn-adapt-regenerate");
if (btnRegen) {
  btnRegen.addEventListener("click", function () {
    if (adaptInFlight) return;
    btnRegen.style.display = "none";
    showAdaptState("adapt-loading");
    runResumeDiff();
  });
}
var btnAdaptRetry = document.getElementById("btn-adapt-retry");
if (btnAdaptRetry) {
  btnAdaptRetry.addEventListener("click", function () {
    if (adaptInFlight) return;
    showAdaptState("adapt-loading");
    runResumeDiff();
  });
}

var btnExportAnnotatedPdf = document.getElementById("btn-export-annotated-pdf");
if (btnExportAnnotatedPdf) {
  btnExportAnnotatedPdf.addEventListener("click", function () {
    exportAdaptAnnotatedPdf();
  });
}

var btnPdfZoomOut = document.getElementById("btn-adapt-pdf-zoom-out");
var btnPdfZoomFit = document.getElementById("btn-adapt-pdf-zoom-fit");
var btnPdfZoomIn = document.getElementById("btn-adapt-pdf-zoom-in");
if (btnPdfZoomOut) {
  btnPdfZoomOut.addEventListener("click", function () {
    if (!adaptState) return;
    var cur = typeof adaptState.pdfZoom === "number" && !isNaN(adaptState.pdfZoom) ? adaptState.pdfZoom : 0.55;
    adaptState.pdfZoom = clampAdaptPdfZoom(cur - 0.12);
    applyAdaptPdfZoom();
  });
}
if (btnPdfZoomFit) {
  btnPdfZoomFit.addEventListener("click", function () {
    fitAdaptPdfZoomToWidth();
  });
}
if (btnPdfZoomIn) {
  btnPdfZoomIn.addEventListener("click", function () {
    if (!adaptState) return;
    var cur = typeof adaptState.pdfZoom === "number" && !isNaN(adaptState.pdfZoom) ? adaptState.pdfZoom : 0.55;
    adaptState.pdfZoom = clampAdaptPdfZoom(cur + 0.12);
    applyAdaptPdfZoom();
  });
}

// 返回
var btnBackPersp = document.getElementById("btn-back-perspective");
if (btnBackPersp) {
  btnBackPersp.addEventListener("click", function () {
    // 优先回到 browsing（新流程主入口）
    switchState("browsing");
    refreshBrowseProfileUI();
  });
}

// 导出 PDF：本轮先不接入，UI 已经移除。函数 exportResumeAsPdf 暂时保留供下一轮使用。

// 旧 perspective 流程的视图原始 JD 按钮兼容（按钮存在就保留）
var btnViewJD = document.getElementById("btn-view-jd");
if (btnViewJD) {
  btnViewJD.addEventListener("click", function () {
    if (jdData && jdData.rawText) {
      alert("原始 JD：\n\n" + jdData.rawText.substring(0, 500));
    } else {
      alert("暂未捕获到 JD 原文");
    }
  });
}

var btnBackBrowsing = document.getElementById("btn-back-browsing");
if (btnBackBrowsing) {
  btnBackBrowsing.addEventListener("click", function () {
    switchState("browsing");
    refreshBrowseProfileUI();
    updateQuotaBar();
  });
}
