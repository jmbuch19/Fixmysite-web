import Image from 'next/image'
import Link from 'next/link'
import type { Metadata } from 'next'
import { RegisterForm } from '@/components/developer/RegisterForm'

export const metadata: Metadata = {
  title: 'Join the partner network — fixmysite.in',
  description:
    'Register as a fixmysite.in certified partner. Get matched to Indian small-business clients near you and receive lead notifications.',
}

export default function DeveloperJoinPage() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-zinc-100 bg-white">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-2 px-5 py-4 sm:px-8">
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
        <div className="mx-auto w-full max-w-2xl px-5 py-12 sm:px-8 sm:py-16">
          <Link
            href="/developer"
            className="inline-flex items-center gap-1 text-sm text-zinc-600 hover:text-zinc-900"
          >
            ← Back
          </Link>

          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">
            Join the partner network
          </h1>
          <p className="mt-3 text-base leading-relaxed text-zinc-700">
            Tell Bugbite a bit about you. Approved partners receive lead
            notifications when matching work comes in and get a
            "fixmysite.in Certified Partner" badge on their public profile.
          </p>

          <div className="mt-8">
            <RegisterForm />
          </div>
        </div>
      </main>

      <footer className="border-t border-zinc-100 bg-white">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-5 py-6 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span>
            © {new Date().getFullYear()} fixmysite.in · Made for Indian
            businesses
          </span>
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
