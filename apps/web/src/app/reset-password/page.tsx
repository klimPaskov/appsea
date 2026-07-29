import Link from 'next/link'
import { PasswordResetForm } from '../../components/password-reset-form'

export const metadata = {
  title: 'Choose a new password · AppSea',
  robots: { index: false, follow: false }
}

// The proxy supplies a per-response CSP nonce; avoid serving a pre-rendered
// HTML shell whose inline hydration scripts cannot carry that nonce.
export const dynamic = 'force-dynamic'

export default function ResetPasswordPage() {
  return (
    <main className="auth-page">
      <p className="eyebrow">Private research workspace</p>
      <h1>Choose a new password</h1>
      <p className="auth-intro">The link is single-use and expires shortly.</p>
      <PasswordResetForm />
      <p className="auth-switch">
        Need another link? <Link href="/forgot-password">Recover access</Link>
      </p>
    </main>
  )
}
