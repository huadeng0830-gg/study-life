const PRIVATE_CONTENT_PATTERNS = [
  /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i,
  /(?:\+?86[-\s]?)?1[3-9](?:[\s\-()（）.·—_]*\d){9}/,
  /(?:取件码|手机号|电话|微信|微\s*信|QQ|WX|WeChat|Weixin)\s*[:：]?\s*[\w-]{4,}/i,
  /(?:宿舍|寝室|\d+号楼).{0,12}\d{1,4}室/,
]

export function containsPrivateCampusDetails(value) {
  const text = String(value ?? '')
  return PRIVATE_CONTENT_PATTERNS.some((pattern) => pattern.test(text))
}

export function campusScopeMatches(row, scope) {
  return row?.school === scope?.school && (!scope?.campus || !row?.campus || row.campus === scope.campus)
}

export function canTransitionCampusHelp({ from, to, actorRole }) {
  return (from === 'assigned' && to === 'in_progress' && actorRole === 'assignee')
    || (from === 'in_progress' && to === 'awaiting_confirmation' && actorRole === 'assignee')
    || (from === 'awaiting_confirmation' && to === 'completed' && actorRole === 'owner')
    || (['open', 'assigned'].includes(from) && to === 'cancelled' && actorRole === 'owner')
    || (['assigned', 'in_progress', 'awaiting_confirmation'].includes(from) && to === 'disputed' && ['owner', 'assignee'].includes(actorRole))
}

export function canTransitionCampusMarket({ from, to, actorRole }) {
  return (from === 'reserved' && to === 'sold' && actorRole === 'owner')
    || (['active', 'reserved'].includes(from) && to === 'withdrawn' && actorRole === 'owner')
}

export function averageCampusRating(reviews, fields = ['clarity', 'organization', 'learning', 'workload', 'assessment']) {
  const validReviews = (Array.isArray(reviews) ? reviews : []).map((review) => fields.map((field) => Number(review?.[field]))
    .filter((score) => Number.isInteger(score) && score >= 1 && score <= 5)).filter((scores) => scores.length)
  const scores = validReviews.flat()
  return { count: validReviews.length, scoreCount: scores.length, average: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null, lowSample: validReviews.length < 10 }
}

// Explicit public projections: searching never loads owners, messages, claims,
// registrations, reviews or shuttle child tables.
export const campusSearchSources = [
  { type: 'course', table: 'campus_courses', title: 'name', details: ['department', 'description'], statusField: 'review_status', statuses: ['approved'] },
  { type: 'teacher', table: 'campus_teachers', title: 'name', details: ['department', 'research_directions'], statusField: 'review_status', statuses: ['approved'] },
  { type: 'place', table: 'campus_places', title: 'name', details: ['place_type', 'area', 'description'], statusField: 'review_status', statuses: ['approved'] },
  { type: 'market_listing', table: 'campus_market_listings', title: 'title', details: ['description'], statusField: 'status', statuses: ['active', 'reserved'] },
  { type: 'help_task', table: 'campus_help_tasks', title: 'title', details: ['description'], statusField: 'status', statuses: ['open'] },
  { type: 'shuttle_route', table: 'campus_shuttle_routes', title: 'name', details: ['source_url'], statusField: 'status', statuses: ['approved'] },
  { type: 'lost_found', table: 'campus_lost_found_items', title: 'title', details: ['description'], statusField: 'status', statuses: ['open', 'claim_pending'] },
  { type: 'event', table: 'campus_events', title: 'title', details: ['description'], statusField: 'review_status', statuses: ['approved'] },
  { type: 'guide', table: 'campus_guides', title: 'title', details: ['body'], statusField: 'review_status', statuses: ['approved'] },
]

/** PostgreSQL's ***= regex director treats the remaining term literally.
 * imatch avoids LIKE wildcard aliases; only PostgREST quoted-value escaping is
 * required. User input cannot become a regex or add filter expressions.
 */
export function campusSearchFilter(fields, term) {
  const literal = ('***=' + term).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return fields.map((field) => field + '.imatch."' + literal + '"').join(',')
}
