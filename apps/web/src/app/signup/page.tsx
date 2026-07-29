import Link from 'next/link'
import { AuthForm } from '../../components/auth-form'

export default function SignupPage() {
  return (
    <main className="auth-page">
      <p className="eyebrow">Private research workspace</p>
      <h1>Create a workspace</h1>
      <p className="auth-intro">
        Keep collected evidence and opportunity packages private to your team.
      </p>
      <AuthForm mode="signup" />
      <p className="auth-switch">
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </main>
  )
}
