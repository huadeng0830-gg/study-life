<script setup>
import { useCampusGovernanceAccess } from '../composables/campusGovernanceAccess.js'
import { accountOpen, accountUser } from '../composables/accountAuth.js'
import CampusCommunityAdmin from '../components/campus/CampusCommunityAdmin.vue'
import { Button } from '../components/ui/button'
import { Alert, AlertTitle, AlertDescription } from '../components/ui/alert'
const { access, error, loading, refresh } = useCampusGovernanceAccess()
</script>
<template><div class="page feedback-admin-page"><header class="page-head"><div><h1 class="page-title">反馈处理</h1><p class="page-desc">检查新反馈，更新进展和公开结论；涉及个人信息时通过站内私信沟通。</p></div><Button as-child variant="outline"><RouterLink to="/feedback">查看公开反馈</RouterLink></Button></header><Alert v-if="!accountUser"><AlertTitle>登录管理员账号</AlertTitle><AlertDescription><Button @click="accountOpen = true">登录</Button></AlertDescription></Alert><Alert v-else-if="error" variant="destructive"><AlertTitle>权限暂时无法读取</AlertTitle><AlertDescription>{{ error }} <Button variant="outline" @click="refresh">重试</Button></AlertDescription></Alert><p v-else-if="loading" role="status">正在核对处理权限…</p><CampusCommunityAdmin v-else-if="access?.owner" :key="accountUser.id" mode="feedback" /><Alert v-else><AlertTitle>仅总管理员可以处理反馈</AlertTitle><AlertDescription>你可以在公开反馈页面查看处理进展，或提交自己的问题与建议。</AlertDescription></Alert></div></template>
<style scoped>.feedback-admin-page{display:grid;gap:22px;min-width:0}</style>
