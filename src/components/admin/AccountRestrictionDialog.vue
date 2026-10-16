<script setup>
import { computed, ref, watch } from 'vue'
import Modal from '../Modal.vue'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { PlatformAdminRequestError, platformAdminRequest } from '../../services/platformAdmin.js'
import { restrictionActive, restrictionDate, restrictionPayload, restrictionScopes } from '../../composables/accountRestrictionModel.js'
import '../../styles/shadcn.css'

const props = defineProps({ target: { type: Object, default: null } })
const emit = defineEmits(['close', 'saved', 'stale'])
const reason = ref('')
const preset = ref('604800')
const amount = ref('1')
const unit = ref('days')
const until = ref('')
const operation = ref('set')
const pending = ref(false)
const error = ref('')
const current = computed(() => props.target?.account.restrictions?.[props.target.scope])
const active = computed(() => restrictionActive(current.value) || (props.target?.scope === 'account' && props.target?.account.status === 'suspended'))
const scopeLabel = computed(() => restrictionScopes[props.target?.scope] || '账号限制')
const removing = computed(() => operation.value === 'lift')
const title = computed(() => removing.value ? `解除${scopeLabel.value}` : `${active.value ? '调整' : '设置'}${scopeLabel.value}`)
const preview = computed(() => {
  if (!props.target || removing.value) return '确认后立即解除这一项限制，其他限制保持有效。'
  try {
    const payload = restrictionPayload({ account: props.target.account, scope: props.target.scope, enabled: true, reason: '预览', preset: preset.value, amount: amount.value, unit: unit.value, until: until.value })
    return payload.permanent ? '永久生效，直到管理员提前解除。' : `预计解除：${restrictionDate(payload.expiresAt || new Date(Date.now() + payload.durationSeconds * 1000).toISOString())}。以服务器实际保存时间为准。`
  } catch { return '填写有效时长后显示预计解除时间。' }
})
watch(() => props.target, () => { reason.value = ''; preset.value = '604800'; amount.value = '1'; unit.value = 'days'; until.value = ''; operation.value = 'set'; error.value = '' })

function close() { if (!pending.value) emit('close') }
async function submit() {
  if (pending.value || !props.target) return
  error.value = ''
  let payload
  try { payload = restrictionPayload({ account: props.target.account, scope: props.target.scope, enabled: !removing.value, reason: reason.value, preset: preset.value, amount: amount.value, unit: unit.value, until: until.value }) }
  catch (failure) { error.value = failure instanceof Error ? failure.message : '请检查处理原因和时长。'; return }
  pending.value = true
  try {
    const result = await platformAdminRequest('user_restriction_set', payload)
    emit('saved', { ...result, label: scopeLabel.value, removed: removing.value })
    emit('close')
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '处理结果没有确认，请刷新账号状态后检查。'
    if (failure instanceof PlatformAdminRequestError && failure.code === 'state_changed') emit('stale')
  } finally { pending.value = false }
}
</script>

<template>
  <Modal :open="Boolean(target)" :title="title" @close="close">
    <form v-if="target" class="restriction-form" @submit.prevent="submit">
      <p class="restriction-target">{{ target.account.email || '此账号' }}</p>
      <p class="restriction-impact">{{ target.scope === 'account' ? '验证账号后将进入封禁告知页，暂停云端同步、发布、评论、私信与协作；可查看处理通知、退出账号，本机数据保留。' : '暂停发布、修改重提、评论、回复和发送内容；仍可登录、浏览、同步本机记录、收藏或撤回已有内容。' }}</p>
      <p v-if="active" class="restriction-current">当前{{ scopeLabel }}：{{ current?.expiresAt ? `至 ${restrictionDate(current.expiresAt)}` : target.account.bannedUntil && target.scope === 'account' ? `至 ${restrictionDate(target.account.bannedUntil)}` : '永久限制' }}<span v-if="current?.reason">原因：{{ current.reason }}</span></p>
      <FieldGroup>
        <Field v-if="active">
          <FieldLabel for="restriction-operation">本次操作</FieldLabel>
          <NativeSelect id="restriction-operation" v-model="operation" :disabled="pending">
            <NativeSelectOption value="set">调整限制时长</NativeSelectOption>
            <NativeSelectOption value="lift">立即解除此项限制</NativeSelectOption>
          </NativeSelect>
        </Field>
        <Field v-if="!removing">
          <FieldLabel for="restriction-preset">限制时长</FieldLabel>
          <NativeSelect id="restriction-preset" v-model="preset" :disabled="pending">
            <NativeSelectOption value="3600">1 小时</NativeSelectOption>
            <NativeSelectOption value="86400">1 天</NativeSelectOption>
            <NativeSelectOption value="604800">7 天</NativeSelectOption>
            <NativeSelectOption value="2592000">30 天</NativeSelectOption>
            <NativeSelectOption value="custom">自定义时长</NativeSelectOption>
            <NativeSelectOption value="until">指定解除时间</NativeSelectOption>
            <NativeSelectOption value="permanent">永久，手动解除</NativeSelectOption>
          </NativeSelect>
        </Field>
        <Field v-if="!removing && preset === 'custom'">
          <FieldLabel for="restriction-amount">自定义时长</FieldLabel>
          <div class="restriction-duration">
            <Input id="restriction-amount" v-model="amount" type="number" min="1" max="52560000" step="1" required :disabled="pending" />
            <NativeSelect id="restriction-unit" v-model="unit" aria-label="时长单位" :disabled="pending"><NativeSelectOption value="minutes">分钟</NativeSelectOption><NativeSelectOption value="hours">小时</NativeSelectOption><NativeSelectOption value="days">天</NativeSelectOption></NativeSelect>
          </div>
        </Field>
        <Field v-if="!removing && preset === 'until'">
          <FieldLabel for="restriction-until">解除时间</FieldLabel>
          <Input id="restriction-until" v-model="until" type="datetime-local" required :disabled="pending" />
          <FieldDescription>按当前设备时区填写。到期自动恢复，无需管理员保持在线。</FieldDescription>
        </Field>
        <p class="restriction-preview" role="status">{{ preview }}</p>
        <Field :data-invalid="Boolean(error)">
          <FieldLabel for="restriction-reason">处理原因 · 账号会收到此说明</FieldLabel>
          <textarea id="restriction-reason" v-model="reason" rows="3" maxlength="500" required :disabled="pending" :aria-invalid="Boolean(error)" aria-describedby="restriction-reason-help" placeholder="请清楚说明处理依据与需要改正的行为"></textarea>
          <FieldDescription id="restriction-reason-help">{{ reason.trim().length }} / 500 字。原因、时长及解除操作会写入管理记录。</FieldDescription>
        </Field>
      </FieldGroup>
      <p v-if="error" class="restriction-error" role="alert">{{ error }}</p>
      <div class="restriction-actions"><Button variant="outline" type="button" :disabled="pending" @click="close">取消</Button><Button :variant="removing ? 'default' : 'destructive'" type="submit" :disabled="pending">{{ pending ? '正在保存…' : removing ? '确认解除并通知' : '确认限制并通知' }}</Button></div>
    </form>
  </Modal>
</template>

<style scoped>
.restriction-form { display:grid; gap:16px; }
.restriction-target { margin:0; overflow-wrap:anywhere; font-weight:var(--fw-650); }
.restriction-impact,.restriction-current,.restriction-preview { margin:0; color:var(--muted); font-size:var(--fs-12); line-height:1.65; }
.restriction-current { padding:10px 12px; border:1px solid var(--border); border-radius:var(--radius-8); background:var(--bg-tint); }
.restriction-current span { display:block; overflow-wrap:anywhere; }
.restriction-duration { display:grid; grid-template-columns:minmax(0,1fr) 110px; gap:10px; }
.restriction-form :deep([data-slot='native-select-wrapper']) { width:100%; }
.restriction-form textarea { width:100%; resize:vertical; min-height:88px; padding:10px 12px; border:1px solid var(--border-strong); border-radius:var(--radius-8); color:var(--text); background:var(--bg); font:inherit; font-size:var(--fs-13); }
.restriction-form textarea:focus-visible { outline:var(--focus-width) solid var(--focus-solid); outline-offset:var(--focus-offset); }
.restriction-error { margin:0; color:var(--danger); font-size:var(--fs-12); }
.restriction-actions { display:flex; justify-content:flex-end; flex-wrap:wrap; gap:10px; }
@media(max-width:520px) { .restriction-actions > * { flex:1; } }
</style>
