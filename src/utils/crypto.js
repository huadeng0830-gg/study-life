// 统一加密工具：前后端同构（浏览器 crypto.subtle / Cloudflare Workers crypto.subtle）
// PBKDF2(150k) + AES-256-GCM + gzip 压缩

const PBKDF2_ITERATIONS = 150000
const KEY_LENGTH = 256
const IV_LENGTH = 12
const SALT_LENGTH = 16

const encoder = new TextEncoder()
const decoder = new TextDecoder()

// code（6 位数字）+ 可选盐 → 派生密钥
export async function deriveKey(code, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(code),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  )
}

// 压缩（gzip）
async function compress(data) {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function decompress(data) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

// 加密：明文对象 → base64url 密文（含 salt/iv/ciphertext）
export async function encryptData(plainObj, code) {
  // 先固定本次快照，再等待密钥派生；避免加密期间页面修改同一响应式对象。
  const json = JSON.stringify(plainObj)
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const key = await deriveKey(code, salt)

  const compressed = await compress(encoder.encode(json))
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, compressed)

  // 组装：salt(16) + iv(12) + ciphertext
  const combined = new Uint8Array(SALT_LENGTH + IV_LENGTH + cipher.byteLength)
  combined.set(salt, 0)
  combined.set(iv, SALT_LENGTH)
  combined.set(new Uint8Array(cipher), SALT_LENGTH + IV_LENGTH)

  let binary = ''
  // 大数组一次 spread 会超过 Safari/JavaScript 的函数参数上限。
  for (let offset = 0; offset < combined.length; offset += 0x8000) {
    binary += String.fromCharCode(...combined.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

// 解密：base64url 密文 → 明文对象
export async function decryptData(payload, code) {
  try {
    const binary = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    const combined = Uint8Array.from(binary, c => c.charCodeAt(0))

    if (combined.length < SALT_LENGTH + IV_LENGTH) throw new Error('数据长度不足')

    const salt = combined.slice(0, SALT_LENGTH)
    const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH)
    const cipher = combined.slice(SALT_LENGTH + IV_LENGTH)

    const key = await deriveKey(code, salt)
    const compressed = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher)
    const decompressed = await decompress(compressed)
    return JSON.parse(decoder.decode(decompressed))
  } catch {
    throw new Error('解密失败：访问码错误或数据已损坏')
  }
}

// 生成 code 的 SHA-256 前缀（用作 KV 前缀，不泄露 code）
export async function codeHash(code) {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(code))
  return Array.from(new Uint8Array(hash))
    .slice(0, 16)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}
