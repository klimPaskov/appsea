import Link from 'next/link'
import { PasswordRecoveryForm } from '../../components/password-recovery-form'

export const metadata = {
  title: 'Recover access · AppSea',
  robots: { index: false, follow: false }
}

export default function ForgotPasswordPage() {
  return (
    <main className="auth-page">
      <p className="eyebrow">Private research workspace</p>
      <h1>Recover access</h1>
      <p className="auth-intro">Request a single-use link to choose a new password.</p>
      <PasswordRecoveryForm />
      <p className="auth-switch">
        Remembered your password? <Link href="/login">Sign in</Link>
      </p>
    </main>
  )
}
