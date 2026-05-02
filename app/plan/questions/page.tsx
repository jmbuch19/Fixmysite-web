import Link from 'next/link'
import type { Metadata } from 'next'
import { BlueprintQuestions } from '@/components/blueprint/BlueprintQuestions'
import { PlanHeader, PlanFooter } from '@/app/plan/page'

export const metadata: Metadata = {
  title: 'Plan a website — questions — fixmysite.in',
  description:
    'Tell Bugbite about your business — Bugbite turns your answers into a website blueprint with reasoning, technology recommendations, and Indian context.',
}

/**
 * /plan/questions — wrapper for the cascading question wizard.
 *
 * Server component that just sets the page chrome + intro copy.
 * The wizard itself (BlueprintQuestions) runs client-side because
 * it owns local React state for answers + step navigation; nothing
 * persists to the DB until the final submit on step 7.
 */
export default function PlanQuestionsPage() {
  return (
    <div className="flex flex-1 flex-col">
      <PlanHeader />

      <main className="flex-1 bg-white">
        <div className="mx-auto w-full max-w-2xl px-5 py-12 sm:px-8 sm:py-16">
          <Link
            href="/plan"
            className="inline-flex items-center gap-1 text-sm text-zinc-600 hover:text-zinc-900"
          >
            ← Back
          </Link>

          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">
            Tell Bugbite about your business
          </h1>
          <p className="mt-3 text-base leading-relaxed text-zinc-700">
            Seven short steps. Each answer reveals the next question —
            Bugbite asks different things depending on what kind of
            business you run, so the recommendation at the end actually
            fits.
          </p>

          <div className="mt-10">
            <BlueprintQuestions />
          </div>
        </div>
      </main>

      <PlanFooter />
    </div>
  )
}
