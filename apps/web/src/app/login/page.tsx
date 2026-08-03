import Link from 'next/link'
import { AuthForm } from '../../components/auth-form'
import { oidcIsConfigured } from '../../server/oidc'

type LoginPageProps = {
  searchParams?: Promise<{ oidc?: string; oidc_mfa?: string }>
}

function oidcMessage(code: string | undefined): string | undefined {
  switch (code) {
    case 'not_linked':
      return 'Link your identity provider from account security before using it to sign in.'
    case 'cancelled':
      return 'Identity-provider sign-in was cancelled.'
    case 'expired':
      return 'The identity-provider sign-in expired. Try again.'
    case 'invalid_state':
      return 'The identity-provider response could not be verified.'
    case 'unavailable':
      return 'Identity-provider sign-in is temporarily unavailable.'
    default:
      return undefined
  }
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const query = searchParams ? await searchParams : {}
  const oidcMfaPending = query.oidc_mfa === '1'
  const initialMessage = oidcMessage(query.oidc)
  return (
    <main className="auth-page">
      <p className="eyebrow">Private research workspace</p>
      <h1>Sign in</h1>
      <p className="auth-intro">Review evidence, source coverage, and plans in your workspace.</p>
      <AuthForm
        mode="login"
        oidcMfaPending={oidcMfaPending}
        {...(initialMessage ? { initialMessage } : {})}
      />
      {oidcIsConfigured() && !oidcMfaPending ? (
        <p className="auth-switch">
          <a className="quiet-button" href="/api/auth/oidc/start?mode=login">
            Continue with identity provider
          </a>
        </p>
      ) : null}
      <p className="auth-switch">
        Forgot your password? <Link href="/forgot-password">Recover access</Link>
      </p>
      <p className="auth-switch">
        New to AppSea? <Link href="/signup">Create a workspace</Link>
      </p>
    </main>
  )
}
