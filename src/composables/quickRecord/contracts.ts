export interface QuickRecordContext {
  preferredType?: string
  courseId?: string
  courseName?: string
  knownAmount?: number
}

export interface QuickRecordDraft {
  id: string
  type: string
  raw: string
  title: string
  course: string
  courseId: string
  date: string
  dateRange: string
  time: string
  endTime: string
  location: string
  reminder: string
  priority: string
  note: string
  amount: number | string
  category: string
  categoryConfidence: number
  categoryUncertain: boolean
  categorySuggested: string
  categoryMatchedBy: string
  categoryMatchedTerms: readonly string[]
  categoryCandidates: readonly string[]
  categoryAmbiguous: boolean
  categoryConfirmed?: boolean
  categoryEdited?: boolean
  account: string
  cycle: string
  questions: Array<{ field: string; label: string; choices: string[] }>
  confidence: number
  uncertain: boolean
  selected?: boolean
}

export interface QuickRecordSaveResult {
  message: string
  undo?: () => void
  entityType?: string
  entityId?: string
  type?: string
}

export interface QuickRecordDraftState {
  input: string
  forcedType: string
  drafts: QuickRecordDraft[]
}
