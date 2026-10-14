<script setup>
import { computed } from 'vue'
const props = defineProps({ form: { type: Object, required: true }, title: String, school: String, campus: String })
const labels = { name:'名称', title:'标题', description:'说明', body:'正文', officialIntro:'公开介绍', researchDirections:'研究方向', department:'院系', term:'学期', price:'价格（元）', condition:'成色', meetupArea:'交接区域', pickupArea:'取件区域', deliveryArea:'送达区域', deadline:'截止时间', approximateLocation:'大致位置', occurredAt:'发生日期', startsAt:'开始时间', endsAt:'结束时间', location:'活动地点', organizer:'组织方', capacity:'活动名额', sourceUrl:'公开来源', signupUrl:'外部报名地址', effectiveFrom:'生效日期', effectiveTo:'截止日期', stopsText:'站点', departuresText:'班次', serviceDate:'特殊日期', departureTime:'发车时间', note:'备注', detail:'补充说明', expiresOn:'有效期' }
const fields = computed(() => Object.entries(props.form).filter(([key,value]) => labels[key] && String(value ?? '').trim()).map(([key,value]) => ({ key, label:labels[key], value:String(value) })))
</script>
<template>
  <details class="campus-publish-preview"><summary>预览公开内容</summary><div><h3>{{ title }}</h3><p>{{ school || '提交前请先设置学校' }}<template v-if="campus"> · {{ campus }}</template> · 审核通过后展示</p><dl v-if="fields.length"><div v-for="field in fields" :key="field.key"><dt>{{ field.label }}</dt><dd>{{ field.value }}</dd></div></dl><p v-else>填写表单后，可以在这里检查将要公开的内容。</p></div></details>
</template>
<style scoped>
.campus-publish-preview{grid-column:1/-1;border:1px solid var(--border);border-radius:var(--radius-9);background:var(--bg-tint)}.campus-publish-preview summary{min-height:44px;padding:12px;cursor:pointer;font-size:var(--fs-13);font-weight:var(--fw-650)}.campus-publish-preview>div{padding:0 16px 16px}.campus-publish-preview h3{margin:6px 0}.campus-publish-preview p,.campus-publish-preview dt{color:var(--muted);font-size:var(--fs-12);line-height:1.8}.campus-publish-preview dl{display:grid;gap:12px;margin:16px 0 0}.campus-publish-preview dd{margin:4px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.8;font-size:var(--fs-13)}
</style>
