var store = {}

export function getCached(key) {
  var entry = store[key]
  if (!entry) return null
  if (Date.now() > entry.expireAt) {
    delete store[key]
    return null
  }
  return entry.value
}

export function setCache(key, value, ttlMs) {
  store[key] = {
    value: value,
    expireAt: Date.now() + ttlMs
  }
}
