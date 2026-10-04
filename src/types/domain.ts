export type WeekType = 'all' | 'odd' | 'even'

export interface Course {
  id: string
  name: string
  teacher?: string
  room?: string
  color?: string
  day: number
  start: string
  end: string
  startWeek?: number
  endWeek?: number
  weekType?: WeekType
  campusId?: string
  travelMinutes?: number
}

export interface PeriodTime {
  start: string
  end: string
}

export interface Campus {
  id: string
  name: string
}

export interface Season {
  id: string
  name: string
  startDate: string
  campuses?: string[]
}

export interface TimeConfig {
  campuses: Campus[]
  seasons: Season[]
  currentCampus: string
  currentSeason: string
  autoSeason: boolean
  periods: Array<{ id: string; label: string }>
  times: Record<string, Record<string, PeriodTime[]>>
  updatedAt?: string
}

export interface Task {
  id: string
  title: string
  done: boolean
  course?: string
  courseId?: string
  dueDate?: string
  dueTime?: string
  priority?: 'high' | 'normal' | 'low'
  completedAt?: string | null
  createdAt?: string
  updatedAt?: string
  repeat?: 'none' | 'weekly'
  estimateMinutes?: number
  note?: string
  kind?: 'todo' | 'homework' | 'review' | 'exam-prep'
  status?: 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'archived'
  createdFrom?: 'manual' | 'quick-record' | 'ocr' | 'clipboard' | 'import'
  sourceType?: string
  sourceId?: string
  relationId?: string
}

export interface QuickEvent {
  id: string
  title: string
  date?: string
  time?: string
  courseId?: string
  courseName?: string
  note?: string
  createdAt?: string
  updatedAt?: string
  createdFrom?: string
  sourceType?: string
  sourceId?: string
}

export interface QuickNote {
  id: string
  title: string
  content: string
  createdAt?: string
  updatedAt?: string
  courseId?: string
  courseName?: string
  createdFrom?: string
  sourceType?: string
  sourceId?: string
  inboxStatus?: 'inbox' | 'organized' | 'archived'
  organizedAt?: string
}

/** 分摊明细。`total` 是这一笔的总额，`mine` 是「我承担」的那一份。 */
export interface TransactionSplitParticipant {
  label: string
  amount: number
}

/** 一笔支出的报销分摊。只记录「我实际承担多少」，不做多人账户与结算。 */
export interface TransactionSplit {
  total: number
  mine: number
  participants: TransactionSplitParticipant[]
}

export interface Transaction {
  id: string
  name: string
  amount: number
  date: string
  time?: string
  cat?: string
  note?: string
  account?: string
  /** `refund` 是冲抵项：从支出里扣减，不计入收入、也不进分类分布。 */
  direction?: 'expense' | 'income' | 'refund'
  /** ISO 4217 三位代码。**没有这个字段 = 基准币种**（旧记录即如此，故不做迁移）。 */
  currency?: string
  /** 可选。存在即表示这条记录做过报销分摊；缺失 = 未分摊。 */
  split?: TransactionSplit
  /** 退款指向原支出的 id。 */
  refundOf?: string
  billId?: string
  billingPeriodKey?: string
  source?: string
  sourceType?: string
  sourceId?: string
  relationId?: string
  createdAt?: string
  updatedAt?: string
  createdFrom?: string
  /**
   * 可见性标记。读侧（`isVisibleTransaction`）与同步完整性检查都会读这三个字段，
   * 但它们只在**历史数据**与同步墓碑里出现，正常写入路径不会设值。
   */
  archivedAt?: string
  deletedAt?: string
  tombstone?: boolean
}

export interface Bill {
  id: string
  name: string
  amount: number
  cycle?: 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'once'
  nextDate: string
  remindDays?: number
  /** `false` = 本期付完后不再自动推进到下一期（`nextBillDate` 会停住）。 */
  autoRenew?: boolean
  active?: boolean
  category?: string
  account?: string
  /** 与交易同一个约定：缺失 = 基准币种。 */
  currency?: string
  note?: string
  createdAt?: string
  updatedAt?: string
}

export interface Milestone {
  id: string
  name: string
  date: string
  time?: string
  kind?: 'exam' | 'countdown' | 'deadline' | 'anniversary'
  courseId?: string
  courseName?: string
  createdAt?: string
  updatedAt?: string
}
