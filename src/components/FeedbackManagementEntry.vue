<script setup>
import { useCampusGovernanceAccess } from '../composables/campusGovernanceAccess.js'
import { Button } from './ui/button'
const { access } = useCampusGovernanceAccess()
</script>
<template><section class="feedback-management-entry"><h2>反馈与建议</h2><p>查看大家遇到的问题、改进建议和公开处理进度。</p><div><Button as-child variant="outline"><RouterLink to="/feedback">查看公开反馈</RouterLink></Button><Button v-if="access?.owner" as-child><RouterLink to="/admin/feedback">处理用户反馈</RouterLink></Button></div></section></template>
<style scoped>.feedback-management-entry{display:grid;gap:12px;padding:20px;border:1px solid var(--border);border-radius:var(--radius-14);background:var(--card)}.feedback-management-entry h2{margin:0;font-size:var(--fs-17)}.feedback-management-entry p{margin:0;font-size:var(--fs-12);color:var(--muted)}.feedback-management-entry>div{display:flex;gap:10px;flex-wrap:wrap}</style>
