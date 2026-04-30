import fs from 'node:fs/promises'
import path from 'node:path'
import type { Metadata } from 'next'
import { MarkdownPage } from '@/components/markdown/MarkdownPage'

export const metadata: Metadata = {
  title: 'Terms — fixmysite.in',
  description:
    'The terms under which fixmysite.in scans your website and delivers reports.',
}

export default async function TermsPage() {
  const content = await fs.readFile(
    path.join(process.cwd(), 'terms.md'),
    'utf-8',
  )
  return <MarkdownPage title="Terms" content={content} />
}
