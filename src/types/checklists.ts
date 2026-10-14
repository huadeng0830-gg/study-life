export interface ChecklistItem {
  id: string
  name: string
  text?: string
  title?: string
  quantity?: number | string
  unit?: string
  price?: number | string | null
  category?: string
  note?: string
  done?: boolean
  dueDate?: string
  assignedTo?: string
  substitutedBy?: string
}

export type ChecklistItemInput = Partial<ChecklistItem>

export interface Checklist {
  id: string
  name: string
  type: string
  budget?: number | string | null
  createdAt?: string
  updatedAt?: string
  items: ChecklistItem[]
  dutyEnabled?: boolean
  dutyTemplateId?: string
  dutyMembers?: string[]
  dutySeriesId?: string
  occurrenceDate?: string
  semesterStartDate?: string
  repeat?: string
  repeatWeekday?: number
  repeatEndDate?: string
}

export interface ChecklistStateChange {
  id: string
  done: boolean
  nextDone: boolean
}
