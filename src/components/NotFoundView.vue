<template>
  <!-- 这里是 **div 不是 main**：本组件是路由组件，经 <router-view> 渲染在 App.vue
       的 <main id="main-content"> **内部**。一个文档只能有一个 main，嵌套 main 属无效结构——
       读屏会遇到两个「主内容」地标、部分实现还会直接忽略内层那个，404 页的内容就没了区域。
       样式全部走 .route-not-found 类选择器，所以改标签不影响外观。别改回 <main>。 -->
  <div class="route-not-found">
    <p class="route-not-found-code">404</p>
    <h1>页面不存在</h1>
    <p>这个入口已经移除或暂时不可用，本机数据仍然安全保留。</p>
    <router-link class="btn btn-primary" to="/">返回首页</router-link>
  </div>
</template>

<style scoped>
.route-not-found{display:grid;place-items:center;align-content:center;min-height:42vh;min-height:42dvh;padding:32px;text-align:center}.route-not-found-code{margin:0;color:var(--primary);font-size:var(--fs-12);font-weight:var(--fw-800);letter-spacing:.16em}.route-not-found h1{margin:8px 0 6px;font-size:var(--fs-24)}.route-not-found p:not(.route-not-found-code){margin:0 0 18px;color:var(--ink-soft);font-size:var(--fs-13)}
</style>
