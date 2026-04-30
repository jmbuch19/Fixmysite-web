import fs from 'node:fs/promises'
import path from 'node:path'
import type { Metadata } from 'next'
import { MarkdownPage } from '@/components/markdown/MarkdownPage'

export const metadata: Metadata = {
  title: 'About — fixmysite.in',
  description:
    'Why Bugbite exists and who fixmysite.in is built for. A scanner that reads your website the way your customer does.',
}

export default async function AboutUsPage() {
  const content = await fs.readFile(
    path.join(process.cwd(), 'about-us.md'),
    'utf-8',
  )
  return <MarkdownPage title="About fixmysite.in" content={content} />
}
