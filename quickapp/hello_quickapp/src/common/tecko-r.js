/**
 * Tecko-R: 单遍流式 DOM 语义过滤 + 门控融合 + Kadane 正文区间检测
 * 适配 QuickApp (JerryScript) 环境：无 DOM API，纯字符串扫描
 *
 * Pipeline: extractP → structFilter → baseScore → LQB → adTTL → scoreFusion → smooth → Kadane
 */

var MAX_P = 64
var INT_SCALE = 1000

// 语义容器特征词
var SEMANTIC_WORDS = ["content", "article", "detail", "main", "body", "text"]

// 排除标签
var EXCLUDED_TAGS = ["nav", "footer", "aside", "header"]

// LQB 参数
var LQB_LOW_THRESHOLD = 120
var LQB_WINDOW_LIMIT = 3

// adTTL 参数
var AD_TTL_INIT = 3
var AD_DECAY = 1
var AD_BOOST_NEAR_AD = 0.15

// ===== Step 1: 段落提取（字符串状态机 + 有界子树传播 + 结构元数据） =====

var CONTENT_TAGS = ["p", "blockquote", "cite"]

function parseTagAttrs(tagHtml) {
  var m = tagHtml.match(/^<(\w+)/)
  var tag = m ? m[1].toLowerCase() : "p"
  var cm = tagHtml.match(/class=["']([^"']+)["']/i)
  var im = tagHtml.match(/id=["']([^"']+)["']/i)
  return { tag: tag, className: cm ? cm[1] : "", id: im ? im[1] : "" }
}

function makeSeg(text, attrs) {
  return {
    text: text,
    len: text.length,
    tag: attrs ? attrs.tag : "p",
    className: attrs ? attrs.className : "",
    id: attrs ? attrs.id : "",
    isAd: false,
    lowScoreStreak: 0,
    adTTL: 0,
    total: 0
  }
}

function matchOpenTag(lower, pos, len) {
  for (var i = 0; i < CONTENT_TAGS.length; i++) {
    var t = CONTENT_TAGS[i]
    var open = "<" + t
    if (lower.indexOf(open, pos) === pos &&
        (pos + open.length >= len || " >/\n\r\t".indexOf(lower.charAt(pos + open.length)) !== -1)) {
      return t
    }
  }
  return false
}

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

    if (inExcluded === 0 && inSemantic > 0 && inPlain === 0) {
      var openTag = matchOpenTag(lower, ltPos, len)
      if (openTag) {
        var tagEnd = lower.indexOf(">", ltPos)
        if (tagEnd === -1) break
        var openHtml = html.substring(ltPos, tagEnd + 1)
        var closeTag = "</" + openTag + ">"
        var closePos = lower.indexOf(closeTag, tagEnd + 1)
        if (closePos === -1) break
        var text = html.substring(ltPos, closePos + closeTag.length)
        if (text.length > 10) {
          res.push(makeSeg(text, parseTagAttrs(openHtml)))
          if (res.length >= MAX_P) break
        }
        pos = closePos + closeTag.length
        continue
      }
    }

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

      var fbTag = matchOpenTag(lower, lt2, len)
      if (fbTag) {
        var fbTagEnd = lower.indexOf(">", lt2)
        if (fbTagEnd === -1) break
        var fbOpenHtml = html.substring(lt2, fbTagEnd + 1)
        var fbClose = "</" + fbTag + ">"
        var fbClosePos = lower.indexOf(fbClose, fbTagEnd + 1)
        if (fbClosePos === -1) break
        var fbText = html.substring(lt2, fbClosePos + fbClose.length)
        if (fbText.length > 10) {
          res.push(makeSeg(fbText, parseTagAttrs(fbOpenHtml)))
          if (res.length >= MAX_P) break
        }
        pos = fbClosePos + fbClose.length; continue
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

// ===== Step 2: 结构过滤（长度桶 + 区间相似性） =====
// 返回广告结构惩罚值（负数）

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

// 计算广告结构惩罚
function getAdStructPenalty(p) {
  return p.isAd ? -300 : 0
}

// ===== Step 3: BSC 基础评分（多维度，以0分为基准） =====

// 新闻实体特征词（人名、地名、机构名前缀/后缀）
var ENTITY_WORDS = [
  "总统", "主席", "总理", "部长", "市长", "省长", "县长", "局长",
  "公司", "集团", "企业", "机构", "部门", "委员会", "协会", "基金会",
  "大学", "学院", "研究所", "医院", "银行", "证券", "基金",
  "北京", "上海", "广州", "深圳", "中国", "美国", "日本", "欧洲", "亚洲",
  "联合国", "欧盟", "政府", "国会", "议会", "法院", "检察院"
]

// 新闻动作词
var ACTION_WORDS = [
  "宣布", "发布", "表示", "指出", "强调", "认为", "透露", "透露",
  "报道", "消息", "据悉", "了解到", "获悉", "调查显示",
  "推出", "启动", "实施", "执行", "落实", "推进", "开展",
  "增长", "下降", "提升", "扩大", "减少", "增加", "达到",
  "签署", "批准", "通过", "决定", "批准", "同意", "反对",
  "公布", "公开", "披露", "通报", "报告", "分析", "预测"
]

// 引导词（通常出现在广告或导航中）
var GUIDE_WORDS = [
  "点击", "下载", "注册", "登录", "立即", "马上", "免费", "优惠",
  "活动", "促销", "打折", "限时", "抢购", "秒杀", "领取", "获取",
  "更多", "详情", "了解", "查看", "进入", "前往", "返回", "首页"
]

function baseScore(p) {
  var s = 0
  var text = p.text
  var len = text.length

  // 去除 HTML 标签用于分析
  var cleanText = text.replace(/<[^>]+>/g, "")
  var cleanLen = cleanText.length

  // ===== 维度1: 中文字符比例（-150 ~ +200）=====
  var han = 0
  for (var i = 0; i < cleanLen; i++) {
    var c = cleanText.charCodeAt(i)
    if (c >= 0x4e00 && c <= 0x9fa5) han++
  }
  var hanRatio = (han * INT_SCALE) / (cleanLen + 1)
  if (hanRatio > 800) s += 200
  else if (hanRatio > 600) s += 150
  else if (hanRatio > 400) s += 50
  else if (hanRatio > 200) s -= 50
  else s -= 150

  // ===== 维度2: 文本长度（-100 ~ +150）=====
  if (cleanLen < 10) {
    s -= 100
  } else if (cleanLen < 30) {
    s -= 30
  } else if (cleanLen < 80) {
    s += 50
  } else if (cleanLen < 200) {
    s += 150
  } else if (cleanLen < 500) {
    s += 100
  } else {
    s += 30
  }

  // ===== 维度3: 句末标点结构（-50 ~ +200）=====
  var lastChar = ""
  for (var j = cleanLen - 1; j >= 0; j--) {
    var ch = cleanText.charAt(j)
    if (ch !== " " && ch !== "\n" && ch !== "\r" && ch !== "\t") {
      lastChar = ch
      break
    }
  }
  if (lastChar === "。" || lastChar === "！" || lastChar === "？" || lastChar === "”" || lastChar === "』") {
    s += 200
  } else if (lastChar === "；" || lastChar === "，" || lastChar === "、") {
    s += 50
  } else if (lastChar === "）" || lastChar === ")") {
    s += 80
  } else {
    s -= 50
  }

  // ===== 维度4: 新闻实体特征（0 ~ +150）=====
  var entityCount = 0
  for (var e = 0; e < ENTITY_WORDS.length; e++) {
    if (cleanText.indexOf(ENTITY_WORDS[e]) !== -1) {
      entityCount++
    }
  }
  if (entityCount >= 3) s += 150
  else if (entityCount >= 2) s += 100
  else if (entityCount >= 1) s += 50

  // ===== 维度5: 新闻动作词（0 ~ +100）=====
  var actionCount = 0
  for (var a = 0; a < ACTION_WORDS.length; a++) {
    if (cleanText.indexOf(ACTION_WORDS[a]) !== -1) {
      actionCount++
    }
  }
  if (actionCount >= 3) s += 100
  else if (actionCount >= 2) s += 70
  else if (actionCount >= 1) s += 40

  // ===== 维度6: 引导词/数字比例（-120 ~ +50）=====
  var guideCount = 0
  for (var g = 0; g < GUIDE_WORDS.length; g++) {
    if (cleanText.indexOf(GUIDE_WORDS[g]) !== -1) {
      guideCount++
    }
  }
  if (guideCount >= 4) s -= 120
  else if (guideCount >= 2) s -= 60
  else if (guideCount >= 1) s -= 20

  // 数字比例分析
  var digitCount = 0
  for (var d = 0; d < cleanLen; d++) {
    var dc = cleanText.charCodeAt(d)
    if (dc >= 48 && dc <= 57) digitCount++
  }
  var digitRatio = (digitCount * INT_SCALE) / (cleanLen + 1)
  if (digitRatio > 300) {
    s -= 80
  } else if (digitRatio > 100 && digitRatio <= 300) {
    s += 50
  }

  // ===== 维度7: 特殊符号检测（-80 ~ 0）=====
  var specialCount = 0
  var specialChars = "★●■□▲△○◇◆▼▽"
  for (var sp = 0; sp < cleanLen; sp++) {
    if (specialChars.indexOf(cleanText.charAt(sp)) !== -1) {
      specialCount++
    }
  }
  if (specialCount >= 3) s -= 80

  return s
}

// ===== Step 3.5: LQB（Low Quality Buffer） =====
// 计算连续低质量惩罚

function lqb(ps, bscScores) {
  for (var i = 0; i < ps.length; i++) {
    if (i > 0) {
      ps[i].lowScoreStreak = (bscScores[i] < LQB_LOW_THRESHOLD)
        ? ps[i - 1].lowScoreStreak + 1
        : 0
    } else {
      ps[i].lowScoreStreak = (bscScores[i] < LQB_LOW_THRESHOLD) ? 1 : 0
    }
  }
}

// 计算连续低质量惩罚
function getLowQualityPenalty(p) {
  return -Math.min(p.lowScoreStreak * 50, 150)
}

// ===== Step 3.6: adTTL（广告衰减传播） =====
// 计算广告邻近惩罚

function adTTL(ps) {
  for (var i = 1; i < ps.length; i++) {
    if (ps[i - 1].adTTL > 0) {
      ps[i].adTTL = Math.max(ps[i].adTTL, ps[i - 1].adTTL - AD_DECAY)
    }
  }
}

// 计算广告邻近惩罚（降低权重）
function getAdProximityPenalty(p) {
  return p.adTTL > 0 ? -Math.floor(p.adTTL * 25) : 0
}

// ===== Step 4: 最终分数汇总 =====
// total = BSC基础分 + 广告结构惩罚 + 连续低质惩罚 + 广告邻近惩罚

function scoreFusion(ps, bscScores) {
  for (var i = 0; i < ps.length; i++) {
    var adStructPenalty = getAdStructPenalty(ps[i])
    var lowQualityPenalty = getLowQualityPenalty(ps[i])
    var adProximityPenalty = getAdProximityPenalty(ps[i])
    ps[i].total = bscScores[i] + adStructPenalty + lowQualityPenalty + adProximityPenalty
  }
}

// ===== Step 5: SPIM（Short Paragraph Identification Module） =====
// 短段落识别：负分段落中，短文本且非广告的扭转为正分

function spim(ps) {
  for (var i = 0; i < ps.length; i++) {
    // 正分直接保留，不进 SPIM
    if (ps[i].total >= 0) {
      ps[i].spimStatus = "—"
      continue
    }

    // 负分进入 SPIM
    var cleanText = ps[i].text.replace(/<[^>]+>/g, "")
    var len = cleanText.length

    // 字符长度 = 0 → 丢弃
    if (len === 0) {
      ps[i].spimStatus = "丢弃:空"
      continue
    }

    // 字符长度 >= 15 → 丢弃
    if (len >= 15) {
      ps[i].spimStatus = "丢弃:长"
      continue
    }

    // 0 < len < 15 → 检查 adTTL 置信度
    // 高置信度（isAd 或 adTTL > 0）→ 丢弃
    if (ps[i].isAd || ps[i].adTTL > 0) {
      ps[i].spimStatus = "丢弃:ad"
      continue
    }

    // 低置信度 → 扭转 total（乘 -1）
    ps[i].total = ps[i].total * -1
    ps[i].spimStatus = "扭转"
  }
}

// ===== Step 6: 单向邻域增强（i-1） =====

function smooth(ps) {
  var out = []
  for (var i = 0; i < ps.length; i++) {
    var s = ps[i].total
    if (i > 0) {
      s += Math.floor(ps[i - 1].total * 3 / 10)
    }
    out.push(s)
  }
  return out
}

// ===== Step 6: Kadane-lite（纯执行层） =====

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

// ===== 评分表打印 =====

function logScoreTable(ps, bscScores) {
  // 表头
  console.log("\n╔══════════════════════════════════════════════════════════════════════════════════════════════════════════════════╗")
  console.log("║                                    Tecko-R 评分表                                                                ║")
  console.log("╚══════════════════════════════════════════════════════════════════════════════════════════════════════════════════╝")

  // ===== Part 1: BSC 7 个子模块评分 =====
  console.log("\n┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐")
  console.log("│  [1] BSC 基础评分 (7 个子模块)                                                                                    │")
  console.log("├──────┬──────────────────────────────────────────────────────────────────────────────────────────────────────────┤")
  console.log("│ 段落 │  ①中文比例  ②文本长度  ③句末标点  ④实体特征  ⑤动作词   ⑥引导词/数字  ⑦特殊符号  │ BSC合计 │")
  console.log("├──────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────┤")

  for (var i = 0; i < ps.length; i++) {
    var text = ps[i].text.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
    var preview = text.length > 12 ? text.substring(0, 12) + "…" : text
    // 补齐到12字符
    while (preview.length < 12) preview += " "

    // 计算各维度分数
    var cleanText = ps[i].text.replace(/<[^>]+>/g, "")
    var cleanLen = cleanText.length

    // ① 中文比例
    var han = 0
    for (var hi = 0; hi < cleanLen; hi++) { if (cleanText.charCodeAt(hi) >= 0x4e00 && cleanText.charCodeAt(hi) <= 0x9fa5) han++ }
    var hanRatio = (han * INT_SCALE) / (cleanLen + 1)
    var d1 = hanRatio > 800 ? 200 : hanRatio > 600 ? 150 : hanRatio > 400 ? 50 : hanRatio > 200 ? -50 : -150

    // ② 文本长度
    var d2 = cleanLen < 10 ? -100 : cleanLen < 30 ? -30 : cleanLen < 80 ? 50 : cleanLen < 200 ? 150 : cleanLen < 500 ? 100 : 30

    // ③ 句末标点
    var lastChar = ""
    for (var lj = cleanLen - 1; lj >= 0; lj--) { var ch = cleanText.charAt(lj); if (ch !== " " && ch !== "\n" && ch !== "\r" && ch !== "\t") { lastChar = ch; break } }
    var d3 = (lastChar === "。" || lastChar === "！" || lastChar === "？" || lastChar === "”" || lastChar === "』") ? 200
      : (lastChar === "；" || lastChar === "，" || lastChar === "、") ? 50
      : (lastChar === "）" || lastChar === ")") ? 80 : -50

    // ④ 实体特征
    var entityCount = 0
    for (var ei = 0; ei < ENTITY_WORDS.length; ei++) { if (cleanText.indexOf(ENTITY_WORDS[ei]) !== -1) entityCount++ }
    var d4 = entityCount >= 3 ? 150 : entityCount >= 2 ? 100 : entityCount >= 1 ? 50 : 0

    // ⑤ 动作词
    var actionCount = 0
    for (var ai = 0; ai < ACTION_WORDS.length; ai++) { if (cleanText.indexOf(ACTION_WORDS[ai]) !== -1) actionCount++ }
    var d5 = actionCount >= 3 ? 100 : actionCount >= 2 ? 70 : actionCount >= 1 ? 40 : 0

    // ⑥ 引导词/数字
    var guideCount = 0
    for (var gi = 0; gi < GUIDE_WORDS.length; gi++) { if (cleanText.indexOf(GUIDE_WORDS[gi]) !== -1) guideCount++ }
    var guidePenalty = guideCount >= 4 ? -120 : guideCount >= 2 ? -60 : guideCount >= 1 ? -20 : 0
    var digitCount = 0
    for (var di = 0; di < cleanLen; di++) { if (cleanText.charCodeAt(di) >= 48 && cleanText.charCodeAt(di) <= 57) digitCount++ }
    var digitRatio = (digitCount * INT_SCALE) / (cleanLen + 1)
    var digitBonus = digitRatio > 300 ? -80 : (digitRatio > 100 && digitRatio <= 300) ? 50 : 0
    var d6 = guidePenalty + digitBonus

    // ⑦ 特殊符号
    var specialCount = 0
    var specialChars = "★●■□▲△○◇◆▼▽"
    for (var si = 0; si < cleanLen; si++) { if (specialChars.indexOf(cleanText.charAt(si)) !== -1) specialCount++ }
    var d7 = specialCount >= 3 ? -80 : 0

    var bscTotal = d1 + d2 + d3 + d4 + d5 + d6 + d7

    var fmt = function (v) { return (v >= 0 ? "+" : "") + v }
    var pad4 = function (v) {
      var s = fmt(v)
      while (s.length < 4) s = " " + s
      return s
    }

    console.log("│ " + preview + " │  " + pad4(d1) + "       " + pad4(d2) + "       " + pad4(d3) + "       " + pad4(d4) + "       " + pad4(d5) + "       " + pad4(d6) + "         " + pad4(d7) + "   │  " + pad4(bscTotal) + "  │")
  }
  console.log("└──────┴──────────────────────────────────────────────────────────────────────────────────────────────────────────┘")

  // ===== Part 2: Pipeline 模块输出（去掉了 smooth 和 Kadane） =====
  console.log("\n┌───────────────────────────────────────────────────────────────────────────────────────────┐")
  console.log("│  [2] Pipeline 模块输出 (extractP → structFilter → BSC → LQB → adTTL → Fusion → SPIM)     │")
  console.log("├──────┬─────────────────────────────────────────────────────────────────────────────────── ┤")
  console.log("│ 段落 │  extractP  structFilter  BSC     LQB     adTTL   Fusion  SPIM   │")
  console.log("├──────┼─────────────────────────────────────────────────────────────────────────────────── ┤")

  for (var pi = 0; pi < ps.length; pi++) {
    var txt = ps[pi].text.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
    var pv = txt.length > 12 ? txt.substring(0, 12) + "…" : txt
    while (pv.length < 12) pv += " "

    var extractPStatus = "✓"
    var structFilterStatus = ps[pi].isAd ? "AD" : "—"
    var bscVal = pad42(bscScores[pi])
    var lqbVal = pad42(-Math.min(ps[pi].lowScoreStreak * 50, 150))
    var adTTLVal = pad42(ps[pi].adTTL > 0 ? -Math.floor(ps[pi].adTTL * 25) : 0)
    var fusionVal = pad42(ps[pi].total)
    var spimVal = ps[pi].spimStatus || "—"

    console.log("│ " + pv + " │  " + extractPStatus + "        " + structFilterStatus + "          " + bscVal + "   " + lqbVal + "   " + adTTLVal + "   " + fusionVal + "   " + spimVal + "   │")
  }
  console.log("└──────┴─────────────────────────────────────────────────────────────────────────────────── ┘")

  // 最终保留的段落
  console.log("\n  最终保留段落 (total > 0):")
  for (var ri = 0; ri < ps.length; ri++) {
    if (ps[ri].total > 0) {
      var rt = ps[ri].text.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
      var rp = rt.length > 40 ? rt.substring(0, 40) + "…" : rt
      console.log("    [" + ri + "] total=" + ps[ri].total + " → " + rp)
    }
  }
}

// 辅助：格式化到4位
function pad42(v) {
  var s = (v >= 0 ? "+" : "") + v
  while (s.length < 4) s = " " + s
  return s
}

// ===== Tecko-R 核心提取 =====

function teckoR(html) {
  if (!html || html.length < 50) return { text: "", ps: [], bscScores: [] }

  var ps = extractP(html)
  if (ps.length === 0) return { text: "", ps: [], bscScores: [] }

  // Step 3: BSC 基础评分
  var bscScores = []
  for (var i = 0; i < ps.length; i++) {
    bscScores[i] = baseScore(ps[i])
  }

  // Step 2: 结构过滤（标记广告）
  structFilter(ps)

  // Step 3.5: LQB 连续低质量检测
  lqb(ps, bscScores)

  // Step 3.6: adTTL 广告衰减传播
  adTTL(ps)

  // Step 4: 最终分数汇总（BSC + 各模块惩罚）
  scoreFusion(ps, bscScores)

  // Step 5: SPIM 短段落识别（负分扭转）
  spim(ps)

  // Ring Buffer
  if (ps.length > MAX_P) {
    ps.sort(function (a, b) { return b.total - a.total })
    ps = ps.slice(0, MAX_P)
  }

  // 过滤 - 正值保留，负值丢弃
  var out = ""
  for (var k = 0; k < ps.length; k++) {
    if (ps[k].total > 0) {
      out += ps[k].text
    }
  }

  return { text: out, ps: ps, bscScores: bscScores }
}

// ===== 内容处理工具函数 =====

// 解码实体 + 去标签，保留段落分隔
function decodeAndStrip(html) {
  if (!html) return ""
  var map = {
    "nbsp": " ", "ensp": " ", "emsp": " ", "thinsp": " ",
    "quot": "\"", "apos": "'", "lt": "<", "gt": ">",
    "amp": "&",
    "mdash": "—", "ndash": "–", "hellip": "…",
    "lsquo": "'", "rsquo": "'",
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

// 从 script 标签中提取嵌入的 JSON 数据（SPA页面）
function extractFromScripts(html) {
  var scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi
  var match
  var maxScripts = 10 // 限制遍历次数
  var count = 0

  while ((match = scriptRegex.exec(html)) !== null && count < maxScripts) {
    count++
    var scriptContent = match[1]
    if (!scriptContent || scriptContent.length < 100) continue

    // 尝试提取 window.__INITIAL_STATE__ 或 window.__DATA__ 等
    var stateMatch = scriptContent.match(/window\.__\w+__\s*=\s*(\{[\s\S]+\})\s*;?\s*$/m)
    if (stateMatch) {
      try {
        var json = JSON.parse(stateMatch[1])
        var content = findContentInJson(json, 0)
        if (content) return content
      } catch (e) {}
    }

    // 尝试直接解析整个 script 内容为 JSON
    if (scriptContent.trim().charAt(0) === "{") {
      try {
        var json2 = JSON.parse(scriptContent.trim())
        var content2 = findContentInJson(json2, 0)
        if (content2) return content2
      } catch (e) {}
    }

    // 查找 script 中的 content/body 字段
    var contentMatch = scriptContent.match(/"content"\s*:\s*"([^"]{100,})"/)
    if (contentMatch) {
      var raw = contentMatch[1]
      raw = raw.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"')
      raw = raw.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
      raw = raw.replace(/<[^>]+>/g, "\n")
      raw = raw.split(/[\r\n]+/).map(function (l) { return l.trim() }).filter(function (l) { return l.length > 0 }).join("\n\n")
      if (raw.length > 50) return raw
    }

    var bodyMatch = scriptContent.match(/"body"\s*:\s*"([^"]{100,})"/)
    if (bodyMatch) {
      var raw2 = bodyMatch[1]
      raw2 = raw2.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"')
      raw2 = raw2.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
      raw2 = raw2.replace(/<[^>]+>/g, "\n")
      raw2 = raw2.split(/[\r\n]+/).map(function (l) { return l.trim() }).filter(function (l) { return l.length > 0 }).join("\n\n")
      if (raw2.length > 50) return raw2
    }

    var descMatch = scriptContent.match(/"description"\s*:\s*"([^"]{100,})"/)
    if (descMatch) {
      return descMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"')
    }
  }
  return ""
}

// 递归查找 JSON 中的内容字段（带深度限制）
function findContentInJson(obj, depth) {
  if (!obj || typeof obj !== "object" || depth > 5) return ""

  // 直接在对象中查找 content/body/html 字段
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
  // 递归查找子对象
  var childKeys = Object.keys(obj)
  for (var j = 0; j < childKeys.length; j++) {
    var child = obj[childKeys[j]]
    if (typeof child === "object" && child !== null) {
      var result = findContentInJson(child, depth + 1)
      if (result) return result
    }
  }
  return ""
}

// 检测验证码/人机验证页面
function isCaptcha(html) {
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

// 检测重定向：meta refresh 或 JavaScript 跳转
function detectRedirect(html, currentUrl) {
  // 检测 meta refresh 跳转
  var metaRefresh = /<meta[^>]*http-equiv=["']?refresh["']?[^>]*content=["']?\d+\s*;\s*url=([^"'\s>]+)["']?/i.exec(html)
  if (metaRefresh && metaRefresh[1]) {
    return resolveUrl(metaRefresh[1], currentUrl)
  }

  // 检测 JavaScript 跳转: window.location.href = "xxx"
  var jsRedirect1 = /(?:window\.location\.href|location\.href)\s*=\s*["']([^"']+)["']/i.exec(html)
  if (jsRedirect1 && jsRedirect1[1]) {
    var newUrl = jsRedirect1[1]
    if (newUrl.length > 10 && newUrl.indexOf("http") === 0 && newUrl !== currentUrl) {
      return newUrl
    }
  }

  // 检测 JavaScript 跳转: window.location.replace("xxx")
  var jsRedirect2 = /(?:window\.location\.replace|location\.replace)\s*\(\s*["']([^"']+)["']\s*\)/i.exec(html)
  if (jsRedirect2 && jsRedirect2[1]) {
    var newUrl2 = jsRedirect2[1]
    if (newUrl2.length > 10 && newUrl2.indexOf("http") === 0 && newUrl2 !== currentUrl) {
      return newUrl2
    }
  }

  // 检测 JavaScript 跳转: window.location = "xxx"
  var jsRedirect3 = /(?:window\.location|location)\s*=\s*["']([^"']+)["']/i.exec(html)
  if (jsRedirect3 && jsRedirect3[1]) {
    var newUrl3 = jsRedirect3[1]
    if (newUrl3.length > 10 && newUrl3.indexOf("http") === 0 && newUrl3 !== currentUrl) {
      return newUrl3
    }
  }

  // 检测 window.open 跳转
  var jsRedirect4 = /window\.open\s*\(\s*["']([^"']+)["']\s*\)/i.exec(html)
  if (jsRedirect4 && jsRedirect4[1]) {
    var newUrl4 = jsRedirect4[1]
    if (newUrl4.length > 10 && newUrl4.indexOf("http") === 0 && newUrl4 !== currentUrl) {
      return newUrl4
    }
  }

  return null
}

// 解析相对URL
function resolveUrl(relative, base) {
  if (relative.indexOf("http") === 0) return relative
  try {
    var baseObj = new URL(base)
    if (relative.indexOf("//") === 0) {
      return baseObj.protocol + relative
    }
    if (relative.indexOf("/") === 0) {
      return baseObj.origin + relative
    }
    var basePath = baseObj.pathname.substring(0, baseObj.pathname.lastIndexOf("/") + 1)
    return baseObj.origin + basePath + relative
  } catch (e) {
    return relative
  }
}

// ===== 主入口：解析HTML提取正文 =====

function parseHTML(html) {
  if (!html) return { text: "", ps: [], bscScores: [], isSPA: false }

  // 1. Tecko-R 正文提取（优先）
  var result = teckoR(html)

  if (result.text && result.text.length >= 30) {
    var decoded = decodeAndStrip(result.text)
    return { text: decoded, ps: result.ps, bscScores: result.bscScores, isSPA: false }
  }

  // 2. Tecko-R 提取失败，检测是否为 SPA 页面（script 标签中有内嵌数据）
  var scriptData = extractFromScripts(html)
  if (scriptData && scriptData.length > 50) {
    // SPA 页面：返回空文本，标记 isSPA，等待后续传文
    return { text: "", ps: result.ps, bscScores: result.bscScores, isSPA: true }
  }

  // 3. 都失败
  return { text: "", ps: result.ps, bscScores: result.bscScores, isSPA: false }
}

// ===== 导出 =====

module.exports = {
  // 核心提取
  teckoR: teckoR,
  parseHTML: parseHTML,
  logScoreTable: logScoreTable,

  // 工具函数
  decodeAndStrip: decodeAndStrip,
  extractFromScripts: extractFromScripts,
  findContentInJson: findContentInJson,
  isCaptcha: isCaptcha,
  detectRedirect: detectRedirect,
  resolveUrl: resolveUrl
}
