(function() {
  // ===== Bridge：保留消息桥（避免后续脚本异常导致消息丢失） =====
  if (!window.__jobCopilotBridgeReady) {
    window.__jobCopilotBridgeReady = true;
    window.__jobCopilotDispatch = function () {};
    chrome.runtime.onMessage.addListener(function (m, s, sr) {
      return window.__jobCopilotDispatch(m, s, sr);
    });
  }
  if (window.hasInjectedJobCopilot) return;
  window.hasInjectedJobCopilot = true;

  // ===== Globals =====
  var lastJDText = "";
  var activeCardEl = null;      // 最近一次被点击的卡片元素
  var activeIdHash = "";

  // ===== Utils =====
  function simpleHash(str) {
    var hash = 0;
    str = String(str || "");
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + c;
      hash |= 0;
    }
    return Math.abs(hash).toString(16);
  }

  function sortNodesByDocumentOrder(nodes) {
    return nodes.slice().sort(function (a, b) {
      var pos = a.compareDocumentPosition(b);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
  }

  // ===== 卡片识别（轻量版：用 a.job-name 反查） =====
  function getCards() {
    var out = [];
    var seen = new WeakSet();

    // 策略 1：列表容器直接子节点
    var LIST_CONTAINERS = [
      "ul.rec-job-list",
      ".rec-job-list",
      "[class*='rec-job-list']",
      ".job-list-box",
      "ul.job-list-box",
      ".search-job-result ul",
      ".job-list-container > ul",
      ".job-list > ul"
    ];
    for (var li = 0; li < LIST_CONTAINERS.length; li++) {
      var listEl = document.querySelector(LIST_CONTAINERS[li]);
      if (!listEl) continue;
      var ch = listEl.children;
      for (var ci = 0; ci < ch.length; ci++) {
        if (
          ch[ci].querySelector("a.job-name, a[class*='job-name'], a[href*='/job_detail/']") &&
          !seen.has(ch[ci])
        ) {
          seen.add(ch[ci]);
          out.push(ch[ci]);
        }
      }
      if (out.length >= 5) break;
    }

    // 策略 2：job-name 锚点向上反查
    var anchors = document.querySelectorAll("a.job-name, a[class*='job-name']");
    for (var ai = 0; ai < anchors.length; ai++) {
      var p = anchors[ai].parentElement;
      var depth = 0;
      var found = null;
      while (p && depth < 8 && p !== document.body) {
        if (p.querySelectorAll("a.job-name, a[class*='job-name']").length > 1) break;
        var r = p.getBoundingClientRect();
        if (r.height >= 60 && r.height <= 300 && r.width >= 150 && r.width <= 800) found = p;
        p = p.parentElement;
        depth++;
      }
      if (found && !seen.has(found)) {
        seen.add(found);
        out.push(found);
      }
    }

    return sortNodesByDocumentOrder(out);
  }

  function findCardForElement(el) {
    var cur = el;
    var depth = 0;
    while (cur && depth < 12 && cur !== document.body) {
      if (cur.querySelector && cur.querySelector("a.job-name, a[class*='job-name']")) {
        var r = cur.getBoundingClientRect();
        // 放宽容器尺寸限制：Boss 的卡片可能不同布局下宽度跨度较大
        var heightOk = r.height >= 50 && r.height <= 400;
        var widthOk = r.width >= 120 && r.width <= 1000;
        var anchorCount = cur.querySelectorAll("a.job-name, a[class*='job-name']").length;
        if (heightOk && widthOk && anchorCount === 1) {
          return cur;
        }
        // 多锚点 = 列表容器，立即停止上溯
        if (anchorCount > 1) break;
      }
      cur = cur.parentElement;
      depth++;
    }
    // 兜底：最后再上溯一次找最近的「包含 a.job-name 且只有 1 个」的容器
    cur = el;
    depth = 0;
    while (cur && depth < 12 && cur !== document.body) {
      if (
        cur.querySelector &&
        cur.querySelector("a.job-name, a[class*='job-name']") &&
        cur.querySelectorAll("a.job-name, a[class*='job-name']").length === 1
      ) {
        return cur;
      }
      cur = cur.parentElement;
      depth++;
    }
    return null;
  }

  /** 职位标题/薪资单行化 */
  function jfOneLine(s) {
    return String(s || "")
      .trim()
      .split(/\n+/)[0]
      .replace(/\s+/g, " ")
      .trim();
  }

  /** 去掉 Boss 列表里常见的内部编码、与详情区展示不一致的尾巴 */
  function sanitizeJobTitle(t) {
    t = jfOneLine(t);
    t = t.replace(/\s*[（(]\s*J\s*\d+\s*[）)]\s*$/i, "").trim();
    t = t.replace(/\s*[-–]\s*校招\s*\/\s*实习转正\s*$/i, "").trim();
    t = t.replace(/\s*[-–]\s*实习转正\s*$/i, "").trim();
    if (t.length > 100) t = t.substring(0, 100);
    return t;
  }

  function jobPathKey(href) {
    if (!href) return "";
    try {
      return new URL(href, window.location.origin).pathname.replace(/\/+$/, "");
    } catch (e) {
      return "";
    }
  }

  /**
   * 从 Boss 当前页「右侧/中间职位详情」头部读取展示用标题、薪资、公司（与列表内链文案可能不同）。
   */
  function extractLiveJobDetailHeader() {
    var rootSelectors = [
      ".job-detail-main .info-primary",
      ".job-detail-main",
      ".job-detail .info-primary",
      ".job-detail",
      ".job-detail-box .info-primary",
      ".job-detail-box",
      "[class*='job-detail'] .info-primary",
      "[class*='JobDetail'] .info-primary",
      "[class*='job-detail-header']",
      "main [class*='detail'] .info-primary"
    ];
    var ri;
    for (ri = 0; ri < rootSelectors.length; ri++) {
      var root = document.querySelector(rootSelectors[ri]);
      if (!root) continue;
      var r = root.getBoundingClientRect();
      if (r.width < 80) continue;

      var panel = root.closest(".job-detail-main") || root.closest(".job-detail") || root;
      var detailHref = "";
      var links = panel.querySelectorAll("a[href*='/job_detail/'], a[href*='job_detail']");
      var li;
      for (li = 0; li < links.length; li++) {
        try {
          var raw = links[li].getAttribute("href") || "";
          if (raw && raw.indexOf("javascript:") !== 0) {
            detailHref = new URL(raw, window.location.origin).href;
            break;
          }
        } catch (e1) {}
      }

      var title = "";
      var h1 = root.querySelector("h1");
      if (h1) title = jfOneLine(h1.innerText);
      if (!title) {
        var ne = root.querySelector(".name, .job-name, [class*='job-name'], .job-title");
        if (ne) title = jfOneLine(ne.innerText);
      }

      var salary = "";
      var sal = root.querySelector(".salary, .job-money, [class*='salary'], .red");
      if (sal) salary = jfOneLine(sal.innerText);
      if (!salary) {
        var sm = (root.innerText || "").match(
          /\d+\s*[-–]\s*\d+\s*元\s*\/\s*天|\d+\s*[-–]\s*\d+\s*元\/天|\d+\s*[-–]\s*\d+\s*元|\d+[kK]\s*[-–]\s*\d+[kK]|\d+[kK]以上|面议/
        );
        if (sm) salary = sm[0].replace(/\s+/g, "");
      }

      var company = "";
      var ce = root.querySelector(".company-name, a[ka='company_name'], [class*='company-name']");
      if (ce) company = jfOneLine(ce.innerText);

      if (title.length >= 2) {
        return {
          title: title,
          salary: salary,
          company: company,
          detailHref: detailHref
        };
      }
    }
    return null;
  }

  /**
   * 详情区头部是否与「当前点击的列表卡片」指向同一职位。
   * 注意：任一方缺少 job_detail 路径时不再盲目返回 true，否则 SPA 切换瞬间会误把上一份 JD 当成当前岗位。
   */
  function liveHeaderMatchesCard(live, info) {
    if (!info || !info.jobDetailUrl) return true;
    var cardPath = jobPathKey(info.jobDetailUrl);
    if (!cardPath) return true;
    // 读不到详情头（Boss 改版 / selector 未覆盖）时不能判「不一致」：否则 pollLiveDomJd 会整段跳过 DOM，侧栏永远 JD 未抓取。
    if (!live) return true;
    var livePath = jobPathKey(live.detailHref || "");
    if (livePath && cardPath) return livePath === cardPath;
    var lt = sanitizeJobTitle(live.title || "");
    var ct = sanitizeJobTitle(info.title || "");
    var lc = jfOneLine(live.company || "");
    var cc = jfOneLine(info.company || "");
    if (lt && ct && lt === ct && lc && cc && lc === cc) return true;
    return false;
  }

  function mergeDetailIntoCard(info, live) {
    var out = {
      jobDetailUrl: info.jobDetailUrl,
      location: info.location || ""
    };
    if (live && !liveHeaderMatchesCard(live, info)) {
      live = null;
    }
    out.title = sanitizeJobTitle(live && live.title ? live.title : info.title);
    out.salary =
      live && live.salary
        ? jfOneLine(live.salary)
        : jfOneLine(info.salary || "");
    out.company =
      live && live.company
        ? jfOneLine(live.company)
        : jfOneLine(info.company || "");
    out.id = out.title + "|" + out.company;
    out.idHash = simpleHash(out.id);
    return out;
  }

  /** 轮询等待 SPA 把详情头渲染出来，再与列表卡片合并（避免侧栏标题/薪资与左侧详情不一致） */
  function pollMergeCardWithLiveDetail(info, maxMs, interval) {
    return new Promise(function (resolve) {
      var bestLive = null;
      var start = Date.now();
      function tick() {
        var live = extractLiveJobDetailHeader();
        if (live && liveHeaderMatchesCard(live, info)) {
          bestLive = live;
          if (live.title && live.salary) {
            resolve(mergeDetailIntoCard(info, bestLive));
            return;
          }
        }
        if (Date.now() - start >= maxMs) {
          resolve(mergeDetailIntoCard(info, bestLive));
          return;
        }
        setTimeout(tick, interval);
      }
      tick();
    });
  }

  // ===== 卡片信息抽取 =====
  function extractCardInfo(card) {
    if (!card) return null;
    var text = (card.innerText || "").trim();
    if (!text || text.length < 4) return null;

    var jobNameEl =
      card.querySelector("a.job-name") ||
      card.querySelector("a[class*='job-name']") ||
      card.querySelector("a[class*='jobName']");

    var title = "";
    if (jobNameEl) {
      title = (jobNameEl.innerText || jobNameEl.textContent || "").trim().split("\n")[0];
    }
    if (!title || title.length < 2) {
      var titleEl = card.querySelector(".job-name, .job-title, [class*='job-name'], h3 a, h3");
      title = titleEl ? titleEl.innerText.trim().split("\n")[0] : "";
    }
    if (!title || title.length < 2) return null;
    title = sanitizeJobTitle(title);
    if (!title || title.length < 2) return null;

    var companyEl = card.querySelector(
      ".company-name, .company-text, .info-public, .name, " +
        "[class*='company-name'], [class*='CompanyName'], " +
        "a[ka='company_name'], .job-card-left .name, .job-title + .company-name"
    );
    var company = companyEl ? companyEl.innerText.trim().split("\n")[0] : "";
    if (!company || company.length < 2) {
      var cm = text.match(/[\u4e00-\u9fa5A-Za-z0-9·]{2,30}(有限公司|股份公司|集团|科技|网络|信息|公司|工作室)/);
      if (cm) company = cm[0];
    }

    var salaryEl = card.querySelector(".salary, .red, [class*='salary'], [class*='Salary']");
    var salary = salaryEl ? jfOneLine(salaryEl.innerText) : "";
    if (!salary) {
      var m = text.match(/\d+[kK]\s*[-–]\s*\d+[kK]|\d+[kK]以上|面议|\d+\s*[-–]\s*\d+\s*元|\d+\s*[-–]\s*\d+\s*元\/天/);
      if (m) salary = m[0];
    }

    var locEl = card.querySelector(
      ".job-area, .job-address, [class*='job-area'], .city, [class*='area']"
    );
    var locStr = locEl ? locEl.innerText.trim().split("\n")[0] : "";

    var detailHref = "";
    var detailAnchor =
      jobNameEl ||
      card.querySelector("a[href*='/job_detail/']") ||
      card.querySelector("a[href*='job_detail']") ||
      card.querySelector("a[href*='/jobs/']");
    if (detailAnchor) {
      try {
        var raw = detailAnchor.getAttribute("href") || "";
        if (raw && raw !== "#" && raw.indexOf("javascript:") !== 0) {
          detailHref = new URL(raw, window.location.origin).href;
        }
      } catch (e) {}
    }

    var id = title + "|" + company;
    return {
      id: id,
      idHash: simpleHash(id),
      title: title,
      company: company,
      salary: salary,
      location: locStr,
      jobDetailUrl: detailHref
    };
  }

  function normalizeJdWhitespace(s) {
    return String(s || "").replace(/\s+/g, " ").trim();
  }

  /** 用于在「当前页 DOM 抓到的 JD」与「fetch 详情页 HTML」之间择优 */
  function jdPickScore(s) {
    if (!s) return 0;
    var sc = Math.min(s.length, 4000);
    if (/职位描述/.test(s)) sc += 1500;
    if (/工作内容/.test(s)) sc += 900;
    if (/任职要求|任职资格|岗位要求/.test(s)) sc += 700;
    if (/岗位职责/.test(s)) sc += 500;
    if (/实习|全职|学历|本科|负责/.test(s)) sc += 120;
    return sc;
  }

  /**
   * 从当前 Boss 页已渲染的详情区读取 JD（列表点选后右侧/中间面板，多为 SPA 注入，同源 fetch 常拿不到）。
   */
  function extractJobDescriptionFromLiveDom() {
    var candidates = [];
    function pushText(t) {
      t = normalizeJdWhitespace(t);
      if (t.length < 50) return;
      candidates.push(t);
    }
    function pushEl(el) {
      if (!el) return;
      pushText(el.innerText || el.textContent || "");
    }

    var areaSelectors = [
      ".job-detail-main",
      ".job-detail",
      "[class*='job-detail-main']",
      "[class*='JobDetail']",
      ".job-box",
      ".detail-main",
      ".job-body"
    ];
    var i;
    var j;
    for (i = 0; i < areaSelectors.length; i++) {
      var areas = document.querySelectorAll(areaSelectors[i]);
      for (j = 0; j < areas.length; j++) {
        var ar = areas[j];
        var r = ar.getBoundingClientRect();
        if (r.width < 80 || r.height < 80) continue;
        pushEl(ar);
      }
    }

    var textSelectors = [
      ".job-sec-text",
      "[class*='job-sec-text']",
      ".job-detail .detail-content",
      ".job-detail-section .text",
      ".job-detail-section",
      ".detail-content",
      "[class*='job-description']",
      ".job-sec .text"
    ];
    for (i = 0; i < textSelectors.length; i++) {
      var nodes = document.querySelectorAll(textSelectors[i]);
      for (j = 0; j < nodes.length; j++) pushEl(nodes[j]);
    }

    var secs = document.querySelectorAll(".job-sec, [class*='job-sec']");
    for (i = 0; i < secs.length; i++) {
      var ht = normalizeJdWhitespace(secs[i].innerText || "");
      if (/(职位描述|工作内容|岗位职责|任职要求|任职资格|岗位要求)/.test(ht)) pushEl(secs[i]);
    }

    var best = "";
    var bestScore = 0;
    for (i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      var sc = jdPickScore(c);
      if (sc > bestScore) {
        bestScore = sc;
        best = c;
      }
    }

    if (best.length < 120) {
      var panels = document.querySelectorAll(
        ".job-detail, [class*='job-detail'], .job-box, [class*='job-box']"
      );
      for (i = 0; i < panels.length; i++) {
        var pt = normalizeJdWhitespace(panels[i].innerText || "");
        if (
          pt.length > best.length &&
          pt.length < 12000 &&
          /(职位描述|工作内容|任职要求|岗位职责|岗位要求|薪资|学历)/.test(pt)
        ) {
          best = pt;
        }
      }
    }

    return best.substring(0, 4500);
  }

  /**
   * 轮询详情区 DOM 取 JD。必须带 cardInfo：仅在「详情头与列表卡片为同一 job_detail」时才累积正文，
   * 否则 Boss SPA 切换瞬间会残留上一份超长 JD，被「取最长」逻辑锁死，导致侧栏分析与当前卡片错位。
   */
  function pollLiveDomJd(maxMs, interval, cardInfo) {
    return new Promise(function (resolve) {
      var best = "";
      var start = Date.now();
      function tick() {
        var liveHeader = extractLiveJobDetailHeader();
        var headerOk =
          !cardInfo ||
          !cardInfo.jobDetailUrl ||
          liveHeaderMatchesCard(liveHeader, cardInfo);
        var cur = headerOk ? extractJobDescriptionFromLiveDom() : "";
        if (cur.length > best.length) best = cur;
        if (
          headerOk &&
          best.length >= 260 &&
          /(职位描述|工作内容|任职要求|岗位职责|岗位要求)/.test(best)
        ) {
          resolve(best);
          return;
        }
        if (Date.now() - start >= maxMs) {
          resolve(best);
          return;
        }
        setTimeout(tick, interval);
      }
      tick();
    });
  }

  /** 并行：轮询当前页详情 DOM + 同源 fetch HTML，择优合并（解决 SPA 详情不落在静态 HTML 里） */
  function getJdTextForActiveJob(url, cardInfo) {
    var livePoll = pollLiveDomJd(2200, 100, cardInfo || null);
    var fetchP = fetchJobDetailText(url);
    return Promise.all([livePoll, fetchP]).then(function (pair) {
      var live = pair[0] || "";
      var fetched = pair[1] || "";
      if (cardInfo && cardInfo.jobDetailUrl) {
        var hNow = extractLiveJobDetailHeader();
        if (hNow && !liveHeaderMatchesCard(hNow, cardInfo)) {
          live = "";
        }
      }
      var sl = jdPickScore(live);
      var sf = jdPickScore(fetched);
      var chosen;
      if (sl >= sf + 120) chosen = live;
      else if (sf >= sl + 120) chosen = fetched;
      else chosen = live.length >= fetched.length ? live : fetched;
      if (chosen.length < 80) {
        chosen = live.length > fetched.length ? live : fetched;
      }
      chosen = normalizeJdWhitespace(chosen).substring(0, 4500);
      if (url && chosen.length >= 80) {
        try {
          setCachedJD(url, chosen);
        } catch (e) {}
      }
      console.log(
        "[JobCopilot] JD merge liveLen=" + live.length + " fetchLen=" + fetched.length + " pickLen=" + chosen.length
      );
      return chosen;
    });
  }

  // ===== JD 详情同源 fetch（用于点开卡片后取 JD 正文） =====
  var __jdCache = {};
  var __jdCacheKeys = [];

  function getCachedJD(url) {
    var row = __jdCache[url];
    if (!row) return null;
    if (Date.now() - row.at > 30 * 60 * 1000) return null;
    return row.text;
  }
  function setCachedJD(url, text) {
    if (!__jdCache[url]) __jdCacheKeys.push(url);
    __jdCache[url] = { text: text, at: Date.now() };
    while (__jdCacheKeys.length > 60) {
      var k = __jdCacheKeys.shift();
      delete __jdCache[k];
    }
  }

  function fetchJobDetailText(url) {
    if (!url) return Promise.resolve("");
    var cached = getCachedJD(url);
    if (cached != null && cached.length >= 40) return Promise.resolve(cached);

    return Promise.race([
      fetch(url, { credentials: "include" }).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text();
      }),
      new Promise(function (_, reject) {
        setTimeout(function () { reject(new Error("timeout 6s")); }, 6000);
      })
    ]).then(function (html) {
      var doc = new DOMParser().parseFromString(html, "text/html");
      var selectors = [
        ".job-sec-text",
        ".job-detail .detail-content",
        ".job-detail-section .text",
        ".job-detail-section",
        ".detail-content",
        "[class*='job-sec-text']",
        "[class*='job-description']"
      ];
      var best = "";
      for (var si = 0; si < selectors.length; si++) {
        var nodes = doc.querySelectorAll(selectors[si]);
        for (var ni = 0; ni < nodes.length; ni++) {
          var t = (nodes[ni].textContent || "").replace(/\s+/g, " ").trim();
          if (t.length > best.length) best = t;
        }
        if (best.length >= 60) break;
      }
      if (!best || best.length < 30) {
        var main = doc.querySelector("main") || doc.body;
        if (main) {
          var divs = main.querySelectorAll("div, section");
          for (var di = 0; di < divs.length; di++) {
            var dt = (divs[di].textContent || "").replace(/\s+/g, " ").trim();
            if (dt.length > best.length && dt.length < 4000 && /(岗位|职责|要求|任职|工作内容)/.test(dt)) {
              best = dt;
            }
          }
        }
      }
      best = best.substring(0, 4000);
      if (best.length >= 50) {
        setCachedJD(url, best);
      }
      return best;
    }).catch(function (e) {
      console.warn("[JobCopilot] fetchJobDetail failed", url, e && e.message);
      return "";
    });
  }

  // ===== HUD overlay：用独立 fixed 层显示 dot，零侵入 Boss 卡片 DOM =====
  var hudLayer = null;
  var dotRegistry = {};  // idHash -> { level, cardRef (WeakRef) }
  var rafScheduled = false;

  function ensureHUD() {
    if (hudLayer && document.body.contains(hudLayer)) return hudLayer;
    hudLayer = document.createElement("div");
    hudLayer.id = "jobflow-hud-layer";
    hudLayer.style.cssText =
      "position:fixed;top:0;left:0;width:0;height:0;pointer-events:none;z-index:2147483640;";
    (document.body || document.documentElement).appendChild(hudLayer);
    return hudLayer;
  }

  function dotColorFor(level) {
    if (level === "high") return "#3B82F6";
    if (level === "medium") return "#F59E0B";
    return "#A8A29E";
  }

  function makeDotEl(idHash, level) {
    var d = document.createElement("div");
    d.className = "jobflow-hud-dot";
    d.setAttribute("data-id", idHash);
    d.style.cssText =
      "position:fixed;width:8px;height:8px;border-radius:50%;" +
      "background:" + dotColorFor(level) + ";" +
      "box-shadow:0 0 0 2px rgba(255,255,255,0.9);" +
      "pointer-events:none;transition:transform 120ms ease-out;";
    return d;
  }

  function markCardDot(idHash, level, card) {
    if (!idHash) return;
    ensureHUD();
    var existing = hudLayer.querySelector('.jobflow-hud-dot[data-id="' + idHash + '"]');
    if (existing) {
      existing.style.background = dotColorFor(level);
    } else {
      hudLayer.appendChild(makeDotEl(idHash, level));
    }
    // 用 data-attribute 在卡片上做轻量标记（仅用于反查，不改 Boss 自身样式）
    if (card) {
      try { card.setAttribute("data-jobflow-id", idHash); } catch (e) {}
    }
    dotRegistry[idHash] = { level: level };
    scheduleReposition();
  }

  function clearAllDots() {
    if (hudLayer) hudLayer.innerHTML = "";
    dotRegistry = {};
  }

  function repositionDots() {
    rafScheduled = false;
    if (!hudLayer) return;
    var dots = hudLayer.querySelectorAll(".jobflow-hud-dot");
    if (!dots.length) return;
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    for (var i = 0; i < dots.length; i++) {
      var dot = dots[i];
      var id = dot.getAttribute("data-id");
      var card = document.querySelector('[data-jobflow-id="' + id + '"]');
      if (!card) {
        dot.style.display = "none";
        continue;
      }
      var r = card.getBoundingClientRect();
      if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) {
        dot.style.display = "none";
        continue;
      }
      dot.style.display = "block";
      // 放在卡片右上角，离边 8px
      dot.style.left = Math.round(r.right - 14) + "px";
      dot.style.top = Math.round(r.top + 6) + "px";
    }
  }

  function scheduleReposition() {
    if (rafScheduled) return;
    rafScheduled = true;
    requestAnimationFrame(repositionDots);
  }

  window.addEventListener("scroll", scheduleReposition, true);
  window.addEventListener("resize", scheduleReposition);
  // 持续微调（应对 Boss 内部滚动容器 / 虚拟列表回收）
  setInterval(scheduleReposition, 600);

  // ===== 扩展上下文失效（重载扩展后旧 content script 仍在页内）=====
  var staleTipShown = false;

  function isExtensionContextValid() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  function showStaleExtensionTip() {
    if (staleTipShown) return;
    staleTipShown = true;
    try {
      if (document.getElementById("jobflow-extension-stale-tip")) return;
      var tip = document.createElement("div");
      tip.id = "jobflow-extension-stale-tip";
      tip.setAttribute("role", "status");
      tip.style.cssText =
        "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);max-width:min(92vw,420px);" +
        "z-index:2147483646;padding:12px 14px;background:#161616;color:#F5F5F4;" +
        "font-size:13px;line-height:1.55;border-radius:8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
        "border:1px solid #2A2A2A;pointer-events:auto;text-align:left;";
      tip.innerHTML =
        "<div style=\"margin-bottom:8px;\"><strong>Job Copilot</strong>：你在「扩展程序」里重载/更新过插件，本页上的旧脚本已断开。</div>" +
        "<div style=\"color:#B0B0AE;font-size:12px;\">请按 <strong style=\"color:#4F8CF7;\">F5 刷新本页</strong>，再点左侧岗位即可恢复。</div>" +
        "<button type=\"button\" id=\"jobflow-stale-dismiss\" style=\"margin-top:10px;padding:6px 12px;border-radius:8px;" +
        "border:1px solid #2A2A2A;background:#1E1E1E;color:#F5F5F4;cursor:pointer;font-size:12px;width:100%;\">知道了</button>";
      (document.body || document.documentElement).appendChild(tip);
      var btn = document.getElementById("jobflow-stale-dismiss");
      if (btn) {
        btn.addEventListener("click", function () {
          if (tip.parentNode) tip.parentNode.removeChild(tip);
        });
      }
    } catch (e) {}
  }

  function isContextInvalidatedError(err) {
    var m = err && (err.message || String(err));
    return !!(m && /context invalidated|Extension context/i.test(m));
  }

  // ===== 点击卡片 → 取 JD → 通知 sidepanel =====
  function safeSend(msg, label) {
    if (!isExtensionContextValid()) {
      /** 预期场景：扩展重载后旧 content script 仍挂在页上；已有页面提示，勿用 warn 污染扩展错误页 */
      if (typeof console !== "undefined" && console.debug) {
        console.debug("[JobCopilot] context invalidated — refresh tab (F5).", label);
      }
      showStaleExtensionTip();
      return false;
    }
    try {
      var p = chrome.runtime.sendMessage(msg);
      if (p && typeof p.then === "function") {
        p.then(
          function (r) { console.log("[JobCopilot] sent", label, "→", r); },
          function (err) {
            if (isContextInvalidatedError(err)) {
              showStaleExtensionTip();
              return;
            }
            console.warn("[JobCopilot] sent", label, "rejected:", err && err.message);
          }
        );
      }
      return true;
    } catch (e) {
      if (isContextInvalidatedError(e)) {
        showStaleExtensionTip();
        return false;
      }
      console.warn("[JobCopilot] sendMessage throw", label, e && e.message);
      return false;
    }
  }

  function dispatchActiveJD(card) {
    if (!card) return false;
    var info = extractCardInfo(card);
    if (!info) {
      console.log("[JobCopilot] click matched, but extractCardInfo returned null");
      return false;
    }
    activeCardEl = card;
    activeIdHash = info.idHash;
    try { card.setAttribute("data-jobflow-id", info.idHash); } catch (e2) {}

    console.log("[JobCopilot] active card:", info.title, "| href:", info.jobDetailUrl);
    // 同步立刻发 loading，避免被 Boss 的 SPA 路由打断
    var sent = safeSend(
      { action: "JOBFLOW_ACTIVE_JD", phase: "loading", card: info },
      "ACTIVE_JD/loading"
    );
    if (!sent) return false;

    Promise.all([
      getJdTextForActiveJob(info.jobDetailUrl, info),
      pollMergeCardWithLiveDetail(info, 2200, 90)
    ]).then(function (pair) {
      if (!isExtensionContextValid()) {
        showStaleExtensionTip();
        return;
      }
      var jd = pair[0] || "";
      var merged = pair[1] || info;
      console.log(
        "[JobCopilot] JD len=" + jd.length + " mergedTitle=" + merged.title + " salary=" + merged.salary
      );
      activeIdHash = merged.idHash;
      try {
        card.setAttribute("data-jobflow-id", merged.idHash);
      } catch (e3) {}
      safeSend(
        { action: "JOBFLOW_ACTIVE_JD", phase: "ready", card: merged, jd: jd },
        "ACTIVE_JD/ready"
      );
    });
    return true;
  }

  function findCardFromEvent(t) {
    if (!t || t.nodeType !== 1) return null;
    // 1) 直接在事件目标向上找
    var card = findCardForElement(t);
    if (card) return card;
    // 2) 命中 a.job-name 但容器特殊，单独兜底
    var anchor = t.closest && t.closest("a.job-name, a[class*='job-name']");
    if (!anchor) return null;
    card = findCardForElement(anchor);
    if (card) return card;
    return anchor.closest("li, [class*='rec-job-list-item'], [class*='job-card']");
  }

  function handleCardEvent(e) {
    var card = findCardFromEvent(e.target);
    if (!card) return;
    var nowTs = Date.now();
    var lastTs = parseInt(card.getAttribute("data-jobflow-clicked-at") || "0", 10);
    if (lastTs && nowTs - lastTs < 600) return;
    card.setAttribute("data-jobflow-clicked-at", String(nowTs));
    dispatchActiveJD(card);
  }

  // 同时挂 mousedown 与 click：mousedown 抢在 Boss SPA 跳转之前
  document.addEventListener("mousedown", handleCardEvent, true);
  document.addEventListener("click", handleCardEvent, true);

  // ===== 兼容旧 JD 探针（仍服务 perspective 模式） =====
  function extractJD() {
    try {
      var jdContainer =
        document.querySelector(".job-sec-text") ||
        document.querySelector(".job-description") ||
        document.querySelector(".job-detail .detail-content") ||
        document.querySelector("[class*='job-sec']") ||
        document.querySelector(".job-detail-box") ||
        document.querySelector(".job-detail") ||
        document.querySelector(".detail-content");
      if (!jdContainer) return;
      var t = (jdContainer.innerText || "").trim();
      if (t && t.length > 50 && t !== lastJDText) {
        lastJDText = t;
        if (!isExtensionContextValid()) {
          showStaleExtensionTip();
          return;
        }
        try {
          var pj = chrome.runtime.sendMessage({ action: "JD_EXTRACTED", text: t });
          if (pj && typeof pj.then === "function") {
            pj.catch(function (err) {
              if (isContextInvalidatedError(err)) showStaleExtensionTip();
            });
          }
        } catch (e) {
          if (isContextInvalidatedError(e)) showStaleExtensionTip();
        }
      }
    } catch (e) {}
  }
  // 旧版自动轮询 PUSH_JD/JD_EXTRACTED 已停用：新流程完全依赖卡片点击触发的 JOBFLOW_ACTIVE_JD。
  // 仅保留 extractJD 函数体，供 REQUEST_JD 主动请求时使用（OCR 兜底等场景）。

  // ===== 消息派发 =====
  window.__jobCopilotDispatch = function (message, sender, sendResponse) {
    if (!message || !message.action) return;

    if (message.action === "REQUEST_JD") {
      extractJD();
      sendResponse({ text: lastJDText });
      return;
    }

    if (message.action === "JOBFLOW_MARK_CARD_DOT") {
      var card = null;
      if (message.idHash && activeCardEl && activeIdHash === message.idHash) {
        card = activeCardEl;
      } else if (message.idHash) {
        card = document.querySelector('[data-jobflow-id="' + message.idHash + '"]');
        if (!card) {
          var cs = getCards();
          for (var i = 0; i < cs.length; i++) {
            var ii = extractCardInfo(cs[i]);
            if (ii && ii.idHash === message.idHash) { card = cs[i]; break; }
          }
        }
      }
      if (card) {
        markCardDot(message.idHash, message.level || "low", card);
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, reason: "card not found" });
      }
      return;
    }

    if (message.action === "JOBFLOW_CLEAR_DOTS") {
      clearAllDots();
      sendResponse({ ok: true });
      return;
    }

    if (message.action === "JOBFLOW_PING") {
      sendResponse({ ok: true, url: location.href });
      return;
    }
  };

  console.log("[JobCopilot] content script ready (perspective mode)");
})();
