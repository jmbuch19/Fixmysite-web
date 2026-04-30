import fs from 'node:fs/promises'
import path from 'node:path'
import type { Metadata } from 'next'
import { MarkdownPage } from '@/components/markdown/MarkdownPage'

export const metadata: Metadata = {
  title: 'Privacy — fixmysite.in',
  description:
    'How fixmysite.in handles the data we collect when Bugbite scans your site.',
}

export default async function PrivacyPage() {
  const content = await fs.readFile(
    path.join(process.cwd(), 'privacy.md'),
    'utf-8',
  )
  return <MarkdownPage title="Privacy" content={content} />
}
