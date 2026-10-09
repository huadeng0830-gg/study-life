import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('齐行任务续接工作台', () => {
  it('复用任务断点字段，呈现上次进度、下一步、资源和明确操作', () => {
    const component = read('../src/components/tasks/TaskWorkSession.vue')
    const fields = read('../src/components/tasks/TaskWorkCheckpointFields.vue')
    expect(component).toContain('上次进度')
    expect(component).toContain('关联资料')
    expect(component).toContain("@click=\"emit('start')\"")
    expect(component).toContain("@click=\"emit('save')\"")
    expect(fields).toContain('遇到的问题')
    expect(fields).toContain('下一步')
  })

  it('从个人待办续接时直达对应齐行项目任务，并保存到现有任务事件历史', () => {
    const tasksView = read('../src/views/TasksView.vue')
    const projectsView = read('../src/views/ProjectsView.vue')
    const checkpointLoader = read('../src/composables/projects/projectTaskCheckpoints.js')
    const workbench = read('../src/composables/projects/useProjectTaskWorkbench.js')
    const edge = read('../supabase/functions/campus-social/index.ts')
    const migration = read('../supabase/migrations/20261009072859_qixing_task_workbench.sql')

    expect(tasksView).toContain("query: { project: task.relationId, ...(task.sourceId ? { task: task.sourceId } : {}) }")
    expect(projectsView).toContain('loadProjectTaskCheckpoints(id, projectRequest')
    expect(checkpointLoader).toContain("request('task_checkpoints', { projectId })")
    expect(workbench).toContain("projectRequest('task_checkpoint_save'")
    expect(projectsView).toContain('taskEventLabel(event)')
    expect(edge).toContain("case 'project_task_checkpoints'")
    expect(edge).toContain("case 'project_task_checkpoint_save'")
    expect(migration).toContain("event.details ->> 'source' = 'workbench'")
    expect(migration).toContain("'workCheckpoint', p_checkpoint")
    expect(migration).toContain('v_latest_updated_at is distinct from p_expected_updated_at')
  })

  it('保留齐行成员权限校验，只通过受限 Edge Function 写进度', () => {
    const edge = read('../supabase/functions/campus-social/index.ts')
    const migration = read('../supabase/migrations/20261009072859_qixing_task_workbench.sql')

    expect(edge).toContain('normalizeProjectWorkCheckpoint(checkpoint)')
    expect(migration).toContain("v_role not in ('owner', 'admin')")
    expect(migration).toContain("v_task.assignment_status <> 'accepted'")
    expect(migration).toContain('security invoker')
    expect(migration).toContain('grant execute on function public.project_task_checkpoint_save')
    expect(migration).not.toMatch(/drop\s+table|truncate\s+/i)
  })
})
