/**
 * Tecko-v2: 完整新闻正文提取管线
 * 从 URL 获取 → 重定向追踪 → SPA 检测 → 正文提取 → 后处理 → 输出纯文本
 *
 * 适配 QuickApp (JerryScript) 环境：无 DOM API，纯字符串扫描
 * 基于 Tecko-R 算法：单遍流式 DOM 语义过滤 + 固定窗口能量评分 + Kadane 正文区间检测
 */

// ==================== 配置 ====================

var MAX_P = 64        // 最大段落数
var INT_SCALE = 1000  // 整数运算缩放因子
var MAX_REDIRECT = 5  // 最大重定向次数

// LQB 参数
var LQB_LOW_THRESHOLD = 120
var LQB_WINDOW_LIMIT = 3

// adTTL 参数
var AD_TTL_INIT = 3
var AD_DECAY = 1
var AD_BOOST_NEAR_AD = 0.15

// 语义容器特征词（div id/class 包含这些词时视为语义容器）
var SEMANTIC_WORDS = ["content", "article", "detail", "main", "body", "text"]

// 排除标签（这些标签内的内容永远不进入正文）
var EXCLUDED_TAGS = ["nav", "footer", "aside", "header"]

// ==================== Step 0: HTTP 获取 ====================

/**
 * 获取原始 HTML 文本（需外部提供 fetch 实现）
 * @param {string} url - 请求 URL
 * @param {object} fetchImpl - fetch 实现，需支持 fetch({ url, method, header, success, fail })
 * @returns {Promise<string|{redirect: string}>}
 */
function fetchText(url, fetchImpl) {
  return new Promise(function (resolve, reject) {
    var isCompleted = false
    var timeoutId = setTimeout(function () {
      if (!isCompleted) {
        isCompleted = true
        reject(new Error("Timeout"))
      }
    }, 60000)

    fetchImpl({
      url: url,
      method: "GET",
      header: {
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.106 Mobile Safari/537.36"
      },
      success: function (res) {
        if (isCompleted) return
        isCompleted = true
        clearTimeout(timeoutId)

        var code = res.code || res.statusCode
        var data = res.data !== undefined ? res.data : res.result
        var headers = res.headers || {}

        // 处理 3xx 重定向
        if (code >= 300 && code < 400) {
          var location = headers["location"] || headers["Location"] || ""
          if (location) {
            resolve({ redirect: location })
            return
          }
        }

        if (typeof data === "string") {
          resolve(data)
        } else if (typeof data === "object" && data !== null) {
          try { resolve(JSON.stringify(data)) } catch (e) { resolve("") }
        } else {
          resolve("")
        }
      },
      fail: function (data, code) {
        if (isCompleted) return
        isCompleted = true
        clearTimeout(timeoutId)
        reject(new Error("Fetch failed: " + code))
      }
    })
  })
}

// ==================== Step 1: 段落提取（字符串状态机 + 有界子树传播） ====================

function extractP(html) {
  var res = []
  var lower = html.toLowerCase()
  var len = html.length
  var pos = 0
  var inExcluded = 0
  var inSemantic = 0
  var inPlain = 0

  while (pos < len) {
    var ltPos = lower.indexOf("<", pos)
    if (ltPos === -1) break

    // 检测排除标签
    var skipEx = false
    for (var ei = 0; ei < EXCLUDED_TAGS.length; ei++) {
      var exTag = EXCLUDED_TAGS[ei]
      var exOpen = "<" + exTag
      if (lower.indexOf(exOpen, ltPos) === ltPos &&
          (ltPos + exOpen.length >= len || " >/\n\r\t".indexOf(lower.charAt(ltPos + exOpen.length)) !== -1)) {
        var exClose = lower.indexOf("</" + exTag + ">", ltPos + exOpen.length)
        if (exClose === -1) { pos = len; skipEx = true; break }
        pos = exClose + exTag.length + 3
        skipEx = true
        break
      }
      var exCloseTag = "</" + exTag + ">"
      if (lower.indexOf(exCloseTag, ltPos) === ltPos) {
        if (inExcluded > 0) inExcluded--
        pos = ltPos + exCloseTag.length
        skipEx = true
        break
      }
    }
    if (skipEx) continue
    if (pos > ltPos) continue

    // 检测语义容器开标签
    if (inExcluded === 0) {
      var containerTags = ["article", "section"]
      var foundContainer = false
      for (var ci = 0; ci < containerTags.length; ci++) {
        var cTag = containerTags[ci]
        var cOpen = "<" + cTag
        if (lower.indexOf(cOpen, ltPos) === ltPos &&
            (ltPos + cOpen.length >= len || " >/\n\r\t".indexOf(lower.charAt(ltPos + cOpen.length)) !== -1)) {
          inSemantic++
          pos = ltPos + cOpen.length
          foundContainer = true
          break
        }
      }
      if (foundContainer) continue

      // 语义 div 检测
      if (lower.indexOf("<div", ltPos) === ltPos &&
          (ltPos + 4 >= len || " >/\n\r\t".indexOf(lower.charAt(ltPos + 4)) !== -1)) {
        var divEnd = lower.indexOf(">", ltPos)
        if (divEnd === -1) break
        var divAttrs = lower.substring(ltPos, divEnd + 1)
        var isSemantic = false
        for (var si = 0; si < SEMANTIC_WORDS.length; si++) {
          if (divAttrs.indexOf(SEMANTIC_WORDS[si]) !== -1) {
            isSemantic = true
            break
          }
        }
        if (isSemantic) { inSemantic++ } else { inPlain++ }
        pos = divEnd + 1
        continue
      }
    }

    // 检测容器闭标签
    if (lower.indexOf("</article>", ltPos) === ltPos) {
      if (inSemantic > 0) inSemantic--
      pos = ltPos + 10; continue
    }
    if (lower.indexOf("</section>", ltPos) === ltPos) {
      if (inSemantic > 0) inSemantic--
      pos = ltPos + 10; continue
    }
    if (lower.indexOf("</div>", ltPos) === ltPos) {
      if (inSemantic > 0) inSemantic--
      else if (inPlain > 0) inPlain--
      pos = ltPos + 6; continue
    }

    // P 标签提取（仅在语义容器内）
    if (inExcluded === 0 && inSemantic > 0 && inPlain === 0) {
      if (lower.indexOf("<p", ltPos) === ltPos &&
          (ltPos + 2 >= len || " >/\n\r\t".indexOf(lower.charAt(ltPos + 2)) !== -1)) {
        var pClose = lower.indexOf("</p>", ltPos + 2)
        if (pClose === -1) break
        var text = html.substring(ltPos, pClose + 4)
        if (text.length > 10) {
          res.push({ text: text, len: text.length, score: 0, isAd: false, lowScoreStreak: 0, adTTL: 0, adFlag: 0 })
          if (res.length >= MAX_P) break
        }
        pos = pClose + 4
        continue
      }
    }

    // 跳过 script/style 标签
    if (lower.indexOf("<script", ltPos) === ltPos &&
        (ltPos + 7 >= len || " >/\n\r\t".indexOf(lower.charAt(ltPos + 7)) !== -1)) {
      var sEnd = lower.indexOf("</script>", ltPos + 7)
      pos = sEnd === -1 ? len : sEnd + 9; continue
    }
    if (lower.indexOf("<style", ltPos) === ltPos &&
        (ltPos + 6 >= len || " >/\n\r\t".indexOf(lower.charAt(ltPos + 6)) !== -1)) {
      var stEnd = lower.indexOf("</style>", ltPos + 6)
      pos = stEnd === -1 ? len : stEnd + 8; continue
    }

    pos = ltPos + 1
  }

  // Fallback：无语义容器时，提取排除区外的 P 标签
  if (res.length === 0) {
    pos = 0
    while (pos < len) {
      var lt2 = lower.indexOf("<", pos)
      if (lt2 === -1) break

      var skip = false
      for (var fi = 0; fi < EXCLUDED_TAGS.length; fi++) {
        var fTag = EXCLUDED_TAGS[fi]
        if (lower.indexOf("<" + fTag, lt2) === lt2 &&
            (lt2 + fTag.length + 1 >= len || " >/\n\r\t".indexOf(lower.charAt(lt2 + fTag.length + 1)) !== -1)) {
          var fClose = lower.indexOf("</" + fTag + ">", lt2 + fTag.length + 1)
          pos = fClose === -1 ? len : fClose + fTag.length + 3
          skip = true; break
        }
      }
      if (skip) continue

      if (lower.indexOf("<p", lt2) === lt2 &&
          (lt2 + 2 >= len || " >/\n\r\t".indexOf(lower.charAt(lt2 + 2)) !== -1)) {
        var pEnd = lower.indexOf("</p>", lt2 + 2)
        if (pEnd === -1) break
        var t = html.substring(lt2, pEnd + 4)
        if (t.length > 10) {
          res.push({ text: t, len: t.length, score: 0, isAd: false, lowScoreStreak: 0, adTTL: 0, adFlag: 0 })
          if (res.length >= MAX_P) break
        }
        pos = pEnd + 4; continue
      }

      if (lower.indexOf("<script", lt2) === lt2 &&
          (lt2 + 7 >= len || " >/\n\r\t".indexOf(lower.charAt(lt2 + 7)) !== -1)) {
        var scrEnd = lower.indexOf("</script>", lt2 + 7)
        pos = scrEnd === -1 ? len : scrEnd + 9; continue
      }
      if (lower.indexOf("<style", lt2) === lt2 &&
          (lt2 + 6 >= len || " >/\n\r\t".indexOf(lower.charAt(lt2 + 6)) !== -1)) {
        var styEnd = lower.indexOf("</style>", lt2 + 6)
        pos = styEnd === -1 ? len : styEnd + 8; continue
      }

      pos = lt2 + 1
    }
  }

  return res
}

// ==================== Step 2: 结构过滤（长度桶 + 区间相似性） ====================

function getBucket(len) {
  if (len < 20) return 0
  if (len < 50) return 1
  if (len < 100) return 2
  if (len < 200) return 3
  if (len < 400) return 4
  return 5
}

function isSimilar(a, b) {
  var ba = getBucket(a)
  var bb = getBucket(b)
  var diff = Math.abs(a - b)
  if (ba === bb) {
    if (a < 32 || b < 32) return diff <= 4
    return diff <= (Math.min(a, b) >> 3)
  }
  if (Math.abs(ba - bb) === 1) {
    return diff <= Math.floor(Math.min(a, b) * 20 / 100)
  }
  return false
}

function structFilter(ps) {
  for (var i = 2; i < ps.length; i++) {
    if (isSimilar(ps[i].len, ps[i - 1].len) && isSimilar(ps[i].len, ps[i - 2].len)) {
      ps[i].isAd = true
      ps[i].adTTL = AD_TTL_INIT
    }
  }
}

// ==================== Step 3: 基础评分（整数版） ====================

function baseScore(p) {
  var s = 0
  var text = p.text
  var len = text.length

  // 中文密度
  var han = 0
  for (var i = 0; i < len; i++) {
    var c = text.charCodeAt(i)
    if (c >= 0x4e00 && c <= 0x9fa5) han++
  }
  var ratio = (han * INT_SCALE) / (len + 1)
  if (ratio > 700) s += 300
  else s -= 100

  // 末尾标点（取最后一个非空白字符）
  var lastChar = ""
  for (var j = len - 1; j >= 0; j--) {
    var ch = text.charAt(j)
    if (ch !== " " && ch !== "\n" && ch !== "\r" && ch !== "\t" && ch !== ">") {
      lastChar = ch
      break
    }
  }
  if (lastChar === "。" || lastChar === "！" || lastChar === "？") {
    s += 300
  } else {
    s -= 50
  }

  // 副标题弱增强
  if (len < 18) s += 80

  return s
}

// ==================== Step 3.5: LQB（Low Quality Buffer） ====================

function lqb(ps) {
  for (var i = 0; i < ps.length; i++) {
    if (i > 0) {
      ps[i].lowScoreStreak = (ps[i].score < LQB_LOW_THRESHOLD)
        ? ps[i - 1].lowScoreStreak + 1
        : 0
    } else {
      ps[i].lowScoreStreak = (ps[i].score < LQB_LOW_THRESHOLD) ? 1 : 0
    }
  }
}

// ==================== Step 3.6: adTTL（广告衰减传播） ====================

function adTTL(ps) {
  // adTTL 衰减传播
  for (var i = 1; i < ps.length; i++) {
    if (ps[i - 1].adTTL > 0) {
      ps[i].adTTL = Math.max(ps[i].adTTL, ps[i - 1].adTTL - AD_DECAY)
    }
  }

  // 广告影响：adTTL > 0 的段落轻度压制
  for (var j = 0; j < ps.length; j++) {
    if (ps[j].adTTL > 0) {
      ps[j].score = Math.floor(ps[j].score * (1 - AD_BOOST_NEAR_AD))
    }
  }
}

// ==================== Step 4: 单向邻域增强（i-1） ====================

function smooth(ps) {
  var out = []
  for (var i = 0; i < ps.length; i++) {
    var s = ps[i].score
    if (i > 0 && !ps[i].isAd && !ps[i - 1].isAd) {
      s += Math.floor(ps[i - 1].score * 3 / 10)
    }
    out.push(s)
  }
  return out
}

// ==================== Step 5: Kadane-lite 最大子段和 ====================

function kadane(arr) {
  var max = -1000000000
  var sum = 0
  var start = 0
  var bestL = 0
  var bestR = 0

  for (var i = 0; i < arr.length; i++) {
    if (sum <= 0) {
      sum = arr[i]
      start = i
    } else {
      sum += arr[i]
    }
    if (sum > max) {
      max = sum
      bestL = start
      bestR = i
    }
  }
  return { bestL: bestL, bestR: bestR }
}

// ==================== 核心算法：Tecko-R ====================

/**
 * Tecko-R 正文提取算法
 * @param {string} html - 原始 HTML
 * @returns {string} - 提取的正文 HTML（含原始标签）
 */
function teckoR(html) {
  if (!html || html.length < 50) return ""

  var ps = extractP(html)
  if (ps.length === 0) return ""

  structFilter(ps)

  for (var i = 0; i < ps.length; i++) {
    ps[i].score = baseScore(ps[i])
    if (ps[i].isAd) ps[i].score = Math.min(ps[i].score, 10)
  }

  // Step 3.5: LQB 连续低质量检测
  lqb(ps)

  // Step 3.6: adTTL 广告衰减传播
  adTTL(ps)

  // Ring Buffer: 超出 MAX_P 时淘汰低分段
  if (ps.length > MAX_P) {
    ps.sort(function (a, b) { return b.score - a.score })
    ps = ps.slice(0, MAX_P)
  }

  var sm = smooth(ps)
  var region = kadane(sm)

  var out = ""
  for (var j = region.bestL; j <= region.bestR; j++) {
    out += ps[j].text
  }
  return out
}

// ==================== SPA 检测 ====================

/**
 * 检测是否为 SPA 页面（特征 + DOM 特征 AND 运算）
 * @param {string} html
 * @returns {boolean}
 */
function isSPA(html) {
  var hasFramework = html.indexOf("__INITIAL_STATE__") !== -1 ||
                     html.indexOf("__DATA__") !== -1 ||
                     html.indexOf("window.__") !== -1
  var hasEmptyApp = (html.indexOf('id="app"') !== -1 || html.indexOf("id='app'") !== -1) &&
                    html.indexOf("<div") !== -1
  var hasLittleContent = html.length < 5000
  return hasFramework && hasEmptyApp && hasLittleContent
}

// ==================== 重定向检测 ====================

/**
 * 检测 HTML 中的重定向（meta refresh / JS 跳转）
 * @param {string} html
 * @param {string} currentUrl
 * @returns {string|null} - 重定向 URL 或 null
 */
function detectRedirect(html, currentUrl) {
  // meta refresh
  var metaRefresh = /<meta[^>]*http-equiv=["']?refresh["']?[^>]*content=["']?\d+\s*;\s*url=([^"'\s>]+)["']?/i.exec(html)
  if (metaRefresh && metaRefresh[1]) return resolveUrl(metaRefresh[1], currentUrl)

  // JS 跳转
  var patterns = [
    /(?:window\.location\.href|location\.href)\s*=\s*["']([^"']+)["']/i,
    /(?:window\.location\.replace|location\.replace)\s*\(\s*["']([^"']+)["']\s*\)/i,
    /(?:window\.location|location)\s*=\s*["']([^"']+)["']/i,
    /window\.open\s*\(\s*["']([^"']+)["']\s*\)/i
  ]
  for (var i = 0; i < patterns.length; i++) {
    var match = patterns[i].exec(html)
    if (match && match[1] && match[1].length > 10 && match[1].indexOf("http") === 0 && match[1] !== currentUrl) {
      return match[1]
    }
  }
  return null
}

/**
 * 相对路径转绝对路径
 */
function resolveUrl(relative, base) {
  if (relative.indexOf("http") === 0) return relative
  try {
    var baseObj = new URL(base)
    if (relative.indexOf("//") === 0) return baseObj.protocol + relative
    if (relative.indexOf("/") === 0) return baseObj.origin + relative
    var basePath = baseObj.pathname.substring(0, baseObj.pathname.lastIndexOf("/") + 1)
    return baseObj.origin + basePath + relative
  } catch (e) {
    return relative
  }
}

// ==================== Script 数据提取（SPA fallback） ====================

/**
 * 从 script 标签中提取嵌入的 JSON 数据
 */
function extractFromScripts(html) {
  var scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi
  var match
  while ((match = scriptRegex.exec(html)) !== null) {
    var scriptContent = match[1]
    if (!scriptContent || scriptContent.length < 100) continue

    // window.__INITIAL_STATE__ = {...}
    var stateMatch = scriptContent.match(/window\.__\w+__\s*=\s*(\{[\s\S]+\})\s*;?\s*$/m)
    if (stateMatch) {
      try {
        var json = JSON.parse(stateMatch[1])
        var content = findContentInJson(json)
        if (content) return content
      } catch (e) {}
    }

    // 直接 JSON
    if (scriptContent.trim().charAt(0) === "{") {
      try {
        var json2 = JSON.parse(scriptContent.trim())
        var content2 = findContentInJson(json2)
        if (content2) return content2
      } catch (e) {}
    }

    // "content": "..."
    var contentMatch = scriptContent.match(/"content"\s*:\s*"([^"]{100,})"/)
    if (contentMatch) return decodeScriptContent(contentMatch[1])

    var bodyMatch = scriptContent.match(/"body"\s*:\s*"([^"]{100,})"/)
    if (bodyMatch) return decodeScriptContent(bodyMatch[1])

    var descMatch = scriptContent.match(/"description"\s*:\s*"([^"]{100,})"/)
    if (descMatch) return descMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"')
  }
  return ""
}

function decodeScriptContent(raw) {
  raw = raw.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"')
  raw = raw.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  raw = raw.replace(/<[^>]+>/g, "\n")
  raw = raw.split(/[\r\n]+/).map(function (l) { return l.trim() }).filter(function (l) { return l.length > 0 }).join("\n\n")
  return raw.length > 50 ? raw : ""
}

function findContentInJson(obj) {
  if (!obj || typeof obj !== "object") return ""
  var keys = ["content", "body", "html", "articleContent", "articleBody", "detailContent"]
  for (var i = 0; i < keys.length; i++) {
    var val = obj[keys[i]]
    if (typeof val === "string" && val.length > 100) {
      var text = val.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
      text = text.replace(/<[^>]+>/g, "\n")
      text = text.split(/[\r\n]+/).map(function (l) { return l.trim() }).filter(function (l) { return l.length > 0 }).join("\n\n")
      if (text.length > 50) return text
    }
  }
  var childKeys = Object.keys(obj)
  for (var j = 0; j < childKeys.length; j++) {
    var child = obj[childKeys[j]]
    if (typeof child === "object" && child !== null) {
      var result = findContentInJson(child)
      if (result) return result
    }
  }
  return ""
}

// ==================== 后处理 ====================

/**
 * 解码 HTML 实体 + 去标签，保留段落分隔
 * @param {string} html
 * @returns {string} - 纯文本，段落间用双换行分隔
 */
function decodeAndStrip(html) {
  if (!html) return ""
  var map = {
    "nbsp": " ", "ensp": " ", "emsp": " ", "thinsp": " ",
    "quot": "\"", "apos": "'", "lt": "<", "gt": ">",
    "amp": "&",
    "mdash": "—", "ndash": "–", "hellip": "…",
    "lsquo": "‘", "rsquo": "’",
    "ldquo": "“", "rdquo": "”",
    "copy": "©", "reg": "®", "trade": "™",
    "bull": "•", "middot": "·"
  }
  // 段落标签转双换行
  html = html.replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
  html = html.replace(/<p[^>]*>/gi, "")
  html = html.replace(/<\/p>/gi, "")
  // 去其他标签
  html = html.replace(/<[^>]+>/g, " ")
  // 解码命名实体
  html = html.replace(/&([a-zA-Z]+);?/g, function (m, name) {
    var val = map[name]
    return val !== undefined ? val : m
  })
  // 解码数字实体
  html = html.replace(/&#(\d+);?/g, function (m, code) {
    var n = parseInt(code, 10)
    return (n >= 32 && n <= 65535) ? String.fromCharCode(n) : m
  })
  // 解码十六进制实体
  html = html.replace(/&#x([0-9a-fA-F]+);?/g, function (m, hex) {
    var n = parseInt(hex, 16)
    return (n >= 32 && n <= 65535) ? String.fromCharCode(n) : m
  })
  // 合并连续空格（保留换行）
  html = html.replace(/[^\S\n]+/g, " ")
  // 合并连续空行为双换行
  html = html.replace(/\n{3,}/g, "\n\n")
  return html.trim()
}

// ==================== CAPTCHA 检测 ====================

function isCaptchaPage(html) {
  var lower = html.toLowerCase()
  return lower.indexOf("verify") !== -1 ||
         lower.indexOf("captcha") !== -1 ||
         lower.indexOf("人机验证") !== -1 ||
         lower.indexOf("滑动验证") !== -1 ||
         lower.indexOf("请完成安全验证") !== -1 ||
         lower.indexOf("access denied") !== -1 ||
         lower.indexOf("checking your browser") !== -1 ||
         lower.indexOf("just a moment") !== -1 ||
         lower.indexOf("ray id") !== -1
}

// ==================== 主管线 ====================

/**
 * 完整正文提取管线
 * @param {string} url - 新闻 URL
 * @param {object} fetchImpl - fetch 实现
 * @param {function} [onLog] - 日志回调（可选）
 * @returns {Promise<string>} - 提取的纯文本正文
 */
function extract(url, fetchImpl, onLog) {
  var log = onLog || function () {}
  return fetchWithRedirect(url, 0, fetchImpl, log)
}

function fetchWithRedirect(url, depth, fetchImpl, log) {
  if (depth > MAX_REDIRECT) {
    log("重定向次数过多，停止")
    return Promise.resolve("")
  }

  log("请求URL (depth=" + depth + "): " + url)

  return fetchText(url, fetchImpl).then(function (data) {
    // HTTP 3xx 重定向
    if (data && typeof data === "object" && data.redirect) {
      log("HTTP重定向: " + url + " -> " + data.redirect)
      return fetchWithRedirect(data.redirect, depth + 1, fetchImpl, log)
    }

    if (!data || data.length < 50) {
      log("响应内容过短或为空")
      return ""
    }

    log("响应内容长度: " + data.length)

    // CAPTCHA 检测
    if (isCaptchaPage(data)) {
      log("检测到人机验证页面，跳过")
      return ""
    }

    // HTML 重定向检测
    var redirectUrl = detectRedirect(data, url)
    if (redirectUrl) {
      log("HTML重定向: " + url + " -> " + redirectUrl)
      return fetchWithRedirect(redirectUrl, depth + 1, fetchImpl, log)
    }

    // SPA script 数据提取
    var scriptData = extractFromScripts(data)
    if (scriptData && scriptData.length > 50) {
      log("从script提取到内容，长度=" + scriptData.length)
      return scriptData
    }

    // Tecko-R 正文提取
    log("Tecko-R 开始处理，HTML长度=" + data.length)
    var rawResult = teckoR(data)
    log("Tecko-R 原始结果长度=" + (rawResult ? rawResult.length : 0))

    if (!rawResult || rawResult.length < 30) {
      log("Tecko-R 结果过短")
      return ""
    }

    // 后处理
    var decoded = decodeAndStrip(rawResult)
    log("Tecko-R 后处理结果长度=" + decoded.length)
    return decoded
  }).catch(function (err) {
    log("请求失败: " + url + " - " + err.message)
    return ""
  })
}

// ==================== 导出 ====================

module.exports = {
  // 完整管线（推荐使用）
  extract: extract,

  // 核心算法（可单独使用）
  teckoR: teckoR,

  // 后处理
  decodeAndStrip: decodeAndStrip,

  // 工具函数
  isSPA: isSPA,
  isCaptchaPage: isCaptchaPage,
  detectRedirect: detectRedirect,
  extractFromScripts: extractFromScripts,

  // 配置常量
  MAX_P: MAX_P,
  INT_SCALE: INT_SCALE
}
