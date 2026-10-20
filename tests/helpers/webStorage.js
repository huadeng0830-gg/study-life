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

// ---------------------------------------------------------------------------
// 定时器外壳：文件跑完就不再跑。
//
// 【为什么需要】
// 应用里有不少**模块级**的定时器（更新检查、读屏播报、影子写盘……）。
// 模块不是组件，没有卸载时机，这些定时器会一直活到进程结束。测试环境拆除时
// window 会被删掉，那一刻排好的定时器照样触发 → 抛 "window is not defined"，
// 而错误会落到**当时正在跑的那个文件**头上，让不相干的用例一起变红。
// 表现就是：本机全绿，CI 却红在 viewRenderMatrix / promptDialogMigration /
// engineeringFrontendProjectsLifecycle 这几个根本没碰更新检查的文件上。
//
// 【为什么在这里统一处理，而不是逐个模块加守卫】
// 逐个加守卫要改几十处，而且每漏一处就再爆一次。这里给**所有**定时器套一层：
// 回调执行前先确认这个测试文件还没结束，不结束就安静跳过。
//
// 【判据为什么是"文件结束"而不是"window 还在不在"】
// 后者会误伤 tests/mirrorDurability.test.js：它刻意把全局 window 换成 undefined
// 来模拟环境拆除，并要求**定时器照常触发**，好观察数据层自己的守卫把那次冲刷丢掉。
// 用 window 的存在性当判据会把那次触发也一起吞掉，用例就会超时。
// 文件结束是更准的信号：那一刻起，本来就不该再有回调跑起来。
//
// 【不影响什么】
// 回调的调用时机、参数、返回值都原样透传；`vi.useFakeTimers()` 会整体换掉定时器，
// 不经过这一层；`clearTimeout` 拿到的仍是原始句柄，照常可清。
// ---------------------------------------------------------------------------
import { afterAll } from 'vitest'

let fileFinished = false
afterAll(() => { fileFinished = true })

function wrapTimer(original) {
  if (typeof original !== 'function') return original
  const wrapped = function (callback, delay, ...args) {
    if (typeof callback !== 'function') return original.apply(this, [callback, delay, ...args])
    return original.apply(this, [function (...inner) {
      if (fileFinished) return
      return callback.apply(this, inner)
    }, delay, ...args])
  }
  return wrapped
}

if (typeof window !== 'undefined') {
  window.setTimeout = wrapTimer(window.setTimeout)
  window.setInterval = wrapTimer(window.setInterval)
  if (globalThis !== window) {
    globalThis.setTimeout = wrapTimer(globalThis.setTimeout)
    globalThis.setInterval = wrapTimer(globalThis.setInterval)
  }
}
