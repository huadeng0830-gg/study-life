// Keep this validation in sync with campus-life/rules.js.
const PRIVATE_CONTENT_PATTERNS = [
  /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i,
  /(?:\+?86[-\s]?)?1[3-9](?:[\s\-()（）.·—_]*\d){9}/,
  /(?:取件码|手机号|电话|微信|微\s*信|QQ|WX|WeChat|Weixin)\s*[:：]?\s*[\w-]{4,}/i,
  /(?:宿舍|寝室|\d+号楼).{0,12}\d{1,4}室/,
]

export function containsPrivateCampusDetails(value) {
  const text = String(value ?? '')
  return PRIVATE_CONTENT_PATTERNS.some((pattern) => pattern.test(text))
}
