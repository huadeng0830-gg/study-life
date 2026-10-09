import { appDateTime } from '../timeContext.js'
import { defaultReminderMinutes } from '../settingsPolicy.js'
import { isArchived } from '../domain/state.js'
import { eventInputError, validEventDate } from './eventFields.js'
import { shiftEventDate } from './eventPlanning.js'

function escapeText(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/\r\n?|\n/g, '\\n').replace(/[,;]/g, '\\$&').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
}

// RFC 5545 §3.1: fold at UTF-8 octet boundaries, never through a character.
function foldLine(line) {
  const encoder = new TextEncoder()
  let current = ''
  let size = 0
  const lines = []
  for (const character of line) {
    const length = encoder.encode(character).length
    if (size + length > 75) { lines.push(current); current = ' '; size = 1 }
    current += character
    size += length
  }
  lines.push(current)
  return lines.join('\r\n')
}

function utcValue(epoch) { return new Date(epoch).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z') }

export function buildEventCalendar(events = [], { timezone = 'local', now = new Date() } = {}) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Sanliangshi//Personal Events//ZH', 'CALSCALE:GREGORIAN']
  let count = 0
  let skipped = 0
  for (const event of events) {
    if (!event || event.deletedAt || event.tombstone || !validEventDate(event.date) || eventInputError(event)) { skipped++; continue }
    const uid = event.sourceText?.startsWith('ics:uid:') ? event.sourceText.slice(8) : `sl-event-${encodeURIComponent(String(event.id || `${event.date}-${event.time || ''}-${event.title}`))}@sanliangshi.local`
    const enabled = event.reminderEnabled !== false && !isArchived(event)
    const minutes = defaultReminderMinutes('event', event.reminderMinutes)
    lines.push('BEGIN:VEVENT', `UID:${escapeText(uid)}`, `DTSTAMP:${utcValue(now)}`, `SUMMARY:${escapeText(event.title)}`)
    if (event.time) {
      lines.push(`DTSTART:${utcValue(appDateTime(event.date, event.time, timezone))}`)
      if (event.endTime) lines.push(`DTEND:${utcValue(appDateTime(event.date, event.endTime, timezone))}`)
    } else {
      lines.push(`DTSTART;VALUE=DATE:${event.date.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${shiftEventDate(event.date, 1).replace(/-/g, '')}`)
    }
    if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`)
    if (event.note) lines.push(`DESCRIPTION:${escapeText(event.note)}`)
    if (event.courseName) lines.push(`X-SANLIANGSHI-COURSE:${escapeText(event.courseName)}`)
    lines.push(`X-SANLIANGSHI-REMINDER-ENABLED:${enabled ? 'TRUE' : 'FALSE'}`, `X-SANLIANGSHI-REMINDER-MINUTES:${minutes}`)
    if (enabled) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(event.title)}`)
      lines.push(event.time ? `TRIGGER:-PT${minutes}M` : `TRIGGER;VALUE=DATE-TIME:${utcValue(appDateTime(event.date, '23:59', timezone) - minutes * 60_000)}`)
      lines.push('END:VALARM')
    }
    lines.push('END:VEVENT')
    count++
  }
  lines.push('END:VCALENDAR')
  return { text: lines.map(foldLine).join('\r\n') + '\r\n', count, skipped }
}

export function downloadEventCalendar(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  try { link.click() }
  finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
}
