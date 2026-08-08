import fs from 'node:fs'
import path from 'node:path'
import type { DefaultTheme } from 'vitepress'

const ROOT = process.cwd()
const EXCLUDED_TOP_LEVEL_DIRS = new Set([
  '.git',
  '.github',
  '.vitepress',
  'node_modules',
  'public',
])

function titleFromMarkdown(filePath: string) {
  const source = fs.readFileSync(filePath, 'utf8')
  const frontmatterTitle = source.match(/^---[\s\S]*?^title:\s*["']?(.+?)["']?\s*$[\s\S]*?^---/m)?.[1]
  const headingTitle = source.match(/^#\s+(.+)$/m)?.[1]

  return frontmatterTitle?.trim() || headingTitle?.trim() || path.basename(filePath, '.md')
}

function markdownFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.'))
    .flatMap((entry) => {
      const absolutePath = path.join(dir, entry.name)

      if (entry.isDirectory()) return markdownFiles(absolutePath)
      if (entry.isFile() && entry.name.endsWith('.md')) return [absolutePath]
      return []
    })
}

function routeFromFile(filePath: string) {
  const relative = path.relative(ROOT, filePath).replaceAll(path.sep, '/')

  if (relative === 'README.md') return '/'
  if (relative.endsWith('/README.md')) return `/${relative.slice(0, -'README.md'.length)}`
  return `/${relative.slice(0, -'.md'.length)}`
}

function sortTopicFiles(a: string, b: string) {
  const aIsReadme = path.basename(a).toLowerCase() === 'readme.md'
  const bIsReadme = path.basename(b).toLowerCase() === 'readme.md'

  if (aIsReadme !== bIsReadme) return aIsReadme ? -1 : 1
  return a.localeCompare(b, 'zh-CN')
}

export function createSidebar(): DefaultTheme.SidebarItem[] {
  const topLevelDirs = fs
    .readdirSync(ROOT, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.name.startsWith('.') &&
        !EXCLUDED_TOP_LEVEL_DIRS.has(entry.name),
    )
    .map((entry) => entry.name)
    .filter((name) => markdownFiles(path.join(ROOT, name)).length > 0)
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))

  const topics: DefaultTheme.SidebarItem[] = topLevelDirs.map((dirName) => {
    const dir = path.join(ROOT, dirName)
    const files = markdownFiles(dir).sort(sortTopicFiles)
    const readme = files.find((file) => path.basename(file).toLowerCase() === 'readme.md')

    return {
      text: readme ? titleFromMarkdown(readme) : dirName,
      collapsed: false,
      items: files.map((file) => ({
        text: titleFromMarkdown(file),
        link: routeFromFile(file),
      })),
    }
  })

  return [{ text: '首页', link: '/' }, ...topics]
}
