// 账本分类词典：只放稳定的分类定义与规则数据，不依赖 Vue 或 localStorage。
// 这样手动记账、QuickRecord、固定账单和旧版快速录入都能共享同一套语义。

/** @type {number} */
export const CATEGORY_CONFIDENCE_THRESHOLD = 0.75

// 旧 key 必须继续保留：历史交易只保存 categoryId（当前字段为 cat）。
// 新名称可以改，但不能用改名生成另一套 ID。
/** @type {readonly { key: string, name: string, icon: string, scope: 'expense'|'income', hidden: boolean, isDefault: boolean }[]} */
export const DEFAULT_EXPENSE_CATEGORIES = Object.freeze([
  { key: 'food', name: '餐饮', icon: '🍜', scope: 'expense', hidden: false, isDefault: true },
  { key: 'drink', name: '饮品', icon: '☕', scope: 'expense', hidden: false, isDefault: true },
  { key: 'snack', name: '零食', icon: '🍪', scope: 'expense', hidden: false, isDefault: true },
  { key: 'transit', name: '交通', icon: '🚇', scope: 'expense', hidden: false, isDefault: true },
  { key: 'shop', name: '购物', icon: '🛍️', scope: 'expense', hidden: false, isDefault: true },
  { key: 'study', name: '学习', icon: '📚', scope: 'expense', hidden: false, isDefault: true },
  { key: 'digital', name: '数码', icon: '💻', scope: 'expense', hidden: false, isDefault: true },
  { key: 'fun', name: '娱乐', icon: '🎮', scope: 'expense', hidden: false, isDefault: true },
  { key: 'daily-supplies', name: '生活用品', icon: '🧴', scope: 'expense', hidden: false, isDefault: true },
  { key: 'daily-service', name: '日用服务', icon: '✂️', scope: 'expense', hidden: false, isDefault: true },
  { key: 'bathing', name: '沐浴', icon: '🛁', scope: 'expense', hidden: false, isDefault: true },
  { key: 'housing', name: '住房', icon: '🏠', scope: 'expense', hidden: false, isDefault: true },
  { key: 'utilities', name: '水电网', icon: '💡', scope: 'expense', hidden: false, isDefault: true },
  { key: 'communication', name: '通讯', icon: '📱', scope: 'expense', hidden: false, isDefault: true },
  { key: 'health', name: '医疗', icon: '💊', scope: 'expense', hidden: false, isDefault: true },
  { key: 'sports', name: '运动', icon: '🏃', scope: 'expense', hidden: false, isDefault: true },
  { key: 'social', name: '社交', icon: '🎁', scope: 'expense', hidden: false, isDefault: true },
  { key: 'travel', name: '旅行', icon: '✈️', scope: 'expense', hidden: false, isDefault: true },
  { key: 'pet', name: '宠物', icon: '🐾', scope: 'expense', hidden: false, isDefault: true },
  { key: 'sub', name: '订阅会员', icon: '🔁', scope: 'expense', hidden: false, isDefault: true },
  { key: 'other', name: '其它', icon: '⋯', scope: 'expense', hidden: false, isDefault: true },
])

/** @type {readonly { key: string, name: string, icon: string, scope: 'expense'|'income', hidden: boolean, isDefault: boolean }[]} */
export const DEFAULT_INCOME_CATEGORIES = Object.freeze([
  { key: 'salary', name: '工资', icon: '💼', scope: 'income', hidden: false, isDefault: true },
  { key: 'part-time', name: '兼职', icon: '🧑‍💻', scope: 'income', hidden: false, isDefault: true },
  { key: 'scholarship', name: '奖学金', icon: '🎓', scope: 'income', hidden: false, isDefault: true },
  { key: 'allowance', name: '生活费', icon: '💰', scope: 'income', hidden: false, isDefault: true },
  { key: 'reimbursement', name: '报销', icon: '🧾', scope: 'income', hidden: false, isDefault: true },
  { key: 'refund', name: '退款', icon: '↩️', scope: 'income', hidden: false, isDefault: true },
  { key: 'red-envelope', name: '红包', icon: '🧧', scope: 'income', hidden: false, isDefault: true },
  { key: 'resale', name: '二手出售', icon: '♻️', scope: 'income', hidden: false, isDefault: true },
  { key: 'other-income', name: '其它收入', icon: '＋', scope: 'income', hidden: false, isDefault: true },
])

/** @type {readonly { key: string, name: string, icon: string, scope: 'expense'|'income', hidden: boolean, isDefault: boolean }[]} */
export const DEFAULT_CATEGORIES = Object.freeze([
  ...DEFAULT_EXPENSE_CATEGORIES,
  ...DEFAULT_INCOME_CATEGORIES,
])

const DEFAULT_BY_KEY = new Map(DEFAULT_CATEGORIES.map((/** @type {{key: string}} */ category) => [category.key, category]))
const OLD_DEFAULT_NAMES = Object.freeze({
  food: ['餐饮'],
  transit: ['出行', '交通'],
  shop: ['购物'],
  life: ['生活'],
  study: ['学习'],
  fun: ['娱乐'],
  health: ['健康', '医疗'],
  sub: ['订阅', '订阅会员'],
  other: ['其他', '其它'],
})

/**
 * @param {unknown} value
 * @returns {{ key: string, name: string, icon: string, scope: 'expense'|'income', hidden: boolean, isDefault: boolean }[]}
 */
export function normalizeLedgerCategories(value) {
  const input = Array.isArray(value) ? value : []
  const result = []
  const seen = new Set()

  for (const item of input) {
    const key = String(item?.key ?? '').trim()
    if (!key || seen.has(key)) continue
    const defaultItem = DEFAULT_BY_KEY.get(key)
    const oldName = String(item?.name ?? '').trim()
    const isLegacyLife = key === 'life' && (!oldName || oldName === '生活')
    const shouldUseDefaultName = defaultItem && OLD_DEFAULT_NAMES[key]?.includes(oldName)
    result.push({
      ...(defaultItem || {}),
      ...item,
      key,
      name: shouldUseDefaultName || !oldName ? (defaultItem?.name || oldName || '未命名分类') : oldName,
      icon: String(item?.icon || defaultItem?.icon || '⋯'),
      scope: item?.scope === 'income' || defaultItem?.scope === 'income' ? 'income' : 'expense',
      hidden: Boolean(item?.hidden) || isLegacyLife,
      isDefault: Boolean(item?.isDefault || defaultItem),
      ...(isLegacyLife ? { legacy: true } : {}),
    })
    seen.add(key)
  }

  for (const item of DEFAULT_CATEGORIES) {
    if (!seen.has(item.key)) result.push({ ...item })
  }
  return result
}

/**
 * @param {{scope?: string}|null|undefined} category
 * @param {'expense'|'income'} [fallback='expense']
 * @returns {'expense'|'income'}
 */
export function categoryScope(category, fallback = 'expense') {
  return category?.scope === 'income' ? 'income' : fallback
}

/**
 * @param {string} key
 * @returns {string}
 */
export function normalizeCategoryKey(key) {
  const value = String(key ?? '').trim()
  return value === 'transport' ? 'transit' : value
}

/** @type {readonly string[]} */
export const COMMON_EXPENSE_CATEGORY_KEYS = Object.freeze([
  'food', 'drink', 'transit', 'shop', 'study', 'daily-supplies', 'fun',
])

/** @type {readonly string[]} */
export const COMMON_INCOME_CATEGORY_KEYS = Object.freeze([
  'salary', 'allowance', 'part-time', 'scholarship', 'refund',
])

/** @type {readonly { key: string, terms: readonly string[], confidence: number }[]} */
const RULES = Object.freeze([
  { key: 'food', terms: ['早餐', '早饭', '午饭', '午餐', '晚饭', '晚餐', '夜宵', '正餐', '主食', '饭菜', '外卖', '外卖饭', '牛肉面', '拉面', '面条', '米线', '米饭', '炒饭', '盖饭', '麻辣烫', '火锅', '烧烤', '汉堡', '披萨', '食堂', '饺子', '包子', '快餐', '螺蛳粉'], confidence: 0.96 },
  { key: 'social', terms: ['请客', '送礼', '红包', '聚会分摊', '朋友礼物', '人情往来', '人情', 'AA分摊'], confidence: 0.94 },
  { key: 'drink', terms: ['奶茶', '咖啡', '果茶', '茶饮', '可乐', '雪碧', '果汁', '矿泉水', '饮料', '气泡水', '酸奶饮品', '瑞幸', '星巴克', '蜜雪冰城', '霸王茶姬'], confidence: 0.96 },
  { key: 'snack', terms: ['薯片', '饼干', '巧克力', '糖果', '辣条', '坚果', '方便面', '冰淇淋', '小吃零食', '零食'], confidence: 0.95 },
  { key: 'utilities', terms: ['电费', '水费', '燃气', '煤气', '宽带', '校园网', '网络费用', '水电网', '水电费'], confidence: 0.97 },
  { key: 'communication', terms: ['手机话费', '话费', '流量包', '电话卡', '短信服务', '手机充值', '流量充值'], confidence: 0.95 },
  { key: 'housing', terms: ['房租', '住宿费', '宿舍费', '宿舍住宿', '物业费', '物业', '租房'], confidence: 0.95 },
  { key: 'sub', terms: ['视频网站会员', '音乐会员', '网盘会员', '软件订阅', 'AI软件订阅', '自动续费', '会员', '订阅', 'iCloud', '云服务', '云盘', '网盘', '爱奇艺', '腾讯视频', '优酷', 'ChatGPT', 'GPT Plus'], confidence: 0.94 },
  { key: 'health', terms: ['医院', '挂号', '药品', '药店', '体检', '牙医', '眼镜验光', '医疗用品', '疫苗', '维生素', '保健'], confidence: 0.95 },
  { key: 'sports', terms: ['健身房', '球馆', '游泳', '运动场地', '健身课程', '运动活动', '羽毛球馆', '篮球场'], confidence: 0.94 },
  { key: 'pet', terms: ['宠物粮', '宠物用品', '宠物医院', '宠物洗护', '猫粮', '狗粮', '猫砂', '狗狗'], confidence: 0.95 },
  { key: 'travel', terms: ['景点', '酒店', '旅行团', '旅游活动', '旅行杂费', '门票'], confidence: 0.9 },
  { key: 'fun', terms: ['电影', '游戏', 'Steam', 'KTV', '桌游', '电玩城', '演出', '演唱会', '剧本杀', '密室', '娱乐App', '娱乐消费'], confidence: 0.93 },
  { key: 'study', terms: ['论文打印', '打印论文', '教材打印', '打印教材', '作业打印', '打印作业', '学习资料打印', '教材', '参考书', '书本', '文具', '网课', '课程', '考试报名', '报名费', '学习软件', '题库', '打印学习材料'], confidence: 0.94 },
  { key: 'daily-service', terms: ['理发', '剪头', '洗衣店', '维修', '开锁', '洗鞋', '家政', '缝补', '普通打印', '普通复印', '证件打印', '材料打印', '打印', '复印'], confidence: 0.78 },
  { key: 'digital', terms: ['手机', '电脑', '平板', '耳机', '键盘', '鼠标', 'U盘', '硬盘', '数据线', '充电器', '数码配件', '手机壳', '移动硬盘', '显示器', '路由器'], confidence: 0.95 },
  { key: 'daily-supplies', terms: ['纸巾', '抽纸', '洗衣液', '洗发水', '沐浴露', '牙膏', '牙刷', '垃圾袋', '洗洁精', '卫生用品', '清洁用品', '毛巾', '日常消耗品'], confidence: 0.95 },
  { key: 'bathing', terms: ['澡堂', '洗浴', '洗澡', '沐浴', '浴资', '温泉', '浴室', '足浴'], confidence: 0.94 },
  { key: 'shop', terms: ['衣服', '裤子', '鞋子', '鞋', '包', '饰品', '网购商品', '家具小物', '桌面摆件', '书包', '收纳盒', '淘宝购物', '买东西'], confidence: 0.82 },
  { key: 'transit', terms: ['公交', '地铁', '出租车', '网约车', '打车', '滴滴', '高铁', '火车', '机票', '航班', '共享单车', '停车', '高速费', '车票', '加油', '油费', '过路费'], confidence: 0.96 },
])

/** @type {readonly { key: string, terms: readonly string[], confidence: number }[]} */
const MERCHANT_RULES = Object.freeze([
  { key: 'drink', terms: ['瑞幸', '星巴克', '蜜雪冰城', '霸王茶姬'], confidence: 0.86 },
  { key: 'food', terms: ['肯德基', '麦当劳', '海底捞', '食堂'], confidence: 0.86 },
  { key: 'shop', terms: ['淘宝', '京东', '拼多多'], confidence: 0.56 },
])

/** @type {readonly { key: string, terms: readonly string[], confidence: number }[]} */
const INCOME_RULES = Object.freeze([
  { key: 'salary', terms: ['工资', '薪资', '发工资', '工资到账'], confidence: 0.97 },
  { key: 'part-time', terms: ['兼职', '兼职赚', '兼职工资'], confidence: 0.97 },
  { key: 'scholarship', terms: ['奖学金', '助学金'], confidence: 0.98 },
  { key: 'allowance', terms: ['生活费', '家里转账', '家里给钱'], confidence: 0.96 },
  { key: 'reimbursement', terms: ['报销', '报销款'], confidence: 0.96 },
  { key: 'refund', terms: ['退款', '退货退款', '淘宝退款', '外卖退款'], confidence: 0.98 },
  { key: 'red-envelope', terms: ['收到红包', '红包到账', '收红包'], confidence: 0.96 },
  { key: 'resale', terms: ['二手出售', '卖出', '闲置出售', '转卖'], confidence: 0.94 },
])

/**
 * @param {string} text
 * @param {string} term
 * @returns {boolean}
 */
function textIncludes(text, term) {
  return text.toLocaleLowerCase().includes(String(term).toLocaleLowerCase())
}

/**
 * @param {unknown} overrides
 * @param {'expense'|'income'} direction
 * @returns {{ term: string, key: string, direction: 'expense'|'income' }[]}
 */
function normalizeOverrideEntries(overrides, direction) {
  if (Array.isArray(overrides)) return overrides
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({ term: item.term ?? item.keyword, key: item.key ?? item.category, direction: item.direction || 'expense' }))
    .filter((item) => item.direction === direction && String(item.term ?? '').trim() && String(item.key ?? '').trim())
  if (!overrides || typeof overrides !== 'object') return []
  return Object.entries(overrides)
    .map(([term, key]) => ({ term, key, direction }))
    .filter((item) => String(item.term).trim() && String(item.key).trim())
}

/**
 * @param {string} text
 * @param {'expense'|'income'} direction
 * @param {unknown} overrides
 * @returns {{ term: string, key: string, direction: 'expense'|'income' } | null}
 */
function findOverride(text, direction, overrides) {
  return normalizeOverrideEntries(overrides, direction)
    .filter((item) => textIncludes(text, item.term))
    .sort((a, b) => String(b.term).length - String(a.term).length)[0] || null
}

/**
 * @param {string} text
 * @param {{ key: string, terms: readonly string[], confidence: number }} rule
 * @returns {readonly string[]}
 */
function ruleMatch(text, rule) {
  const matches = rule.terms.filter((term) => textIncludes(text, term))
  return matches.length ? matches : []
}

/**
 * @param {string} key
 * @param {number} confidence
 * @param {string} matchedBy
 * @param {readonly string[]} matchedTerms
 * @param {object} extra
 * @returns {{ categoryId: string, confidence: number, uncertain: boolean, matchedBy: string, matchedTerms: readonly string[], candidates: readonly string[], ambiguous: boolean }}
 */
function result(key, confidence, matchedBy, matchedTerms, extra = {}) {
  return {
    categoryId: key,
    confidence,
    uncertain: confidence < CATEGORY_CONFIDENCE_THRESHOLD,
    matchedBy,
    matchedTerms,
    candidates: extra.candidates || [key],
    ambiguous: Boolean(extra.ambiguous),
    ...extra,
  }
}

/**
 * @param {string} text
 * @param {{ direction?: 'expense'|'income', overrides?: unknown, recentCategory?: string }} [options={}]
 * @returns {{ categoryId: string, confidence: number, uncertain: boolean, matchedBy: string, matchedTerms: readonly string[], candidates: readonly string[], ambiguous: boolean }}
 */
export function classifyText(text, options = {}) {
  const source = String(text ?? '').trim()
  const scope = options.direction === 'income' ? 'income' : 'expense'
  if (!source) return result(scope === 'income' ? 'other-income' : 'other', 0.1, 'default', [])

  const override = findOverride(source, scope, options.overrides)
  if (override) return result(override.key, 0.99, 'user', [override.term])

  const rules = scope === 'income' ? INCOME_RULES : RULES
  const firstMatches = rules.map((rule) => ({ rule, matches: ruleMatch(source, rule) })).filter((item) => item.matches.length)

  if (scope === 'expense') {
    const food = firstMatches.find((item) => item.rule.key === 'food')
    const drink = firstMatches.find((item) => item.rule.key === 'drink')
    const supplies = firstMatches.find((item) => item.rule.key === 'daily-supplies')
    if (food && drink) return result('food', 0.98, 'content', [...food.matches, ...drink.matches], { candidates: ['food', 'drink'] })
    if (drink && supplies) return result('daily-supplies', 0.68, 'content', [...drink.matches, ...supplies.matches], { candidates: ['daily-supplies', 'drink'], ambiguous: true })
  }

  const matched = firstMatches[0]
  if (matched) return result(matched.rule.key, matched.rule.confidence, 'content', matched.matches)

  if (scope === 'expense') {
    const merchant = MERCHANT_RULES.map((rule) => ({ rule, matches: ruleMatch(source, rule) })).find((item) => item.matches.length)
    if (merchant) return result(merchant.rule.key, merchant.rule.confidence, 'merchant', merchant.matches)
  }

  if (options.recentCategory) return result(options.recentCategory, 0.7, 'recent', [], { candidates: [options.recentCategory] })
  return result(scope === 'income' ? 'other-income' : 'other', 0.2, 'default', [])
}

export { RULES as LEDGER_CATEGORY_RULES, MERCHANT_RULES as LEDGER_MERCHANT_RULES, INCOME_RULES as LEDGER_INCOME_RULES }