// 测试环境补丁：补回被 Node 内置 Web Storage 空壳遮蔽的 happy-dom localStorage。
//
// 【为什么需要这个文件】
// Node 22 起自带实验性 Web Storage，会在 `globalThis` 上定义 `localStorage` 这个
// **getter**；没有 `--localstorage-file` 时它返回 undefined，并打印
// `ExperimentalWarning: localStorage is not available because --localstorage-file was not provided`。
//
// vitest 的 `populateGlobal` 在把 happy-dom 的 window 铺到 globalThis 时会**跳过
// 已经存在的键**，于是 Node 那个空壳把 happy-dom 真正的 Storage 挡在了外面：
//   - `'localStorage' in globalThis === true`，但取出来是 undefined；
//   - `window === globalThis`（happy-dom 走的是 VM 上下文），所以换个引用也拿不到；
//   - `sessionStorage` 却是好的——因为 Node 没有定义它，happy-dom 的那份才铺得上。
// 表现就是 `localStorage.getItem/clear is not a function`，进而让所有依赖持久化的
// 用例成片变红（实测一次红掉 552 条）。
//
// 【为什么是模块顶层直接执行，而不是 default export】
// Vitest 4 只 import setup 文件、**不再调用它的 default export**（实测顶层副作用会执行、
// default export 不会）。写成顶层副作用在各版本下都成立。
//
// 【作用范围】
// 只在「确实是 DOM 环境」且「localStorage 确实不可用」时才补装，因此：
//   - 标注 `// @vitest-environment node` 的用例原样保持没有 localStorage，
//     它们断言的正是「拿不到持久化时别反复打扰用户」这类降级行为；
//   - 在没有内置 Web Storage 的旧版 Node 上跑时，本文件是纯空操作。
import { Storage } from 'happy-dom'

function isUsableStorage(storage) {
  try {
    return Boolean(storage) && typeof storage.getItem === 'function' && typeof storage.setItem === 'function'
  } catch {
    // Safari 私密模式下访问 localStorage 会直接抛错，这里统一当作不可用。
    return false
  }
}

// Node 的内置描述符是 configurable 的，可以直接覆盖；用 defineProperty 而不是赋值，
// 是为了连同 getter 一起换成数据属性，避免后续读取再次落回 Node 的空壳。
function defineStorage(name, storage) {
  Object.defineProperty(globalThis, name, {
    value: storage,
    writable: true,
    configurable: true,
    enumerable: true,
  })
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (!isUsableStorage(globalThis.localStorage)) defineStorage('localStorage', new Storage())
  if (!isUsableStorage(globalThis.sessionStorage)) defineStorage('sessionStorage', new Storage())
}
