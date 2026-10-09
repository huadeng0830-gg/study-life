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
}

export interface ChecklistStateChange {
  id: string
  done: boolean
  nextDone: boolean
}
