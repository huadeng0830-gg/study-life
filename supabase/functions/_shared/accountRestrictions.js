// A broad "publish/send content" restriction. Reads, personal sync, collection,
// withdrawing content and declining/cancelling invitations remain available.
const publishActions = {
  'campus-life': new Set([
    'teacher_submit', 'course_submit', 'assignment_submit', 'course_review_submit',
    'market_submit', 'help_submit', 'shuttle_submit', 'shuttle_correction_submit',
    'shuttle_exception_submit', 'lost_found_submit', 'event_submit', 'guide_submit',
    'content_resubmit', 'message_send', 'market_interest_create', 'help_apply',
    'lost_found_claim_submit', 'matter_create', 'matter_response_submit',
    'matter_clarification_submit', 'matter_clarification_reply', 'matter_action_start',
    'matter_action_link_task', 'matter_outcome', 'matter_set_choice',
  ]),
  'campus-community': new Set(['submit', 'reviewer_apply', 'reviewer_application_reply']),
  'campus-social': new Set([
    'profile_save', 'friend_request_send', 'invitation_create', 'campus_place_publish',
    'campus_place_rating_save', 'campus_place_invite_send', 'project_create',
    'project_update', 'project_invite_member', 'project_invite_link_create',
    'project_task_create', 'project_task_update', 'project_task_checkpoint_save',
    'project_milestone_create', 'project_milestone_update', 'project_delivery_check_create',
    'project_delivery_check_update', 'project_adjustment_create', 'project_deliverable_create',
    'project_deliverable_draft_save', 'project_deliverable_submit', 'project_deliverable_review',
    'project_meeting_create', 'project_meeting_apply_proposal',
  ]),
}

export function requiresPublishing(service, action, payload = {}) {
  if (service === 'campus-community' && action === 'message_thread') return Boolean(payload?.body)
  if (service === 'campus-social' && action === 'project_adjustment_decide') return Boolean(String(payload?.decisionNote || '').trim())
  if (service === 'campus-social' && action === 'project_meeting_respond') return payload?.response === 'propose'
  // Safety reports and existing help disputes stay available during a publish
  // restriction. A full account restriction still denies these operations.
  return publishActions[service]?.has(action) || false
}

export async function assertAccountAccess(client, userId, service, action, payload, ErrorType) {
  const { data, error } = await client.rpc('platform_account_access', {
    p_actor: userId, p_publish: requiresPublishing(service, action, payload),
  })
  if (error || typeof data?.allowed !== 'boolean') throw new ErrorType('service_unavailable', '暂时无法核实账号权限，请稍后重试。', 503)
  if (!data.allowed) {
    const account = data.code === 'account_suspended'
    throw new ErrorType(account ? 'account_suspended' : 'publishing_restricted',
      account ? '账号已封禁，请打开“我的账号”查看原因和解除时间。本机数据仍可使用。' : '当前账号禁止发布或发送内容，请打开“我的账号”查看原因和解除时间。', 403)
  }
}
