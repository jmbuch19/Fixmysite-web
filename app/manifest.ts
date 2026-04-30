import type { MetadataRoute } from 'next'

/**
 * Web App Manifest — wired via the Next.js App Router file convention.
 *
 * Surfaces at /manifest.webmanifest and is auto-linked from <head> by
 * Next so we don't need a manual <link rel="manifest"> tag.
 *
 * Fields and theme colors per BRAND.md → "PWA Manifest" section. The
 * 192/512 PNG assets must exist in /public/icons/ before the manifest
 * resolves correctly — they're listed as a separate brand-asset task.
 * Until those PNGs land, browsers will fetch the manifest, fail to load
 * the icons, and silently fall back to favicon.ico — install prompt
 * won't fire but no other functionality breaks.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'fixmysite.in',
    short_name: 'fixmysite',
    description:
      'Website health checker for Indian businesses. Bugbite scans, reports, and tells you exactly what to fix — in plain language. Your website, finally well-behaved.',
    start_url: '/',
    display: 'standalone',
    theme_color: '#0F6E56',
    background_color: '#ffffff',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
