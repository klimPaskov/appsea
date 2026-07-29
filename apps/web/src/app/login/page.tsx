import Link from 'next/link'
import { AuthForm } from '../../components/auth-form'

export default function LoginPage() {
  return (
    <main className="auth-page">
      <p className="eyebrow">Private research workspace</p>
      <h1>Sign in</h1>
      <p className="auth-intro">Review evidence, source coverage, and plans in your workspace.</p>
      <AuthForm mode="login" />
      <p className="auth-switch">
        Forgot your password? <Link href="/forgot-password">Recover access</Link>
      </p>
      <p className="auth-switch">
        New to AppSea? <Link href="/signup">Create a workspace</Link>
      </p>
    </main>
  )
}
