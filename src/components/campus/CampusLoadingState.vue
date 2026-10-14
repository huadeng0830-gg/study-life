<script setup>
import { Spinner } from '../ui/spinner'
</script>
<template><div class="campus-life-loading" role="status"><Spinner aria-hidden="true" /><span><slot>正在读取校园信息…</slot></span></div></template>
