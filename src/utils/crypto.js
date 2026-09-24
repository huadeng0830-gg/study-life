// 统一加密工具：前后端同构（浏览器 crypto.subtle / Cloudflare Workers crypto.subtle）
// PBKDF2(150k) + AES-256-GCM + gzip 压缩

const PBKDF2_ITERATIONS = 150000
const KEY_LENGTH = 256
const IV_LENGTH = 12
const SALT_LENGTH = 16
export const MAX_ENCRYPTED_PAYLOAD_LENGTH = 8 * 1024 * 1024
export const MAX_DECOMPRESSED_PAYLOAD_BYTES = 16 * 1024 * 1024

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
  if (typeof CompressionStream !== 'function') return { data: new Uint8Array(data), compressed: false }
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('gzip'))
  return { data: new Uint8Array(await new Response(stream).arrayBuffer()), compressed: true }
}

async function decompress(data) {
  if (typeof DecompressionStream !== 'function') throw new Error('当前浏览器不支持 gzip 解压')
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'))
  if (typeof TransformStream === 'function') {
    let size = 0
    const limited = stream.pipeThrough(new TransformStream({
      transform(chunk, controller) {
        size += chunk.byteLength
        if (size > MAX_DECOMPRESSED_PAYLOAD_BYTES) throw new Error('解压后同步数据过大')
        controller.enqueue(chunk)
      },
    }))
    return new Uint8Array(await new Response(limited).arrayBuffer())
  }
  const result = new Uint8Array(await new Response(stream).arrayBuffer())
  if (result.byteLength > MAX_DECOMPRESSED_PAYLOAD_BYTES) throw new Error('解压后同步数据过大')
  return result
}

// 加密：明文对象 → base64url 密文（含 salt/iv/ciphertext）
export async function encryptData(plainObj, code) {
  // 先固定本次快照，再等待密钥派生；避免加密期间页面修改同一响应式对象。
  const json = JSON.stringify(plainObj)
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const key = await deriveKey(code, salt)

  const plain = encoder.encode(json)
  if (plain.byteLength > MAX_DECOMPRESSED_PAYLOAD_BYTES) throw new Error('同步数据过大')
  const compressed = await compress(plain)
  const marked = new Uint8Array(compressed.data.byteLength + 1)
  marked[0] = compressed.compressed ? 1 : 0
  marked.set(compressed.data, 1)
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, marked)

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
    if (typeof payload !== 'string' || payload.length > MAX_ENCRYPTED_PAYLOAD_LENGTH) throw new Error('数据长度超限')
    const binary = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    const combined = Uint8Array.from(binary, c => c.charCodeAt(0))

    if (combined.length < SALT_LENGTH + IV_LENGTH) throw new Error('数据长度不足')

    const salt = combined.slice(0, SALT_LENGTH)
    const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH)
    const cipher = combined.slice(SALT_LENGTH + IV_LENGTH)

    const key = await deriveKey(code, salt)
    const decrypted = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher))
    const isMarkedEnvelope = decrypted[0] === 0 || decrypted[0] === 1
    const body = isMarkedEnvelope ? decrypted.slice(1) : decrypted
    const decompressed = isMarkedEnvelope && decrypted[0] === 0 ? body : await decompress(body)
    if (decompressed.byteLength > MAX_DECOMPRESSED_PAYLOAD_BYTES) throw new Error('解压后同步数据过大')
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
