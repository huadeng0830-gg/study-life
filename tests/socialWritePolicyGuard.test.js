import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const migrations = fileURLToPath(new URL('../supabase/migrations/', import.meta.url))
const protectedTables = [
  'social_friend_requests',
  'social_friendships',
  'social_invitations',
  'social_invitation_participants',
]

function readStatements() {
  const text = readdirSync(migrations)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => readFileSync(path.join(migrations, name), 'utf8'))
    .join('\n')
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  return text.split(';').map((statement) => statement.trim()).filter(Boolean)
}

describe('好友关系表禁止客户端直接写入', () => {
  it.each(protectedTables)('%s 不能获得 authenticated 写策略或写权限', (table) => {
    const statements = readStatements()
    const hasWritePolicy = statements.some((statement) => (
      /\bcreate\s+policy\b/i.test(statement)
      && new RegExp(`\\bpublic\\.${table}\\b`, 'i').test(statement)
      && /\bfor\s+(?:insert|update|delete|all)\b/i.test(statement)
      && /\bto\s+authenticated\b/i.test(statement)
    ))
    const hasWriteGrant = statements.some((statement) => (
      /\bgrant\s+(?:all|insert|update|delete)\b/i.test(statement)
      && new RegExp(`\\bpublic\\.${table}\\b`, 'i').test(statement)
      && /\bto\s+authenticated\b/i.test(statement)
    ))
    expect({ hasWritePolicy, hasWriteGrant }).toEqual({ hasWritePolicy: false, hasWriteGrant: false })
  })
})
