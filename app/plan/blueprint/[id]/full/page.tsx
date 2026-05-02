import Link from 'next/link'
import type { Metadata } from 'next'
import { BlueprintFull } from '@/components/blueprint/BlueprintFull'
import { PlanHeader, PlanFooter } from '@/app/plan/page'

export const metadata: Metadata = {
  title: 'Your full website blueprint — fixmysite.in',
  description:
    'The complete website blueprint Bugbite wrote for your business — recommendation reasoning, technology choice with Indian context, exact pages and features, and the next-step plan.',
  robots: { index: false, follow: false },
}

/**
 * /plan/blueprint/[id]/full — paid full blueprint.
 *
 * Server shell only. The renderer is a client component that fetches
 * the payment-gated GET /api/blueprint/[id] — if the response has no
 * `full` field (owner not paid), it auto-redirects back to the
 * preview page where the unlock card lives.
 *
 * Slice 2.3 will add the PDF download button + send-to-developer
 * action. The page renders the same JSON either way; the action bar
 * lives below the content.
 */
export default async function BlueprintFullPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  return (
    <div className="flex flex-1 flex-col">
      <PlanHeader />

      <main className="flex-1 bg-white">
        <div className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
          <Link
            href={`/plan/blueprint/${id}`}
            className="inline-flex items-center gap-1 text-sm text-zinc-600 hover:text-zinc-900"
          >
            ← Back to preview
          </Link>

          <div className="mt-6">
            <BlueprintFull blueprintId={id} />
          </div>
        </div>
      </main>

      <PlanFooter />
    </div>
  )
}
