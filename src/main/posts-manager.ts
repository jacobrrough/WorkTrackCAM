/**
 * Post-processor (.hbs template) manager.
 *
 * Bundled posts live in `resources/posts/`.
 * User-uploaded posts live in `{app.getPath('userData')}/posts/`.
 * User posts override bundled ones with the same filename.
 */
import { app } from 'electron'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { getResourcesRoot } from './paths'

export type PostEntry = {
  filename: string
  /** Absolute path to the .hbs file. */
  path: string
  /** 'bundled' | 'user' */
  source: 'bundled' | 'user'
  /** First 3 non-comment lines of the template for preview. */
  preview: string
}

function getUserPostsDir(): string {
  return join(app.getPath('userData'), 'posts')
}

function getBundledPostsDir(): string {
  return join(getResourcesRoot(), 'posts')
}

async function previewLines(filePath: string): Promise<string> {
  try {
    const text = await readFile(filePath, 'utf-8')
    const lines = text
      .split('\n')
      .filter((l) => l.trim() && !l.trim().startsWith('{{!--') && !l.trim().startsWith('--}}'))
      .slice(0, 3)
    return lines.join('\n')
  } catch {
    return ''
  }
}

export async function listAllPosts(): Promise<PostEntry[]> {
  const entries: PostEntry[] = []
  const seen = new Set<string>()

  // User posts first (they take precedence)
  const userDir = getUserPostsDir()
  if (existsSync(userDir)) {
    try {
      const files = await readdir(userDir)
      for (const f of files.filter((n) => extname(n) === '.hbs')) {
        const path = join(userDir, f)
        entries.push({ filename: f, path, source: 'user', preview: await previewLines(path) })
        seen.add(f)
      }
    } catch { /* ignore */ }
  }

  // Bundled posts
  const bundledDir = getBundledPostsDir()
  if (existsSync(bundledDir)) {
    try {
      const files = await readdir(bundledDir)
      for (const f of files.filter((n) => extname(n) === '.hbs')) {
        if (seen.has(f)) continue
        const path = join(bundledDir, f)
        entries.push({ filename: f, path, source: 'bundled', preview: await previewLines(path) })
      }
    } catch { /* ignore */ }
  }

  return entries.sort((a, b) => a.filename.localeCompare(b.filename))
}

export async function saveUserPost(filename: string, content: string): Promise<PostEntry> {
  if (!filename.endsWith('.hbs')) throw new Error('Post-processor files must have a .hbs extension.')
  const safe = basename(filename)
  const dir = getUserPostsDir()
  await mkdir(dir, { recursive: true })
  const path = join(dir, safe)
  await writeFile(path, content, 'utf-8')
  const preview = content
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('{{!--') && !l.trim().startsWith('--}}'))
    .slice(0, 3)
    .join('\n')
  return { filename: safe, path, source: 'user', preview }
}

export async function readPostContent(filename: string): Promise<string> {
  // Try user first, then bundled
  const userPath = join(getUserPostsDir(), basename(filename))
  if (existsSync(userPath)) return readFile(userPath, 'utf-8')
  const bundledPath = join(getBundledPostsDir(), basename(filename))
  return readFile(bundledPath, 'utf-8')
}
