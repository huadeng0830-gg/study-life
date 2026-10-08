// 「一次粘进来多条通知」的切段层：整段文本 → 若干段 → 每段交给 noticeParser 的既有单条路径。
//
// 【为什么不重写单条解析】noticeParser.js 已经处理过"发布日期 vs 截止日期"这类歧义
// （isPublicationCandidate / selectDateCandidate / buildNoticeUnderstanding），并且有
// 一整套回归测试。这里只负责**在调用它之前决定"从哪里断开"**，断开之后完全复用
// parseNotice —— 于是解析侧的任何改进都会自动惠及多段场景，而不会在这里分叉出
// 第二套"多段专用解析"。
//
// 【切分的代价是不对称的，这是全部规则的出发点】
//   - 不切：用户看到一条合并的通知，顶多多改几个字段，改完就是对的；
//   - 切错：一条通知的标题行被当成第二条通知的标题、正文落进另一条，
//     生成出来的是**两个都不对**的待办，而且要靠用户自己看出来。
// 所以规则一律偏保守：证据不足时回退成 1 段，宁可少切。
//
// 【三个已知的坑，写在这里是为了别再犯】
//   1. 落款日期不是新通知。noticeParser 用 isPublicationCandidate 排除通知末尾的
//      "发布日期"；切段层必须做同一件事，否则
//      「正文 + 空行 + 2026年10月1日」会被切成两条，末尾多出一条"通知"。
//      → isSignatureLine。
//   2. 缩进行与以标点开头的行是**续行**，不是新通知。Word/微信里转发过来的通知
//      正文经常带缩进或折行，切开就等于把一句话劈成两半。
//   3. 语音结果之间没有可靠标点。连续说话时 Web Speech 给的是一串 final 片段，
//      片段之间可能什么都没有。所以语音侧把"两段 final 结果"当成一次逗号停顿
//      （见 voiceInput.js 的 separator 选项），再走同一套切段规则 —— 但**只对
//      最终结果切**，interim 是半句话，切了等于凭空造一条。
//
// 纯函数，无 Vue 依赖：切段与多候选组装都可以在 vitest 里直接断言。
import { parseNotice } from './noticeParser.js'

/** 段数上限。超过时截断并显式报 overflowCount，绝不静默丢弃。 */
export const MAX_NOTICE_SEGMENTS = 20

/** 段级处理方式（与单条路径一致，只是粒度更细）。 */
export const SEGMENT_PROCESS_OPTIONS = [
  { key: 'task', label: '创建待办' },
  { key: 'homework', label: '添加作业' },
  { key: 'event', label: '加入日程' },
]

/* ------------------------------------------------------------------ 行与单位 */

// 枚举 / 项目符号的"标记本体"：只匹配标记，**不吃掉后面的第一个字符**。
// （早期版本写成 `...\s*\S`，结果剥前缀时把标题的头一个字一起带走了：
//   "1. 周五…" → "五…"，"3. 10月10日…" → "0月10日…"。MARKER_HEAD 才要求有正文。）
const MARKER = /^(?:[-*•·▪◆■□※※]|[(（]?\d{1,2}[)）.、．]|[①-⑳]|第[一二三四五六七八九十]+[条项]|[一二三四五六七八九十]{1,3}[、.．)）])\s*/
/** 同上，但要求标记后**有正文**：单独一行的 "1." 或 "——" 不是段首标记。 */
const MARKER_HEAD = /^(?:[-*•·▪◆■□※※]|[(（]?\d{1,2}[)）.、．]|[①-⑳]|第[一二三四五六七八九十]+[条项]|[一二三四五六七八九十]{1,3}[、.．)）])\s*\S/
/** 标题正文：`关于……的通知`、`……公告`、`本周考试安排`。必须整体是标题，不能带正文。 */
const HEADING_BODY = /^(?:关于[^。]{1,40}的?\s*(?:通知|公告|说明|安排|须知|提醒|倡议|答复)|通知|公告|转发|温馨提示|[^。]{1,40}(?:通知|公告|安排|须知|说明|提醒))$/
/**
 * 引出句尾：`本周通知合集如下`、`安排如下`。
 * 这一条单独列出来是因为它不含任何动作词，却含"本周"这种时间词 —— 只看时间信号的话
 * "本周通知合集如下"会自己"变一条通知"，界面上就多出一条名叫"本周通知合集如下"的待办。
 */
const HEADING_TAIL = /(?:如下|如下所示|事项如下|通知如下|安排如下|说明如下|要求如下)$/
/** 明确的合集总标题（带【】或"关于…通知"）。只在这种形态下才允许从第 1 段里裁掉。 */
const COLLECTION_TITLE = /^(?:【[^】]{1,40}】\s*)?(?:关于[^。]{1,20}的?\s*)?(?:通知|公告|须知|安排|说明|提醒)$/
/** 标题前缀：`【通知】`、`[通知]`、`【紧急】`。 */
const HEADING_TAG = /^[\[［【（(]\s*(?:通知|公告|转发|温馨提示|紧急|重要)?\s*[\]］】）)]?\s*(.*)$/
/** 以标点开头 = 上一句没写完（折行、换行续写），绝不当新段。 */
const CONTINUATION_PUNCT = /^[，,。；;：:、）)】」』!！?？…—\-·]/
/** 落款行：署名单位/人名 + 日期。信号统计时必须忽略，否则末尾日期会自己"变一条"。 */
const SIGNATURE = /^(?:\d{4}\s*[年/.．-]\s*)?\d{1,2}\s*[月/.．-]\s*\d{1,2}\s*[日号]?$|^\d{4}\s*年(?:\s*\d{1,2}\s*月)?(?:\s*\d{1,2}\s*[日号])?$|^(?:辅导员|班主任|任课老师|老师|教务处|教务科|学工部|学生处|团委|院办|学院办公室|[\u4e00-\u9fa5]{2,4}(?:处|部|院|系|办|科|室|组))\s*[:：]?[\u4e00-\u9fa5]{0,6}$/
// 动作信号：这一段自己就是一个"要做什么"。刻意不含"通知/公告/务必/记得"——那些词
// 标题行也有，用进来会让"标题块"看起来像一条独立通知，切段就会到处乱切。
const ACTION_SIGNAL = /提交|上交|上传|交(?!通|代|互)|完成|报名|填写|领取|参加|召开|开会|举行|签到|报到|集合|上课|缴费|交费|缴纳|处理|确认|预约|归还|还书|截止|截至|最晚|逾期|到期|改到|换到|复习|请假/
// 时间信号：日期 / 星期 / 时点。有它才算"能独立成一条"，纯说明句不算。
const TIME_SIGNAL = /\d{1,2}\s*[:：]\s*\d{2}|\d{1,2}\s*[点时]|[零〇一二两三四五六七八九十百]{1,3}\s*[点时]|(?:周|星期|礼拜)[一二三四五六日天]|明天|明日|明早|明晚|后天|大后天|今天|今日|今晚|今早|本周|下周|这周|本月|下月|\d{1,2}\s*[月日号]/
// 两行都以日期/星期开头，且各自含时间和动作时，它们已经是可独立确认的事项。
const TIMED_ACTION_HEAD = /^(?:(?:本|这|下)?周[一二三四五六日天]|星期[一二三四五六日天]|礼拜[一二三四五六日天]|明天|明日|明早|明晚|后天|大后天|今天|今日|今晚|今早|\d{1,2}\s*[月/.．-]\s*\d{1,2}\s*(?:日|号)?|\d{4}\s*[年/.．-]\s*\d{1,2}\s*[月/.．-]\s*\d{1,2}\s*(?:日|号)?)/

function isTimedActionHead(text) {
  return TIMED_ACTION_HEAD.test(String(text || '')) && TIME_SIGNAL.test(text) && ACTION_SIGNAL.test(text)
}
/** 语音模式下的分句标点：连续说话天然按句断开，而粘贴文本按句断是危险的。 */
const CLAUSE_END = /[，,。；;！!？?]/g

/**
 * 拆行，但**保留空行与缩进**。
 * 不能直接用 noticeParser 的 normalizeText：它把空行全删了，而空行恰恰是多条
 * 通知最可靠的边界信号；缩进也是"这是续行"的唯一线索。
 */
/**
 * 拆行，但**保留空行与缩进**。
 * 不能直接用 noticeParser 的 normalizeText：它把空行全删了，而空行恰恰是多条
 * 通知最可靠的边界信号；缩进也是"这是续行"的唯一线索。
 *
 * raw 与 text 分开存：text 走 NFKC + 空白折叠（与 parseNotice 内部一致，所以切出来的
 * 边界判断和解析口径相同）；raw 保留**未经 NFKC 的原始行**，否则「，」会被折成「,」，
 * 保存进任务的原文就与用户粘贴的不一致了（实测踩过）。
 */
function splitLines(value) {
  return String(value ?? '')
    .replace(/\uFEFF/g, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((raw) => ({
      raw,
      // NFKC 会把全角空格折成半角，于是「周五下午五点前　提交」折完之后中间
      // 多出一个**用户原文里没有**的半角空格。它会被原样带进切段文本、
      // 再进标题与任务原文，看上去就是"复制粘贴把字拆开了"。
      // 所以 CJK 之间（含中文标点两侧）的这个折叠产物直接去掉 ——
      // 中文正文里的字间空格本来就是排版产物，不是内容。
      text: raw.normalize('NFKC')
        .replace(/[ \t\u3000]+/g, ' ')
        .replace(/(?<=[\u4e00-\u9fff\u3000-\u303f\uff00-\uff65]) (?=[\u4e00-\u9fff])/g, '')
        .trim(),
      // 缩进要在原始行上看：全角空格 NFKC 之后才变成半角，先折叠就看不出"缩进"了
      indent: /^[ \t\u3000]/.test(raw),
    }))
}

/** 按分句标点切开（语音模式专用）；标点留在前一段末尾，语义与说话人停顿一致。 */
function splitClauses(text) {
  const out = []
  let cursor = 0
  for (const match of text.matchAll(CLAUSE_END)) {
    out.push(text.slice(cursor, match.index + 1))
    cursor = match.index + 1
  }
  out.push(text.slice(cursor))
  return out.map((item) => item.trim()).filter(Boolean)
}

/**
 * 把行展开成"最小单位"：粘贴模式一行一个；语音模式一句一个。
 * raw 保留原始行文（用于让 parseNotice 拿到和粘贴时一字不差的原文，
 * title / rawText 才不会被 NFKC 或空白折叠改写）；语音的分句没有原始切片，
 * 直接用分句本身当 raw。
 */
function toUnits(lines, mode) {
  const units = []
  for (const line of lines) {
    if (!line.text) { units.push({ raw: '', text: '', blank: true, indent: false, clause: false }); continue }
    if (mode === 'voice') {
      splitClauses(line.text).forEach((piece, index) => units.push({
        raw: piece,
        text: piece,
        blank: false,
        // 只有第一句继承缩进：后面的句子是说话人另起一句，不是折行
        indent: index === 0 && /^[ \t\u3000]/.test(line.raw),
        clause: index > 0,
      }))
      continue
    }
    units.push({ raw: line.raw, text: line.text, blank: false, indent: line.indent, clause: false })
  }
  return units
}

function isSignatureLine(text) {
  return Boolean(text) && SIGNATURE.test(text)
}

/** 剥掉 `【通知】` / `[通知]` 这类前缀，剩下的是标题本体。 */
function stripHeadingTag(text) {
  const match = String(text).match(HEADING_TAG)
  return (match ? match[1] : String(text)).replace(/[:：]$/, '').trim()
}

/**
 * 这一行是不是"只有标题"。注意是**整体判断**：带 `【通知】` 前缀但后面还跟着正文的
 * 行不算标题（那是同一条通知的标题+正文写在同一行）。
 */
function isHeadingLine(text) {
  if (!text) return false
  const rest = stripHeadingTag(text)
  return rest === '' || HEADING_BODY.test(rest) || HEADING_TAIL.test(rest)
}

/** 合集总标题：可以安全地从第 1 段裁掉（原文仍在"查看原通知"里）。 */
function isCollectionTitle(text) {
  return Boolean(text) && COLLECTION_TITLE.test(stripHeadingTag(text)) && !HEADING_TAIL.test(text)
}

/** 去掉落款行之后的剩余内容里，还有没有"这件事本身"的信号。 */
function hasNoticeSignal(units) {
  return units.some((unit) => ACTION_SIGNAL.test(unit.text) || TIME_SIGNAL.test(unit.text))
}

function isHeadingOnly(units) {
  const body = units.filter((unit) => !isSignatureLine(unit.text))
  return body.length > 0 && body.every((unit) => isHeadingLine(unit.text))
}

/**
 * 一个单位能否作为新段的段首。
 * `seenHead` 是关键：只有已经出现过一次段首标记之后，"关于……的通知"这类行才算
 * 重复标题。否则单条通知正文里出现的"关于……的通知"会把一条通知劈成两半。
 */
function headRuleOf(unit, prev, seenHead) {
  if (unit.indent) return ''
  if (CONTINUATION_PUNCT.test(unit.text)) return ''
  if (MARKER_HEAD.test(unit.text)) return 'marker'
  if (isTimedActionHead(prev?.text) && isTimedActionHead(unit.text)) return 'action'
  if (seenHead && isHeadingLine(unit.text)) return 'heading'
  if (prev?.blank) return 'blank'
  if (unit.clause) return 'clause'
  return ''
}

function groupUnits(units) {
  const blocks = []
  let seenHead = false
  for (let index = 0; index < units.length; index++) {
    const unit = units[index]
    // 空行只是边界标记，本身不构成一段，也不进任何一段的文本
    if (unit.blank) continue
    const rule = index === 0 ? '' : headRuleOf(unit, units[index - 1], seenHead)
    if (rule) { blocks.push({ rule, units: [unit] }); seenHead = true; continue }
    if (blocks.length) blocks[blocks.length - 1].units.push(unit)
    else blocks.push({ rule: '', units: [unit] })
  }
  return blocks
}

/**
 * 合并规则，宁可少切：
 *  1. 去掉落款行后没内容的块（纯署名 / 纯日期）→ 并入上一段；
 *  2. 整块只有标题 → 并入相邻段（标题必须和正文在一起才有意义）；
 *  3. 没有动作也没有时间的块 → 并入上一段（这是说明句，不是独立通知）。
 */
function mergeBlocks(blocks) {
  const kept = []
  // 开头的块还没法"并入上一段"（上一段不存在），先存着，等下一段成段时前置进去。
  // 不这么做就会**丢字**：一条通知的标题 + 各位同学： + 空行 + 正文这种常见排版，
  // 标题与称呼都因为"没有上一段可并"而消失，标题也跟着被改写。
  let pending = []
  for (const block of blocks) {
    const body = block.units.filter((unit) => !isSignatureLine(unit.text))
    const droppable = !body.length || isHeadingOnly(block.units) || !hasNoticeSignal(body)
    if (droppable) {
      if (kept.length) kept[kept.length - 1].units.push(...block.units)
      else pending = [...pending, ...block.units]
      continue
    }
    // lead 记下"这一条真正从第几个 unit 开始"：前面的 pending 是合集的总标题，
    // 后面剥枚举标记、总标题裁剪都要按这个位置算，不能靠"第 0 个 unit"猜。
    kept.push({ rule: block.rule, lead: pending.length, units: [...pending, ...block.units] })
    pending = []
  }
  return dropCollectionHeading(kept)
}

/**
 * 切成了多条时，开头的总标题不属于任何一条。
 *
 * 【为什么这一条单独拿出来说】合集最常见的排版是「关于本周事项的通知」+ 空行 +
 * 5 条编号通知。总标题被并进第 1 条之后，parseNotice 的标题规则（挑出"关于…的通知"
 * 那一行）会把**第 1 条的标题换成总标题**，于是界面上第一条变成"本周事项"，
 * 后面 4 条却各是各的 —— 明显不齐。丢掉它也不会丢原文：整段粘贴内容仍然完整保留在
 * 「查看原通知」里。切成一条时不做这一步，那时它就是这条通知自己的标题。
 */
function dropCollectionHeading(rows) {
  if (rows.length < 2) return rows
  const [first] = rows
  let cut = 0
  // 只在"总标题区"里裁，且只裁明确的合集总标题：裁过了头会把第 1 条自己的标题丢掉，
  // 裁宽了会把"本周通知合集如下"这种引出句留在第 1 条里变成它的标题。
  while (cut < first.lead && isCollectionTitle(first.units[cut].text)) cut++
  if (!cut) return rows
  return [{ rule: first.rule, lead: first.lead - cut, units: first.units.slice(cut) }, ...rows.slice(1)]
}

function blockRaw(row) {
  return row.units.map((unit) => unit.raw).filter(Boolean).join('\n')
}

/**
 * 枚举标记是"这条是从第几条开始"的编号，不是通知内容。
 * 留在段首会让 parseNotice 把它算进标题（"1. 提交实验报告"），也会让用户以为
 * 自己粘的是待办清单。**只剥段首那一处**，正文里出现的 "1." 原样保留。
 */
function stripMarkerPrefix(value) {
  return String(value).replace(MARKER, '')
}

/**
 * 切段（纯函数）。
 *
 * @param {string} value 用户粘贴或语音转写的整段文本
 * @param {{ limit?: number, mode?: 'paste' | 'voice' }} [options]
 *   mode='paste'（默认）按行 / 空行 / 枚举标记 / 重复标题切；
 *   mode='voice' 额外把分句标点当边界（连续语音没有换行）。
 * @returns {{ segments: Array<{ id: string, index: number, rule: string, text: string, lines: string[] }>, limit: number, total: number, overflowCount: number, overflowText: string }}
 */
export function splitNoticeSegments(value, options = {}) {
  const { limit = MAX_NOTICE_SEGMENTS, mode = 'paste' } = options
  const units = toUnits(splitLines(value), mode)
  let merged = mergeBlocks(groupUnits(units))
  // 一段都没成段（全是标题/称呼/无信号说明句，比如「注意事项：1. 带学生证 2. 提前到」）
  // 属于**切过头**而不是"没有通知"：保守规则的兜底是把整段原样当一条。
  // 返回 0 段会让 UI 无内容可显示，用户只能看着粘贴框发愣。
  if (!merged.length && units.some((unit) => !unit.blank)) {
    merged = [{ rule: '', units: units.filter((unit) => !unit.blank) }]
  }
  const kept = merged.slice(0, Math.max(0, limit))
  const dropped = merged.slice(kept.length)
  return {
    segments: kept.map((row, index) => {
      // 剥枚举前缀只改 text（理解用），**raw 保持用户粘贴的样子** —— 编号是原通知里的
      // 真实内容，保存进任务的原文必须与粘贴内容一致，不能悄悄少掉 "1."。
      const unitsOfRow = row.rule === 'marker' && row.lead < row.units.length
        ? row.units.map((unit, at) => (at === row.lead ? { ...unit, text: stripMarkerPrefix(unit.text) } : unit))
        : row.units
      return {
        id: `notice-seg-${index + 1}`,
        index,
        // rule 只是给 UI 与测试看的"为什么从这里断"，不影响结果
        rule: row.rule,
        text: unitsOfRow.map((unit) => unit.text).filter(Boolean).join('\n'),
        // 交给 parseNotice 的原文：与用户粘贴时一字不差，保存进任务的 rawText 才对得上
        rawText: row.units.map((unit) => unit.raw).filter(Boolean).join('\n'),
        lines: unitsOfRow.map((unit) => unit.text).filter(Boolean),
      }
    }),
    limit,
    total: merged.length,
    // 超上限时把剩下的原文带出来，UI 才能明确提示"还有几段没处理"，而不是静默截断
    overflowCount: dropped.length,
    overflowText: dropped.map(blockRaw).filter(Boolean).join('\n'),
  }
}

/**
 * 切段 + 每段调用既有单条解析路径，组装成多候选。
 *
 * @param {string} value
 * @param {{ courses?: Array, now?: Date, limit?: number, mode?: 'paste' | 'voice' }} [options]
 * @returns {{ segments: Array, candidates: Array<{ id: string, index: number, rule: string, text: string, parsed: object }>, limit: number, total: number, overflowCount: number, overflowText: string }}
 */
export function buildNoticeCandidates(value, options = {}) {
  const { courses = [], now = new Date(), ...rest } = options
  const result = splitNoticeSegments(value, rest)
  return {
    ...result,
    // 每段各自走一遍 parseNotice：一段通知里的日期歧义由既有逻辑自己判断，
    // 这里不做任何跨段的日期推断（跨段推断会把 A 通知的落款算成 B 通知的截止日）。
    //
    // 传的是**剥掉枚举前缀的 text** 而不是 rawText，否则 noticeParser 的 cleanTitle
    // 会把 "2. " 当成标题内容，界面上第 2 条通知的标题就是一个孤零零的 "2"。
    // 原文由 segment.rawText 原样带着，保存进任务的仍是用户粘贴的内容。
    candidates: result.segments.map((segment) => ({ ...segment, parsed: parseNotice(segment.text, courses, now) })),
  }
}
