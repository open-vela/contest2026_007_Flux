import storage from "@system.storage"

const THEME_KEY = "infoDarkMode"
var cachedTheme = null

export function getThemeSync() {
  return cachedTheme !== null ? cachedTheme : false
}

export function getTheme(callback) {
  if (cachedTheme !== null) {
    callback(cachedTheme)
    return
  }
  storage.get({
    key: THEME_KEY,
    success: function (data) {
      cachedTheme = data === "true"
      callback(cachedTheme)
    },
    fail: function () {
      cachedTheme = false
      callback(false)
    }
  })
}

export function initTheme(callback) {
  storage.get({
    key: THEME_KEY,
    success: function (data) {
      cachedTheme = data === "true"
      callback(cachedTheme)
    },
    fail: function () {
      cachedTheme = false
      callback(false)
    }
  })
}

export function setTheme(isDark) {
  cachedTheme = isDark
  storage.set({
    key: THEME_KEY,
    value: isDark ? "true" : "false"
  })
}
