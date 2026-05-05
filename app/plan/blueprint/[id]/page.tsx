import Link from 'next/link'
import type { Metadata } from 'next'
import { BlueprintPreview } from '@/components/blueprint/BlueprintPreview'
import { PlanHeader, PlanFooter } from '@/app/plan/page'

export const metadata: Metadata = {
  title: 'Your blueprint preview — fixmysite.in',
  description:
    'Bugbite read your answers and wrote a website blueprint tailored to your business — recommendation, reasoning, technology suggestions with Indian context.',
  // Owners share this URL after submitting the wizard. Keep it
  // unindexed — the page itself is fine to be public, but the search
  // value is zero (it requires a blueprint_id to be useful).
  robots: { index: false, follow: false },
}

/**
 * /plan/blueprint/[id] — free preview of the generated blueprint.
 *
 * Server component shell only — the actual preview UI runs client-side
 * because it owns the generate-on-demand lifecycle (Claude generation
 * takes long enough that the loading state must be visible, not
 * blocking the server render).
 *
 * Slice 2.1 ships the preview path. Slice 2.2 adds the paid full page
 * at /plan/blueprint/[id]/full and wires the unlock button to Razorpay.
 */
export default async function BlueprintPreviewPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  return (
    <div className="flex flex-1 flex-col">
      <PlanHeader />

      <main className="flex-1 bg-white">
        <div className="mx-auto w-full max-w-2xl px-5 py-10 sm:px-8 sm:py-14">
          <Link
            href="/plan"
            className="inline-flex items-center gap-1 text-sm text-zinc-600 hover:text-zinc-900"
          >
            ← Back
          </Link>

          <div className="mt-6">
            <BlueprintPreview blueprintId={id} />
          </div>
        </div>
      </main>

      <PlanFooter />
    </div>
  )
}
