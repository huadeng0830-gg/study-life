const intentRules = [
  { value: 'vent', words: ['不求建议', '不想要建议', '不需要建议', '不要建议', '不想听建议', '只是想说说', '只想说说', '想倾诉', '只想分享', '只是分享', '分享一件事', '随手记录', '只想记录', '我想发一条', '我只是想说'] },
  { value: 'experience', words: ['有没有人也', '类似经历', '别人也这样', '只有我这样', '有人经历过', '分享经历', '亲身经历', '分享亲身经历', '我的经历'] },
  { value: 'advice', words: ['求建议', '给点建议', '想听建议', '帮我想办法', '怎么处理', '怎么解决', '该怎么办', '我该怎么办', '求助'] },
  { value: 'judgment', words: ['是不是我想多了', '我是不是想多了', '是不是我的问题', '我做错了吗', '对不对'] },
  { value: 'decision', words: ['选哪个', '怎么选', '买哪个', '要不要买', '该不该', '考研还是就业', '还是就业', 'a还是b', 'a/b', '两个'] },
  { value: 'information', words: ['几点关门', '几点开门', '在哪里', '怎么去', '怎么样', '靠谱吗', '有没有人知道', '真实情况'] },
  { value: 'vent', words: ['没有朋友', '没什么朋友', '没有真正的朋友', '没有什么真正的朋友', '很孤独', '想分享', '只分享'] },
]

const categoryRules = [
  { value: 'dormitory', words: ['室友', '宿舍', '寝室', '打游戏太吵', '熄灯'] },
  { value: 'relationship', words: ['朋友', '同学关系', '社团', '学长', '学姐', '对象', '分手', '人际'] },
  { value: 'career', words: ['考研', '就业', '实习', '找工作', '职业'] },
  { value: 'purchase', words: ['二手', '买哪个', '值得买吗', '平板', 'ipad', '电脑', '预算'] },
  { value: 'transport', words: ['校车', '班车', '公交', '出行'] },
  { value: 'lost_found', words: ['丢了', '丢失', '捡到', '失物'] },
  { value: 'campus_info', words: ['快递', '几点关门', '食堂', '打印店', '图书馆', '在哪里', '商店'] },
  { value: 'academic', words: ['老师', '课程', '上课', '考试', '作业', '选课'] },
]

const safetyTerms = ['自杀', '想死', '不想活', '伤害自己', '自残', '轻生', '被打', '被威胁', '正在伤害', '人身安全']

function matchRule(text, rules, fallback) {
  return rules.find((rule) => rule.words.some((word) => text.includes(word)))?.value || fallback
}

export function analyzeCampusMatter(content = '') {
  const normalized = String(content).toLowerCase().replace(/\s+/g, ' ').trim()
  const category = matchRule(normalized, categoryRules, 'other')
  const intent = matchRule(normalized, intentRules, '')

  let followUp = null
  if (normalized.length >= 8 && category === 'dormitory' && !/沟通过|说过|谈过/.test(normalized)) {
    followUp = { key: 'communication', question: '你之前和室友沟通过吗？', options: ['还没有', '提过一次', '聊过几次', '不方便说'] }
  } else if (normalized.length >= 8 && category === 'relationship' && !/持续|很久|一周|几次|多久/.test(normalized)) {
    followUp = { key: 'duration', question: '这件事最近发生过一次，还是已经持续一段时间？', options: ['最近一次', '一两周了', '已经很久', '说不清楚'] }
  } else if (normalized.length >= 8 && category === 'purchase' && intent === 'decision') {
    followUp = { key: 'priority', question: '你最看重哪一点？', options: ['价格', '性能', '耐用和售后', '还没想好'] }
  } else if (normalized.length >= 8 && category === 'career') {
    followUp = { key: 'priority', question: '你目前更在意什么？', options: ['收入', '稳定', '发展空间', '还没想好'] }
  } else if (normalized.length >= 8 && category === 'campus_info' && /几点|什么时候|时间/.test(normalized)) {
    followUp = { key: 'time', question: '你想确认哪一天或哪个时段的信息？', options: ['工作日', '周末', '节假日', '具体日期我稍后补充'] }
  }

  const relatedType = category === 'purchase' ? 'market_listing'
    : category === 'academic' && /老师|教授/.test(normalized) ? 'teacher'
      : category === 'academic' ? 'course'
        : category === 'transport' ? 'shuttle_route'
          : category === 'campus_info' || category === 'dormitory' ? 'place' : ''
  const searchTerms = []
  const keywordGroups = [
    ['宿舍', ['室友', '宿舍', '寝室', '打游戏']], ['消费', ['二手', '平板', 'iPad', '电脑']],
    ['快递', ['快递', '取件']], ['老师', ['老师', '教授']], ['课程', ['课程', '选课', '考试']],
    ['地点', ['食堂', '商店', '打印店', '图书馆']], ['校车', ['校车', '班车']],
    ['关系', ['社团', '朋友', '学长', '学姐']], ['职业', ['考研', '就业', '实习']],
  ]
  for (const [, words] of keywordGroups) {
    for (const word of words) {
      if (normalized.includes(word.toLowerCase()) && !searchTerms.includes(word)) searchTerms.push(word)
      if (searchTerms.length >= 3) break
    }
    if (searchTerms.length >= 3) break
  }
  if (category === 'dormitory' && !searchTerms.includes('室友')) searchTerms.push('室友')
  return { intent, category, followUp, relatedType, searchTerms: searchTerms.slice(0, 3), highRisk: safetyTerms.some((term) => normalized.includes(term)) }
}

export const matterIntentLabels = Object.freeze({
  vent: '分享一件事，不求建议', advice: '我想问个问题', experience: '分享亲身经历',
  information: '分享或核实信息', decision: '我在做选择', judgment: '帮我换个角度看',
})
export const matterCategoryLabels = Object.freeze({
  dormitory: '宿舍', relationship: '人际关系', academic: '学业', career: '学业与就业',
  purchase: '消费决策', campus_info: '校园信息', transport: '出行', lost_found: '失物', other: '其他',
})
export const matterStatusLabels = Object.freeze({
  finding_help: '寻找办法', considering: '正在考虑', trying: '正在尝试', resolved: '已解决', paused: '暂时搁置', venting: '自由分享',
  outcome_hidden: '发起者隐藏了后续状态',
})
export const matterOutcomeLabels = Object.freeze({
  solved: '解决了', improved: '有改善，但还没完全解决', ongoing: '还在处理', no_help: '这个办法没有帮助', no_action: '最后没有采取行动',
})

export function matterSafetyText(highRisk) {
  return highRisk
    ? '如果你或身边的人现在有立即的人身危险，请先联系可信任的人，并联系学校正式的安全或医疗支持渠道；紧急情况下联系当地急救或警方。本页面的同学经验不能替代专业帮助。'
    : ''
}
