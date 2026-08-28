// 账本模块业务层：分类、消费记录存储、自然输入解析、常记推导。
// 只新增存储键（sl_expenses / sl_ledger_categories / sl_ledger_freq），不触碰任何既有数据。
import { useStoredRef } from './store.js'

export const DEFAULT_CATEGORIES = [
  { key: 'food', name: '餐饮', icon: '🍜', hidden: false },
  { key: 'transit', name: '出行', icon: '🚇', hidden: false },
  { key: 'shop', name: '购物', icon: '🛍️', hidden: false },
  { key: 'life', name: '生活', icon: '🏠', hidden: false },
  { key: 'study', name: '学习', icon: '📚', hidden: false },
  { key: 'fun', name: '娱乐', icon: '🎮', hidden: false },
  { key: 'health', name: '健康', icon: '💊', hidden: false },
  { key: 'sub', name: '订阅', icon: '📺', hidden: false },
  { key: 'other', name: '其他', icon: '📦', hidden: false },
]

export const expenses = useStoredRef('sl_expenses', [])
export const ledgerCategories = useStoredRef('sl_ledger_categories', DEFAULT_CATEGORIES)
export const freqPrefs = useStoredRef('sl_ledger_freq', { pinned: [], hidden: [] })

// ---------- 分类 ----------
export function activeCategories() {
  return ledgerCategories.value.filter((c) => !c.hidden)
}

export function catInfo(key) {
  return ledgerCategories.value.find((c) => c.key === key) ?? { key: 'other', name: '其他', icon: '📦' }
}

const KEYWORDS = [
  ['food', '午饭 晚饭 早饭 早餐 午餐 晚餐 餐 饭 食堂 面 米线 米饭 奶茶 咖啡 小吃 外卖 夜宵 烧烤 火锅 汉堡 饺 包子 面包 蛋糕 零食 饮料 果汁 汤 串 麻辣烫 螺蛳粉 盖饭 快餐 食堂'],
  ['transit', '地铁 公交 打车 网约车 出租车 车票 高铁 火车 机票 航班 油费 加油 停车 过路 骑行 单车 共享 充电宝? 飞机 大巴'],
  ['study', '打印 复印 论文 资料 书 教材 笔记本 笔 文具 试卷 课程 网课 考试 报名 学费 考 研 题库 墨 盒 纸'],
  ['shop', '衣服 鞋 裤 子 袋 快递 包裹 网购 淘 京东 拼多 超市 日用 抽纸 洗衣 液 牙膏 毛巾 数据线 充电器 耳机 键盘 鼠标 手机壳 贴膜'],
  ['life', '水电 水费 电费 燃气 煤气 房租 话费 话 费 流量 充值 理发 剪头 洗衣 备注 维修 钥匙 家居'],
  ['fun', '电影 游戏 Steam 唱 KTV 演出 演唱 会 门票 景点 旅游 会员?剧本 密室 桌游 手办'],
  ['health', '药 药店 诊 医 疗 挂号 体检 疫苗 维生素 保健 隐形 眼镜'],
  ['sub', '会员 订阅 plus Plus VIP vip 云盘 网盘 iCloud 百度网盘 腾讯 爱奇艺 腾讯视频 优酷 音乐 网易云 QQ 音乐 崛起 app store AppStore 应用 付款 自动续费 GPT ChatGPT'],
]

export function detectCategory(name) {
  const text = String(name ?? '')
  if (!text.trim()) return 'other'
  for (const [key, words] of KEYWORDS) {
    for (const word of words.split(/\s+/)) {
      const w = word.replace(/\?$/, '')
      if (!w) continue
      if (text.toLowerCase().includes(w.toLowerCase())) return key
    }
  }
  return 'other'
}

// 固定账单分类名 → 账本分类 key
export function billCategoryToKey(name) {
  const map = { 会员订阅: 'sub', 通讯网络: 'sub', 生活缴费: 'life', 住房: 'life', 保险: 'life', 其他: 'other' }
  return map[name] ?? detectCategorySilent(name)
}
function detectCategorySilent(name) {
  const key = detectCategory(name)
  return key === 'other' ? 'other' : key
}

// ---------- 自然输入解析 ----------
// 「午饭 18」→ { name: '午饭', amount: '18' }
// 「会员 25 每月15号」→ { name: '会员', amount: '25', cycle: { kind:'monthly', day:15 } }
export function parseNatural(text) {
  let rest = String(text ?? '').trim()
  let amount = ''
  let cycle = null

  const mAmount = rest.match(/^(.*?)[\s　]*([¥￥]?\s*\d+(?:\.\d{1,2})?)$/)
  if (mAmount && mAmount[1].trim()) {
    rest = mAmount[1].trim()
    amount = mAmount[2].replace(/[¥￥\s]/g, '')
  }

  const mCycle = rest.match(/(每个月|每月|每星期|每周|每年)\s*(\d{1,2})?\s*[号日]?/)
  if (mCycle) {
    const word = mCycle[1]
    const kind = word.includes('周') ? 'weekly' : word.includes('年') ? 'yearly' : 'monthly'
    const day = mCycle[2] ? Math.min(31, Math.max(1, Number(mCycle[2]))) : null
    cycle = { kind, day }
    rest = rest.replace(mCycle[0], '').trim()
  }

  return { name: rest, amount, cycle }
}

// ---------- 常记推导 ----------
// 规则：出现 ≥2 次的名称自动进入；最近使用加权靠前；金额/分类沿用最近一次。
// 用户可固定（pinned）或隐藏（hidden）。
export function computeFrequent(list, prefs, limit = 6) {
  const map = new Map()
  for (const e of list) {
    const name = String(e.name ?? '').trim()
    if (!name) continue
    const ts = Date.parse(e.createdAt || `${e.date}T${e.time || '00:00'}`) || 0
    const prev = map.get(name)
    if (!prev) {
      map.set(name, { name, amount: Number(e.amount) || 0, cat: e.cat, count: 1, last: ts })
    } else {
      prev.count += 1
      if (ts >= prev.last) {
        prev.last = ts
        prev.amount = Number(e.amount) || 0
        prev.cat = e.cat
      }
    }
  }
  const now = Date.now()
  const pinned = Array.isArray(prefs?.pinned) ? prefs.pinned : []
  const hidden = Array.isArray(prefs?.hidden) ? prefs.hidden : []
  const out = []
  for (const item of map.values()) {
    if (hidden.includes(item.name)) continue
    const isPinned = pinned.includes(item.name)
    if (item.count < 2 && !isPinned) continue
    const days = Math.max(0, (now - item.last) / 86400000)
    item.score = item.count / (1 + days / 7) + (isPinned ? 1e6 : 0)
    out.push(item)
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit)
}
