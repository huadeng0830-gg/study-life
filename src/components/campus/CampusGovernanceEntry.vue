<script setup>
import { ClipboardCheck, FilePlus, Flag, ShieldCheck } from '@lucide/vue'
import { useCampusGovernanceAccess } from '../../composables/campusGovernanceAccess.js'
import { Alert, AlertDescription } from '../ui/alert'
import { Button } from '../ui/button'
const { access, error, refresh } = useCampusGovernanceAccess()
</script>

<template>
  <section class="campus-governance-entry" aria-label="校园事务管理">
    <div><ShieldCheck aria-hidden="true" /><div><h2>校园事务</h2><p>{{ access?.owner ? '总管理员 · 管理审核授权，跟进投稿、举报与争议。' : access?.reviewer ? `审核员 · ${access.scope?.school || ''}${access.scope?.campus ? ' · ' + access.scope.campus : ' · 全校区'}` : '发布有用的信息，查看投稿进度和举报处理结果。' }}</p></div></div>
    <div class="campus-governance-entry-actions"><Button v-if="access?.reviewer" as-child><RouterLink to="/admin/campus"><ClipboardCheck data-icon="inline-start" />审核工作台</RouterLink></Button><Button as-child variant="outline"><RouterLink to="/campus/mine"><FilePlus data-icon="inline-start" />我的投稿</RouterLink></Button><Button as-child variant="outline"><RouterLink to="/campus/reports"><Flag data-icon="inline-start" />我的举报</RouterLink></Button></div>
    <Alert v-if="error"><AlertDescription>{{ error }} <button type="button" class="text-button" @click="refresh()">重试读取权限</button></AlertDescription></Alert>
  </section>
</template>

<style scoped>
.campus-governance-entry{display:grid;gap:16px;padding:20px;border:1px solid var(--border);border-radius:var(--radius-14);background:var(--card)}.campus-governance-entry>div:first-child{display:flex;gap:12px;align-items:flex-start}.campus-governance-entry>div:first-child>svg{color:var(--primary);width:24px;height:24px;flex:none}.campus-governance-entry h2{margin:0;font-size:var(--fs-17)}.campus-governance-entry p{margin:6px 0 0;color:var(--muted);font-size:var(--fs-12);line-height:1.8}.campus-governance-entry-actions{display:flex;gap:10px;flex-wrap:wrap}
</style>
