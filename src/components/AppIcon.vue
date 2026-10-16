<script setup>
import { computed } from 'vue'
import {
  Archive, Bell, BookOpen, CalendarDays, CalendarRange, CheckCheck,
  CircleCheck, ClipboardList, Database, Flag, GraduationCap, House,
  ListChecks, MapPin, MessageSquare, MoreHorizontal, NotebookPen,
  Palette, PanelLeftClose, Plus, Search, Settings2, Sparkles, Timer,
  Users, Wallet, RotateCcw, RefreshCw, UserRound, SlidersHorizontal,
  ShoppingCart, Luggage, Backpack, Brush, Folder,
} from '@lucide/vue'

const props = defineProps({ name: { type: String, default: '' } })
// Route IDs are stable even when users rename or regroup their navigation.
// Legacy symbols remain accepted by EmptyState and saved navigation metadata.
const icons = {
  today: House, schedule: CalendarDays, course: BookOpen, tasks: CircleCheck,
  exams: Flag, events: CalendarRange, lists: ListChecks, bills: Wallet,
  places: MapPin, campus: GraduationCap, review: RotateCcw, together: Users,
  projects: ClipboardList, feedback: MessageSquare, account: UserRound,
  search: Search, appearance: Palette, navigation: SlidersHorizontal,
  capture: Plus, more: MoreHorizontal, festive: Sparkles, admin: Settings2,
  data: Database, 'quick-record': NotebookPen, focus: Timer, update: RefreshCw,
  archive: Archive, closeSidebar: PanelLeftClose, notices: Bell,
  todo: CircleCheck, homework: BookOpen, event: CalendarRange, expense: Wallet,
  income: Wallet, bill: Wallet, countdown: Flag, note: NotebookPen, externalExam: GraduationCap,
  '🛒': ShoppingCart, '🧳': Luggage, '🎒': Backpack, '🧹': Brush, '💰': Wallet, '📁': Folder,
  '📚': BookOpen, '✅': CircleCheck, '✓': CheckCheck, '☀': CalendarDays,
  '☀️': House, '📅': CalendarDays, '⏳': Timer, '🗓️': CalendarRange,
  '☑️': ListChecks, '📒': Wallet, '📍': MapPin, '↺': RotateCcw,
  '👥': Users, '🧩': ClipboardList, '💬': MessageSquare, '👤': UserRound,
  '🔍': Search, '🎨': Palette, '☷': SlidersHorizontal, '🎉': Sparkles,
  '⚙️': Settings2, '💾': Database, '⚡': NotebookPen, '⏱': Timer, '↻': RefreshCw,
}
const icon = computed(() => icons[props.name] || NotebookPen)
</script>

<template>
  <component :is="icon" class="app-icon" :size="18" :stroke-width="1.75" aria-hidden="true" focusable="false" />
</template>

<style scoped>
.app-icon { display: inline-block; flex: none; vertical-align: middle; }
</style>
