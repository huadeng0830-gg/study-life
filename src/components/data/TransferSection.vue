<script setup>
const emit = defineEmits(['open'])
</script>

<template>
  <section id="data-transfer" class="data-section">
    <div class="section-icon transfer">▦</div>
    <div class="section-copy">
      <h4>本地二维码迁移</h4>
      <p>电脑生成加密二维码，手机扫码后选择合并或覆盖。数据只在两台设备之间传递，不上传服务器。</p>
      <button class="btn btn-primary" @click="emit('open')">打开二维码迁移</button>
    </div>
  </section>
</template>

<style scoped>
.section-icon {
  width:38px;
  height:38px;
  color:var(--primary);
  background:var(--primary-soft);
  border-radius:var(--radius-10);
  flex:0 0 38px;
  place-items:center;
  font-size:var(--fs-20);
  font-weight:var(--fw-800);
  display:grid}
.section-icon.transfer {
  color:var(--warning);
  background:color-mix(in srgb, var(--warning) 10%, var(--card))}
.section-copy {
  flex-direction:column;
  align-items:flex-start;
  gap:7px;
  display:flex}
.section-copy h4 {
  font-size:var(--fs-14)}
.section-copy p {
  color:var(--muted);
  font-size:var(--fs-12);
  line-height:1.55}
@media (max-width:520px) {
  .section-icon {
  flex-basis:32px;
  width:32px;
  height:32px;
  font-size:var(--fs-17)}
  .section-copy {
  width:100%;
  min-width:0}
}</style>
