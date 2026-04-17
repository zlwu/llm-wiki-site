import { promises as fs } from "node:fs"
import path from "node:path"
import matter from "gray-matter"
import yaml from "js-yaml"

const ROOT = process.cwd()
const SOURCE_ROOT = path.resolve(ROOT, process.env.WIKI_SOURCE_DIR || "source")
const CONTENT_DIR = path.join(ROOT, "content")
const SOURCE_DIRS = ["raw", "concepts", "entities", "comparisons", "queries"]
const ROOT_FILES = ["index.md"]

const warnings = []
const publishedFiles = []

async function main() {
  await fs.rm(CONTENT_DIR, { recursive: true, force: true })
  await fs.mkdir(CONTENT_DIR, { recursive: true })

  for (const file of ROOT_FILES) {
    const fullPath = path.join(SOURCE_ROOT, file)
    try {
      await fs.access(fullPath)
      await processMarkdownFile(fullPath, file, "root")
    } catch {
      // optional root file
    }
  }

  for (const dir of SOURCE_DIRS) {
    await walkAndProcess(dir)
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    sourceRoot: SOURCE_ROOT,
    publishedCount: publishedFiles.length,
    warnings,
    publishedFiles,
  }

  await fs.writeFile(
    path.join(CONTENT_DIR, "_publish-report.json"),
    JSON.stringify(summary, null, 2) + "\n",
    "utf8",
  )

  console.log(`Prepared ${publishedFiles.length} files into content/ from ${SOURCE_ROOT}`)
  if (warnings.length > 0) {
    console.warn(`Warnings: ${warnings.length}`)
    for (const warning of warnings) {
      console.warn(`- ${warning}`)
    }
  }
}

async function walkAndProcess(relativeDir) {
  const fullDir = path.join(SOURCE_ROOT, relativeDir)
  let entries = []
  try {
    entries = await fs.readdir(fullDir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue
    const relPath = path.join(relativeDir, entry.name)
    const fullPath = path.join(SOURCE_ROOT, relPath)

    if (entry.isDirectory()) {
      await walkAndProcess(relPath)
      continue
    }

    if (entry.isFile() && relPath.endsWith(".md")) {
      await processMarkdownFile(fullPath, relPath, relativeDir.split(path.sep)[0])
      continue
    }

    if (entry.isFile()) {
      await copyStaticFile(fullPath, relPath)
    }
  }
}

async function processMarkdownFile(fullPath, relativePath, topLevel) {
  const raw = await fs.readFile(fullPath, "utf8")
  const stats = await fs.stat(fullPath)

  let parsed
  try {
    parsed = matter(raw)
  } catch (error) {
    parsed = fallbackParseMatter(raw, relativePath, error)
  }

  const data = { ...parsed.data }
  const title = normalizeTitle(data.title, parsed.content, relativePath)
  const type = normalizeType(data.type, topLevel)
  const draft = normalizeBoolean(data.draft, false)
  const publish = normalizeBoolean(data.publish, true)

  if (draft || !publish) {
    return
  }

  const created = normalizeDate(data.created ?? data.date, stats.mtime)
  const updated = normalizeDate(data.updated ?? data.modified ?? data.lastmod, stats.mtime)
  const description = normalizeDescription(data.description, parsed.content)
  const tags = normalizeArray(data.tags ?? data.tag)
  const aliases = normalizeArray(data.aliases ?? data.alias)
  const sources = normalizeArray(data.sources)

  let body = parsed.content.trim()
  body = ensureSummaryHeading(body, topLevel)
  if (["concept", "entity", "comparison", "query"].includes(type)) {
    body = ensureSourceNotesSection(body, sources)
  }

  if (type === "source") {
    validateSourceStructure(relativePath, body, data.source_url)
  }

  const outputFrontmatter = {
    title,
    description,
    tags,
    type,
    publish: true,
    draft: false,
    created,
    updated,
    ...copyIfPresent(data, [
      "source_kind",
      "source_url",
      "source_site",
      "authors",
      "author",
      "arxiv_id",
      "language",
      "lang",
      "permalink",
      "comments",
      "socialImage",
      "image",
      "cover",
      "cssclasses",
    ]),
  }

  if (aliases.length > 0) outputFrontmatter.aliases = aliases
  if (sources.length > 0) outputFrontmatter.sources = sources

  const destPath = path.join(CONTENT_DIR, relativePath)
  await fs.mkdir(path.dirname(destPath), { recursive: true })
  const rendered = `---\n${yaml.dump(outputFrontmatter, { lineWidth: 1000, noRefs: true }).trimEnd()}\n---\n\n${body}\n`
  await fs.writeFile(destPath, rendered, "utf8")
  publishedFiles.push(relativePath)
}

async function copyStaticFile(fullPath, relativePath) {
  if (path.basename(relativePath) === ".gitkeep") return
  const destPath = path.join(CONTENT_DIR, relativePath)
  await fs.mkdir(path.dirname(destPath), { recursive: true })
  await fs.copyFile(fullPath, destPath)
}

function normalizeTitle(input, body, relativePath) {
  if (typeof input === "string" && input.trim()) return input.trim()
  const match = body.match(/^#\s+(.+)$/m)
  if (match) return match[1].trim()
  return path.basename(relativePath, ".md")
}

function normalizeType(input, topLevel) {
  if (typeof input === "string" && input.trim()) return input.trim()
  if (topLevel === "raw") return "source"
  if (topLevel === "root") return "summary"
  return topLevel.slice(0, -1)
}

function normalizeBoolean(input, fallback) {
  if (typeof input === "boolean") return input
  if (typeof input === "string") {
    const value = input.trim().toLowerCase()
    if (value === "true") return true
    if (value === "false") return false
  }
  return fallback
}

function normalizeDate(input, fallbackDate) {
  if (typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.trim())) {
    return input.trim()
  }
  return fallbackDate.toISOString().slice(0, 10)
}

function normalizeArray(input) {
  if (input === undefined || input === null) return []
  const values = Array.isArray(input) ? input : String(input).split(",")
  return [...new Set(values.map((item) => String(item).trim()).filter(Boolean))]
}

function normalizeDescription(input, body) {
  if (typeof input === "string" && input.trim()) {
    return collapseWhitespace(input)
  }

  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  for (const line of lines) {
    if (line.startsWith("#")) continue
    if (line.startsWith("- ")) continue
    if (line.startsWith(">")) continue
    return collapseWhitespace(stripMarkdown(line)).slice(0, 140)
  }

  return ""
}

function ensureSummaryHeading(body, topLevel) {
  if (topLevel !== "raw") return body
  if (/^#\s+一句话摘要/m.test(body)) return body
  return `# 一句话摘要\n\n待补充。\n\n${body}`.trim()
}

function ensureSourceNotesSection(body, sources) {
  if (!sources || sources.length === 0) return body
  if (/^##\s+来源笔记\s*$/m.test(body)) return body
  const links = sources.map((source) => `- [[${source.replace(/\.md$/i, "")}]]`).join("\n")
  return `${body.trim()}\n\n## 来源笔记\n${links}\n`
}

function validateSourceStructure(relativePath, body, sourceUrl) {
  const requiredHeadings = ["原文事实", "结构化整理", "Hermes 提炼"]
  for (const heading of requiredHeadings) {
    if (!new RegExp(`^##?\\s+${escapeRegExp(heading)}\\s*$`, "m").test(body)) {
      warnings.push(`${relativePath}: 缺少“${heading}”段落`)
    }
  }
  if (!sourceUrl) {
    warnings.push(`${relativePath}: 缺少 source_url`)
  }
}

function copyIfPresent(data, keys) {
  const result = {}
  for (const key of keys) {
    if (data[key] !== undefined && data[key] !== null && data[key] !== "") {
      result[key] = data[key]
    }
  }
  return result
}

function fallbackParseMatter(raw, relativePath, originalError) {
  if (!raw.startsWith("---\n")) {
    throw new Error(`Frontmatter parse failed for ${relativePath}: ${originalError.message}`)
  }

  const closingIndex = raw.indexOf("\n---", 4)
  if (closingIndex === -1) {
    throw new Error(`Frontmatter parse failed for ${relativePath}: missing closing delimiter`)
  }

  const frontmatterBlock = raw.slice(4, closingIndex)
  const content = raw.slice(closingIndex + 4).replace(/^\r?\n/, "")
  const data = {}

  for (const line of frontmatterBlock.split(/\r?\n/)) {
    if (!line.trim()) continue
    const separatorIndex = line.indexOf(":")
    if (separatorIndex === -1) {
      warnings.push(`${relativePath}: fallback frontmatter parser skipped line: ${line}`)
      continue
    }
    const key = line.slice(0, separatorIndex).trim()
    const rawValue = line.slice(separatorIndex + 1).trim()
    data[key] = parseScalarOrInlineArray(rawValue)
  }

  warnings.push(`${relativePath}: used fallback frontmatter parser (${originalError.message})`)
  return { data, content }
}

function parseScalarOrInlineArray(value) {
  if (!value) return ""
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  if (value === "true") return true
  if (value === "false") return false
  if (value.startsWith("[") && value.endsWith("]")) {
    return value
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => item.replace(/^['"]|['"]$/g, ""))
  }
  return value
}

function stripMarkdown(text) {
  return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1").replace(/[*_`>#-]/g, " ")
}

function collapseWhitespace(text) {
  return text.replace(/\s+/g, " ").trim()
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
