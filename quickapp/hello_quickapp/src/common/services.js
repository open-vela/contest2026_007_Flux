import fetch from "@system.fetch"

const CURRENTS_API_KEY = "I_gqH5IB0yC8eS7mhIVx7LmQkx2IpDOtmCI6WTsksar1EFbA"
const CURRENTS_BASE_URL = "https://api.currentsapi.services/v1"

const PROVIDERS = {
  weather: {
    name: "UApiPro",
    url: "https://uapis.cn/api/v1/misc/weather",
    key: "",
    note: "UApiPro天气API，支持中文城市名直接查询。"
  },
  express: {
    name: "UApiPro-快递查询",
    url: "https://uapis.cn/api/v1/misc/tracking/query",
    key: "",
    note: "UApiPro快递查询API，支持主流快递公司运单号查询。"
  }
}

function encodeQuery(params) {
  const parts = []
  Object.keys(params).forEach((key) => {
    const value = params[key]
    if (value !== "" && value !== undefined && value !== null) {
      parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(value))
    }
  })
  return parts.join("&")
}

function parseData(data) {
  if (typeof data === "string") {
    try {
      return JSON.parse(data)
    } catch (err) {
      return {}
    }
  }
  return data || {}
}

function decodeHtmlEntities(text) {
  if (!text) return ""
  var map = {
    "nbsp": " ", "ensp": " ", "emsp": " ", "thinsp": " ",
    "quot": "\"", "apos": "'", "lt": "<", "gt": ">",
    "amp": "&",
    "mdash": "—", "ndash": "–", "hellip": "…",
    "lsquo": "'", "rsquo": "'",
    "ldquo": "“", "rdquo": "”",
    "copy": "©", "reg": "®", "trade": "™",
    "times": "×", "divide": "÷",
    "deg": "°", "plusmn": "±", "micro": "µ",
    "para": "¶", "middot": "·",
    "laquo": "«", "raquo": "»",
    "larr": "←", "uarr": "↑", "rarr": "→", "darr": "↓",
    "bull": "•", "star": "★",
    "lrm": "", "rlm": "", "zwnj": "", "zwj": ""
  }
  text = text.replace(/&([a-zA-Z]+);?/g, function (m, name) {
    var val = map[name]
    return val !== undefined ? val : m
  })
  text = text.replace(/&#(\d+);?/g, function (m, code) {
    var n = parseInt(code, 10)
    return (n >= 32 && n <= 65535) ? String.fromCharCode(n) : m
  })
  text = text.replace(/&#x([0-9a-fA-F]+);?/g, function (m, hex) {
    var n = parseInt(hex, 16)
    return (n >= 32 && n <= 65535) ? String.fromCharCode(n) : m
  })
  return text
}

function stripHtmlAndFilter(text) {
  if (!text) return ""
  var cleanText = decodeHtmlEntities(text)
  cleanText = cleanText.replace(/<[^>]+>/g, " ")
  var lines = cleanText.split(/[\r\n]+/)
  var filteredLines = lines.filter(function (line) { return line.indexOf("⬅️") === -1 })
  return filteredLines.join("\n").trim()
}

function cleanDescription(text) {
  if (!text) return ""
  var cleaned = decodeHtmlEntities(text)
  cleaned = cleaned.replace(/<[^>]+>/g, " ")
  cleaned = cleaned.replace(/来源[：:].*$/gm, "")
  cleaned = cleaned.replace(/编辑[：:].*$/gm, "")
  cleaned = cleaned.replace(/责任编辑[：:].*$/gm, "")
  cleaned = cleaned.replace(/【.*?】/g, "")
  cleaned = cleaned.replace(/https?:\/\/\S+/g, "")
  cleaned = cleaned.replace(/\s+/g, " ").trim()
  if (cleaned.length > 120) {
    cleaned = cleaned.substring(0, 120)
    var lastDot = cleaned.lastIndexOf("。")
    if (lastDot > 60) {
      cleaned = cleaned.substring(0, lastDot + 1)
    } else {
      cleaned = cleaned + "……"
    }
  }
  return cleaned
}

function extractSourceName(url) {
  if (!url) return ""
  try {
    var domain = url.replace(/^https?:\/\//, "").split("/")[0].replace(/^www\./, "")
    var nameMap = {
      "finance.sina.com.cn": "新浪财经",
      "news.sina.com.cn": "新浪新闻",
      "sina.com.cn": "新浪",
      "ithome.com": "IT之家",
      "news.cn": "新华网",
      "xinhuanet.com": "新华网",
      "people.com.cn": "人民网",
      "peopleapp.com": "人民网",
      "cctv.com": "央视网",
      "cctv.cn": "央视网",
      "ysxw.cctv.cn": "央视新闻",
      "huanqiu.com": "环球网",
      "163.com": "网易",
      "news.163.com": "网易新闻",
      "sohu.com": "搜狐",
      "qq.com": "腾讯新闻",
      "new.qq.com": "腾讯新闻",
      "weixin.qq.com": "微信",
      "mp.weixin.qq.com": "微信公众号",
      "weibo.com": "微博",
      "ifeng.com": "凤凰新闻",
      "thepaper.cn": "澎湃新闻",
      "yicai.com": "第一财经",
      "caixin.com": "财新网",
      "36kr.com": "36氪",
      "bjnews.com.cn": "新京报",
      "stcn.com": "证券时报",
      "cls.cn": "财联社",
      "wallstreetcn.com": "华尔街见闻",
      "jiemian.com": "界面新闻",
      "chinadaily.com.cn": "中国日报",
      "chinanews.com": "中新网",
      "cankaoxiaoxi.com": "参考消息",
      "nbd.com.cn": "每日经济新闻",
      "21jingji.com": "21世纪经济报道",
      "csdn.net": "CSDN",
      "zhihu.com": "知乎",
      "baidu.com": "百度"
    }
    if (nameMap[domain]) return nameMap[domain]
    var parts = domain.split(".")
    return parts.length >= 2 ? parts[parts.length - 2] : domain
  } catch (e) {
    return ""
  }
}

function formatDate(dateStr) {
  if (!dateStr) return ""
  var match = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (match) {
    return match[2] + "-" + match[3]
  }
  return dateStr
}

function normalizeNews(item) {
  if (!item) return null
  var category = item.category && item.category.length ? item.category.join(" / ") : ""
  var source = extractSourceName(item.url) || item.author || "未知来源"
  var title = stripHtmlAndFilter(item.title) || "未命名新闻"
  var desc = cleanDescription(item.description) || "暂无摘要"
  return {
    id: item.id || "",
    title: title,
    description: desc,
    source: source,
    category: category,
    url: item.url || "",
    published: formatDate(item.published)
  }
}

// 中国媒体域名白名单
var DOMAIN_WHITELIST = [
  "sina.com.cn", "finance.sina.com.cn", "news.sina.com.cn",
  "sohu.com",
  "163.com", "news.163.com",
  "people.com.cn", "peopleapp.com",
  "xinhuanet.com", "news.cn",
  "chinanews.com",
  "ithome.com",
  "qq.com", "new.qq.com", "weixin.qq.com", "mp.weixin.qq.com",
  "ifeng.com",
  "caixin.com",
  "36kr.com",
  "csdn.net",
  "zhihu.com",
  "weibo.com",
  "cctv.com", "cctv.cn", "ysxw.cctv.cn", "vod-finance.cctv.cn",
  "bjnews.com.cn",
  "thepaper.cn",
  "yicai.com",
  "huanqiu.com",
  "cankaoxiaoxi.com",
  "stcn.com",
  "nbd.com.cn",
  "cls.cn",
  "wallstreetcn.com",
  "jiemian.com",
  "21jingji.com",
  "ceweekly.cn",
  "chinadaily.com.cn",
  "infzm.com",
  "sztv.com.cn",
  "sznews.com",
  "hangzhou.com.cn",
  "wxrb.com",
  "xizang.gov.cn"
]

function extractDomain(url) {
  if (!url) return ""
  try {
    var domain = url.replace(/^https?:\/\//, "")
    domain = domain.split("/")[0]
    domain = domain.split(":")[0]
    domain = domain.replace(/^www\./, "")
    return domain.toLowerCase()
  } catch (e) {
    return ""
  }
}

function isTrustedDomain(url) {
  var domain = extractDomain(url)
  if (!domain) return false
  for (var i = 0; i < DOMAIN_WHITELIST.length; i++) {
    if (domain === DOMAIN_WHITELIST[i] || domain.endsWith("." + DOMAIN_WHITELIST[i])) {
      return true
    }
  }
  return false
}

/**
 * 网络请求 - 使用 success/fail 回调模式（与 detail.ux 一致）
 * 不用 .then() 链，避免框架 native 回调丢失
 */
function request(options) {
  var url = options.url
  var method = options.method || "GET"
  var responseType = options.responseType || "json"

  console.log("request: " + method + " " + url)

  return new Promise(function (resolve, reject) {
    fetch.fetch({
      url: url,
      method: method,
      header: options.header || {},
      responseType: responseType,
      success: function (res) {
        console.log("request success: code=" + (res.code || res.statusCode) + ", url=" + url)
        try {
          var code = res.code || res.statusCode
          var data = res.data !== undefined ? res.data : res.result

          if (typeof data === "string") {
            data = parseData(data)
          }

          if (code >= 200 && code < 300) {
            resolve(data)
          } else if (data && typeof data === "object" && Object.keys(data).length > 0) {
            resolve(data)
          } else {
            reject(new Error("HTTP " + code))
          }
        } catch (e) {
          reject(e)
        }
      },
      fail: function (data, code) {
        console.log("request fail: url=" + url + ", code=" + code)
        reject(new Error("network error"))
      }
    })
  })
}

/**
 * 获取天气（Promise 写法）
 */
export function getWeather(city) {
  var params = {
    extended: true,
    forecast: true,
    indices: true
  }
  if (city) {
    params.city = city
  }
  var query = encodeQuery(params)

  return request({
    url: PROVIDERS.weather.url + "?" + query
  }).then(function (data) {
    if (!data || !data.city) {
      return {
        ready: false,
        title: city,
        subtitle: "查询失败",
        message: "天气数据暂不可用",
        details: [],
        detailsExtra: [],
        indexes: [],
        forecasts: [],
        alerts: []
      }
    }

    var temp = data.temperature !== undefined ? data.temperature : "--"
    var desc = data.weather || "未知"
    var feelsLike = data.feels_like !== undefined ? data.feels_like : "--"
    var humidity = data.humidity !== undefined ? data.humidity + "%" : "--"
    var windDir = data.wind_direction || "--"
    var windPower = data.wind_power || "--"
    var clouds = data.cloud !== undefined ? data.cloud + "%" : "--"
    var vis = data.visibility !== undefined ? data.visibility + "km" : "--"
    var pressure = data.pressure !== undefined ? data.pressure + "hPa" : "--"
    var district = data.city || city
    // IP 定位时，显示 city·district（如"重庆城区·永川区"）
    if (!city && data.district) {
      district = data.city + "·" + data.district
    }
    var aqi = data.aqi || 0
    var pm25 = data.air_pollutants ? data.air_pollutants.pm25 : 0
    var pm10 = data.air_pollutants ? data.air_pollutants.pm10 : 0

    // 生活指数
    var indexes = []
    if (data.life_indices) {
      var indices = data.life_indices
      var indexNames = {
        "clothing": "穿衣", "uv": "紫外线", "car_wash": "洗车",
        "drying": "晾晒", "air_conditioner": "空调", "cold_risk": "感冒",
        "exercise": "运动", "comfort": "舒适度", "travel": "出行",
        "fishing": "钓鱼", "allergy": "过敏", "sunscreen": "防晒",
        "mood": "心情", "beer": "啤酒", "umbrella": "雨伞",
        "traffic": "交通", "air_purifier": "空气净化器", "pollen": "花粉"
      }
      for (var key in indices) {
        if (indices[key] && indices[key].brief) {
          indexes.push({
            name: indexNames[key] || key,
            brief: indices[key].brief,
            detail: indices[key].advice || ""
          })
        }
      }
    }

    // 7天预报
    var forecasts = []
    if (data.forecast) {
      for (var i = 0; i < data.forecast.length && i < 7; i++) {
        var f = data.forecast[i]
        forecasts.push({
          day: f.week || "--",
          info: (f.weather_day || "--") + "/" + (f.weather_night || "--") + " " + (f.temp_min || "--") + "~" + (f.temp_max || "--") + "°C"
        })
      }
    }

    // 预警
    var alerts = []
    if (data.alerts) {
      for (var j = 0; j < data.alerts.length; j++) {
        var alert = data.alerts[j]
        alerts.push({
          title: alert.type + alert.level + "预警 正在生效",
          alertTitle: alert.title || "",
          desc: alert.text || "",
          level: alert.level || "蓝色",
          type: alert.type || "未知"
        })
      }
    }

    return {
      ready: true,
      title: district,
      subtitle: desc,
      message: temp + "°C",
      details: [
        { label: "天气", value: desc },
        { label: "温度", value: temp + "°C" },
        { label: "体感", value: feelsLike + "°C" },
        { label: "湿度", value: humidity },
        { label: "风向", value: windDir },
        { label: "风力", value: windPower }
      ],
      detailsExtra: [
        { label: "云量", value: clouds },
        { label: "能见度", value: vis },
        { label: "气压", value: pressure },
        { label: "PM2.5", value: "" + pm25 },
        { label: "PM10", value: "" + pm10 },
        { label: "AQI", value: "" + aqi }
      ],
      indexes: indexes,
      forecasts: forecasts,
      alerts: alerts
    }
  })
}

/**
 * 获取新闻（Promise 写法）
 */
export function getLatestNews(options) {
  var params = options || {}
  var categories = params.categories && params.categories.length ? params.categories.join(",") : ""

  var query = encodeQuery({
    language: "zh",
    country: "CN",
    category: categories,
    page_size: params.pageSize || 20,
    apiKey: CURRENTS_API_KEY.trim()
  })

  return request({
    url: CURRENTS_BASE_URL + "/latest-news?" + query
  }).then(function (data) {
    if (!data || data.status !== "ok" || !data.news) {
      return []
    }
    var filtered = data.news
      .map(normalizeNews)
      .filter(function (item) {
        if (!item) return false
        if (!isTrustedDomain(item.url)) {
          return false
        }
        if (!item.description || item.description === item.title) {
          return false
        }
        return true
      })
    return filtered
  })
}

/**
 * 获取历史上的今天（Promise 写法）
 */
export function getTodayInHistory() {
  return request({
    url: "https://tmini.net/api/today?type=json"
  }).then(function (data) {
    if (!data || data.code !== 200 || !data.events) {
      return []
    }
    var result = data.events.slice(0, 5).map(function (item) {
      return {
        title: item.title || "",
        year: item.year || "",
        desc: item.desc || "",
        link: item.link || ""
      }
    })
    return result
  })
}

/**
 * 获取快递信息（Promise 写法）
 * @param {string} trackingNo - 运单号
 * @param {string} phone - 收件人手机号尾号（顺丰等快递公司需要）
 */
export function getExpress(trackingNo, phone) {
  var provider = PROVIDERS.express
  if (!trackingNo) {
    return Promise.resolve({
      ready: false,
      title: "请输入运单号",
      subtitle: provider.name,
      details: ["支持主流快递公司", "输入运单号后点击查询按钮"]
    })
  }

  var params = {
    tracking_number: trackingNo
  }
  if (phone) {
    params.phone = phone
  }

  var query = encodeQuery(params)

  return request({
    url: provider.url + "?" + query
  }).then(function (data) {
    if (data && data.tracking_number) {
      var tracks = data.tracks || []
      var carrierName = data.carrier_name || "快递公司"
      var statusText = data.status || ""

      return {
        ready: true,
        title: data.tracking_number || trackingNo,
        subtitle: carrierName,
        status: statusText,
        details: tracks.map(function (item, index) {
          return {
            time: item.time || "",
            text: item.context || "",
            isLatest: index === 0
          }
        })
      }
    } else if (data && data.message) {
      // API返回错误信息，抛出异常让调用方处理
      throw new Error(data.message)
    } else {
      return {
        ready: false,
        title: trackingNo,
        subtitle: "查询失败",
        status: "",
        details: []
      }
    }
  }).catch(function (err) {
    if (err.message) {
      throw err
    }
    return {
      ready: false,
      title: trackingNo,
      subtitle: "查询出错",
      status: "",
      details: []
    }
  })
}
