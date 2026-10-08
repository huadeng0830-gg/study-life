import { describe, expect, it } from 'vitest'
import { isReleaseStatusInSync, renderReleaseStatus, syncReleaseStatus } from '../scripts/release-readme.mjs'

const release = {
  webVersion: '2026年10月08日-版本3',
  desktopVersion: '1.0.4',
  notes: ['桌面安装包会随应用一并打入更新依赖', '发布工作流会上传 Windows 安装包和 latest.yml'],
}

describe('README 发布状态同步', () => {
  it('生成网页版本、桌面版本、最近说明和下载入口', () => {
    const block = renderReleaseStatus(release)
    expect(block).toContain('网页 / PWA `2026年10月08日-版本3`')
    expect(block).toContain('Windows 桌面版 `1.0.4`')
    expect(block).toContain('> - 发布工作流会上传 Windows 安装包和 latest.yml')
    expect(block).toContain('/releases/latest')
  })

  it('只替换 README 中唯一的动态区块并能验证一致性', () => {
    const readme = '# App\n\n<!-- RELEASE_STATUS:START -->\n旧版本\n<!-- RELEASE_STATUS:END -->\n\n## 使用'
    const updated = syncReleaseStatus(readme, release)
    expect(updated).toContain('# App\n\n')
    expect(updated).toContain('\n\n## 使用')
    expect(isReleaseStatusInSync(updated, release)).toBe(true)
    expect(isReleaseStatusInSync(readme, release)).toBe(false)
  })

  it('Windows CRLF 检出时仍能验证发布区块一致', () => {
    const readme = syncReleaseStatus('# App\n\n<!-- RELEASE_STATUS:START -->\n旧版本\n<!-- RELEASE_STATUS:END -->\n\n## 使用', release)
    const windowsReadme = readme.replace(/\n/g, '\r\n')
    expect(isReleaseStatusInSync(windowsReadme, release)).toBe(true)
    expect(isReleaseStatusInSync(windowsReadme.replace('1.0.4', '1.0.3'), release)).toBe(false)
  })

  it('标记缺失或重复时拒绝写入', () => {
    expect(() => syncReleaseStatus('# App', release)).toThrow('README.md 必须且只能包含一组')
    const duplicated = '<!-- RELEASE_STATUS:START --><!-- RELEASE_STATUS:END -->\n<!-- RELEASE_STATUS:START --><!-- RELEASE_STATUS:END -->'
    expect(() => syncReleaseStatus(duplicated, release)).toThrow('README.md 必须且只能包含一组')
  })
})
