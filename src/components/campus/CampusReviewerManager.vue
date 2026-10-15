<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { platformAdminRequest } from '../../services/platformAdmin.js'
import { accountUser } from '../../composables/accountAuth.js'
import { useCampusLifePage } from '../../composables/campusLifePage.js'
import { campusErrorMessage } from '../../composables/campusContentModel.js'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Field, FieldGroup, FieldLabel, FieldDescription } from '../ui/field'
import { NativeSelect, NativeSelectOption } from '../ui/native-select'
import Modal from '../Modal.vue'

/**
 * 审核员列表每页条数。
 *
 * 由 platform-admin 的 listReviewers 在服务端写死为 25，和校园审核队列的
 * CAMPUS_PAGE_SIZE(30) 是两个不同接口各自的取值。写死在这里是为了和
 * `index * PAGE_SIZE >= total` 的翻页判断对上 —— 改成 30 会让最后一页永远
 * 点不动，或者跳过一部分记录。
 */
const REVIEWER_PAGE_SIZE = 25
const page = useCampusLifePage()
const search = ref('')
const candidates = ref([])
const selected = ref('')
const school = ref('')
const campus = ref('')
const reason = ref('')
const currentGrant = ref(null)
const searching = ref(false)
const saving = ref(false)
const feedback = ref('')
const error = ref('')
const revokeTarget = ref(null)
const index = ref(1)
const selectedAccount = computed(() => candidates.value.find((user) => user.id === selected.value))
let generation = 0
watch(() => accountUser.value?.id, () => { generation += 1; candidates.value = []; selected.value = ''; currentGrant.value = null; revokeTarget.value = null; search.value = ''; school.value = ''; campus.value = ''; reason.value = ''; searching.value = false; saving.value = false; error.value = ''; feedback.value = '' }, { flush: 'sync' })
async function refresh(next = index.value) { index.value = next; return page.load(() => platformAdminRequest('reviewers_list', { page: next })) }
async function findAccounts() {
  if (!search.value.trim() || searching.value) return
  const revision = ++generation
  searching.value = true
  error.value = ''
  selected.value = ''
  currentGrant.value = null
  try {
    const result = await platformAdminRequest('users_list', { query: search.value.trim(), page: 1 })
    if (revision === generation) candidates.value = (result.users || []).filter((user) => !user.platformOwner)
  } catch (cause) { if (revision === generation) error.value = campusErrorMessage(cause, '账号列表暂时无法读取。') }
  finally { if (revision === generation) searching.value = false }
}
async function chooseAccount(value) {
  if (value !== undefined) selected.value = String(value)
  const revision = ++generation
  currentGrant.value = null
  school.value = ''; campus.value = ''; reason.value = ''; error.value = ''; feedback.value = ''
  if (!selected.value) return
  searching.value = true
  try {
    const result = await platformAdminRequest('reviewers_list', { userId: selected.value })
    if (revision !== generation) return
    currentGrant.value = result.reviewers?.[0] || null
    school.value = currentGrant.value?.school || ''; campus.value = currentGrant.value?.campus || ''
  } catch (cause) { if (revision === generation) error.value = campusErrorMessage(cause, '该账号的审核授权暂时无法读取。') }
  finally { if (revision === generation) searching.value = false }
}
async function save(active = true, grant = null) {
  if (saving.value) return
  const revision = generation
  const target = grant || currentGrant.value
  const userId = grant?.user_id || selected.value
  if (!userId || !reason.value.trim()) { error.value = '请选择账号并填写操作原因。'; return }
  saving.value = true
  error.value = ''; feedback.value = ''
  try {
    await platformAdminRequest('reviewer_set', { userId, school: grant?.school || school.value.trim(), campus: grant?.campus ?? campus.value.trim(), active, reason: reason.value.trim(), revision: target?.revision ?? null })
    if (revision !== generation) return
    feedback.value = active ? '审核授权已保存。对方下次请求即可使用新权限。' : '审核权限已撤销。后续审核请求将被拒绝。'
    revokeTarget.value = null
    reason.value = ''
    await refresh()
    if (!grant && selected.value) currentGrant.value = { user_id: selected.value, school: school.value, campus: campus.value, active, revision: (target?.revision || 0) + 1 }
  } catch (cause) { if (revision === generation) error.value = campusErrorMessage(cause, active ? '审核授权没有保存，请重试。' : '审核权限没有撤销，请重试。') }
  finally { if (revision === generation || revision + 1 === generation) saving.value = false }
}
onMounted(() => { void refresh() })
</script>

<template>
  <section class="campus-life-panel">
    <div><h2>审核人员与范围</h2><p>仅总管理员可设置。审核员可处理授权范围内的投稿、举报与争议，不具有账号管理或继续授权的权限。</p></div>
    <form @submit.prevent="findAccounts"><FieldGroup class="flex-row items-end gap-3"><Field><FieldLabel for="reviewer-search">查找已注册账号</FieldLabel><Input id="reviewer-search" v-model="search" type="search" maxlength="120" placeholder="输入对方的完整邮箱" required /></Field><Button type="submit" :disabled="searching || saving">{{ searching ? '查找中…' : '查找账号' }}</Button></FieldGroup></form>
    <form v-if="candidates.length" @submit.prevent="save(true)">
      <FieldGroup>
        <Field><FieldLabel for="reviewer-account">授权账号</FieldLabel><NativeSelect id="reviewer-account" v-model="selected" :disabled="searching || saving" @update:model-value="chooseAccount"><NativeSelectOption value="">选择账号</NativeSelectOption><NativeSelectOption v-for="user in candidates" :key="user.id" :value="user.id">{{ user.email }}{{ user.status === 'active' ? '' : '（未验证或已暂停）' }}</NativeSelectOption></NativeSelect></Field>
        <Field><FieldLabel for="reviewer-school">学校</FieldLabel><Input id="reviewer-school" v-model="school" maxlength="100" required :disabled="searching || saving" /><FieldDescription>必须与校园内容的学校名称一致。</FieldDescription></Field>
        <Field><FieldLabel for="reviewer-campus">校区</FieldLabel><Input id="reviewer-campus" v-model="campus" maxlength="100" :disabled="searching || saving" /><FieldDescription>留空可审核该校全部校区；指定校区后，只能处理该校区内容。</FieldDescription></Field>
        <Field><FieldLabel for="reviewer-reason">操作原因</FieldLabel><Input id="reviewer-reason" v-model="reason" maxlength="500" required :disabled="saving" /></Field>
        <Button type="submit" :disabled="searching || saving || !selected || selectedAccount?.status !== 'active'">{{ saving ? '保存中…' : currentGrant ? '更新审核授权' : '授予审核权限' }}</Button>
      </FieldGroup>
    </form>
    <p v-else-if="search && !searching" class="campus-life-meta">账号注册并完成邮箱验证后，可以授予审核权限。总管理员账号不在此列表中。</p>
    <p v-if="error || page.error.value" role="alert" class="campus-life-inline-state error">{{ error || page.error.value }} <button class="text-button" @click="refresh()">刷新授权记录</button></p><p v-if="feedback" role="status" class="campus-life-inline-state campus-life-success">{{ feedback }}</p>
    <div class="campus-reviewer-list"><article v-for="grant in page.data.value?.reviewers || []" :key="grant.user_id" class="campus-reviewer-row"><div><b>{{ grant.email }}</b><p>{{ grant.school }} · {{ grant.campus || '全部校区' }} · {{ grant.active ? '授权中' : '已撤销' }}</p></div><Button v-if="grant.active" variant="outline" :disabled="saving" @click="revokeTarget = grant; reason = ''">撤销权限</Button></article></div>
    <div v-if="page.data.value?.total > REVIEWER_PAGE_SIZE" class="campus-life-actions"><Button variant="outline" :disabled="page.loading.value || index === 1" @click="refresh(index - 1)">上一页</Button><span>第 {{ index }} 页</span><Button variant="outline" :disabled="page.loading.value || index * REVIEWER_PAGE_SIZE >= page.data.value.total" @click="refresh(index + 1)">下一页</Button></div>
    <Modal v-if="revokeTarget" :open="true" title="撤销审核权限" @close="!saving && (revokeTarget = null)"><p>撤销 {{ revokeTarget.email }} 的校园审核权限。此操作会保留过往审核记录。</p><Field><FieldLabel for="revoke-reason">撤销原因</FieldLabel><Input id="revoke-reason" v-model="reason" maxlength="500" :disabled="saving" /></Field><template #foot><div class="campus-life-actions"><Button variant="outline" :disabled="saving" @click="revokeTarget = null">取消</Button><Button variant="destructive" :disabled="saving || !reason.trim()" @click="save(false, revokeTarget)">确认撤销</Button></div></template></Modal>
  </section>
</template>

<style scoped>
.campus-reviewer-list{display:grid;gap:10px}.campus-reviewer-row{display:flex;gap:14px;align-items:center;justify-content:space-between;padding:16px;border:1px solid var(--border);border-radius:var(--radius-9)}.campus-reviewer-row>div{min-width:0;overflow-wrap:anywhere}.campus-reviewer-row p{margin:6px 0 0;color:var(--muted);font-size:var(--fs-12)}
</style>
