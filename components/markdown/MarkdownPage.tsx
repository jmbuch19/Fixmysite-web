import Image from 'next/image'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Shared layout + typography for the static legal/about pages.
 *
 * The three content pages (/about-us, /privacy, /terms) all share this
 * shell: header with cat mark + wordmark, max-720px centered prose,
 * footer with cross-links. The markdown body is rendered via
 * react-markdown with explicit Tailwind classes per element — we don't
 * use @tailwindcss/typography because Tailwind v4 has different plugin
 * mechanics and the per-element overrides give us tighter brand control
 * (priority colours, spacing rhythm, mobile-first sizes) anyway.
 *
 * remark-gfm enables tables and task lists — privacy.md uses a table
 * for the third-party-services list.
 */
export function MarkdownPage({
  title,
  content,
}: {
  title: string
  content: string
}) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-zinc-100 bg-white">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-5 py-4 sm:px-8">
          <Link
            href="/"
            className="flex items-center gap-2 transition-opacity hover:opacity-80"
            aria-label="Back to fixmysite.in homepage"
          >
            <Image
              src="/brand/logo-mark.png"
              alt=""
              width={397}
              height={294}
              priority
              className="h-7 w-auto mix-blend-multiply"
            />
            <span className="text-lg font-semibold text-brand">
              fixmysite.in
            </span>
          </Link>
        </div>
      </header>

      <main className="flex-1 bg-white">
        <article className="mx-auto w-full max-w-3xl px-5 py-12 sm:px-8 sm:py-16">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">
            {title}
          </h1>
          <div className="mt-8 space-y-5 text-base leading-relaxed text-zinc-700">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={mdComponents}
            >
              {content}
            </ReactMarkdown>
          </div>
        </article>
      </main>

      <footer className="border-t border-zinc-100 bg-white">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-5 py-6 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span>© {new Date().getFullYear()} fixmysite.in</span>
          <nav className="flex gap-5">
            <Link href="/about-us" className="hover:text-zinc-900">
              About
            </Link>
            <Link href="/privacy" className="hover:text-zinc-900">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-zinc-900">
              Terms
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}

// ─── Markdown element renderers ────────────────────────────────────────

// Many keys are spread to ReactMarkdown — typing each one with the full
// element-prop map is verbose, so we accept the loose shape and let
// Tailwind do the work. The components map is small; runtime cost zero.

type MdProps = { children?: React.ReactNode }

const mdComponents = {
  h1: ({ children }: MdProps) => (
    // The page <h1> is rendered above; treat any markdown <h1> as a
    // demoted h2 so we never get two h1s on a page.
    <h2 className="mt-10 text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl">
      {children}
    </h2>
  ),
  h2: ({ children }: MdProps) => (
    <h2 className="mt-10 text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl">
      {children}
    </h2>
  ),
  h3: ({ children }: MdProps) => (
    <h3 className="mt-8 text-xl font-semibold text-zinc-900">{children}</h3>
  ),
  h4: ({ children }: MdProps) => (
    <h4 className="mt-6 text-lg font-semibold text-zinc-900">{children}</h4>
  ),
  p: ({ children }: MdProps) => <p className="leading-relaxed">{children}</p>,
  ul: ({ children }: MdProps) => (
    <ul className="ml-5 list-disc space-y-2 marker:text-brand">{children}</ul>
  ),
  ol: ({ children }: MdProps) => (
    <ol className="ml-5 list-decimal space-y-2 marker:text-brand">
      {children}
    </ol>
  ),
  li: ({ children }: MdProps) => (
    <li className="leading-relaxed">{children}</li>
  ),
  a: ({ children, href }: MdProps & { href?: string }) => (
    <a
      href={href}
      className="text-brand underline underline-offset-2 hover:text-brand-accent"
      target={href?.startsWith('http') ? '_blank' : undefined}
      rel={href?.startsWith('http') ? 'noopener noreferrer' : undefined}
    >
      {children}
    </a>
  ),
  strong: ({ children }: MdProps) => (
    <strong className="font-semibold text-zinc-900">{children}</strong>
  ),
  em: ({ children }: MdProps) => <em className="italic">{children}</em>,
  blockquote: ({ children }: MdProps) => (
    <blockquote className="border-l-4 border-brand bg-brand-surface/50 px-5 py-3 italic text-zinc-700">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-10 border-zinc-200" />,
  code: ({ children }: MdProps) => (
    <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-sm text-zinc-800">
      {children}
    </code>
  ),
  table: ({ children }: MdProps) => (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }: MdProps) => (
    <thead className="bg-zinc-50">{children}</thead>
  ),
  th: ({ children }: MdProps) => (
    <th className="border border-zinc-200 px-3 py-2 text-left font-semibold text-zinc-900">
      {children}
    </th>
  ),
  td: ({ children }: MdProps) => (
    <td className="border border-zinc-200 px-3 py-2 align-top">{children}</td>
  ),
}
