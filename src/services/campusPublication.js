import * as life from './campusLife.js'

const submitters = {
  teacher: life.submitCampusTeacher,
  course: life.submitCampusCourse,
  assignment: life.submitCampusTeachingAssignment,
  market: life.submitCampusMarketListing,
  help: life.submitCampusHelpTask,
  shuttle: life.submitCampusShuttleRoute,
  shuttle_correction: (payload) => life.submitCampusShuttleCorrection(payload.routeId, payload.detail, payload.sourceUrl),
  shuttle_exception: life.submitCampusShuttleException,
  lost: life.submitLostFoundItem,
  event: life.submitCampusEvent,
  guide: life.submitCampusGuide,
}

/** A resolved request is success even when its response has no body. */
export function submitCampusPublication(kind, payload, editing = null) {
  if (!Object.hasOwn(submitters, kind)) throw new Error('发布类型无效，请重新选择。')
  if (editing) {
    if (editing.type !== kind || !editing.id || !Number.isSafeInteger(editing.revision)) throw new Error('投稿版本已变化，请重新打开投稿记录。')
    return life.resubmitCampusContent(kind, editing.id, editing.revision, payload)
  }
  return submitters[kind](payload)
}
