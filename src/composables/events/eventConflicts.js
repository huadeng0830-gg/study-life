import { detectTaskEventConflicts } from '../conflictDetection.js'
import { isArchived, isTaskActionable } from '../domain/state.js'
import { coursesForDate } from '../store/schedule.js'
import { autoSeasonIdFor, currentCampusId, currentSeasonId, periodIndex, timeConfig } from '../store/timeConfig.js'
import { appDateTime } from '../timeContext.js'

export function findEventConflicts(value, { tasks = [], events = [], courses = [] } = {}, editingId = null) {
  if (!value.date || !value.time) return []
  const campus = currentCampusId()
  const cfg = timeConfig.value
  const season = cfg.autoSeason ? autoSeasonIdFor(campus, cfg, new Date(appDateTime(value.date, '12:00'))) : currentSeasonId()
  const times = cfg.times?.[season]?.[campus] || []
  const courseEvents = coursesForDate(courses.filter((course) => course && !course.deletedAt && !course.tombstone && !isArchived(course) && course.active !== false), value.date).map((course) => ({
    id: `course:${course.id}`, title: course.name, date: value.date,
    time: times[periodIndex(course.start)]?.start || '',
    endTime: times[periodIndex(course.end)]?.end || '',
  }))
  const items = [
    ...tasks.filter((task) => task && !task.deletedAt && !task.tombstone && isTaskActionable(task) && task.active !== false),
    ...events.filter((event) => event && !event.deletedAt && !event.tombstone && event.active !== false),
    ...courseEvents,
  ]
  return detectTaskEventConflicts({ ...value, id: editingId }, items, value.date, 'event')
}
