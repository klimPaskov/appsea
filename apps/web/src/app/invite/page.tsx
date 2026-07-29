import Link from 'next/link'
import { InvitationAcceptanceForm } from '../../components/invitation-acceptance-form'
import { readSession } from '../../server/auth-session'

export const metadata = {
  title: 'Workspace invitation · AppSea',
  robots: { index: false, follow: false }
}

export const dynamic = 'force-dynamic'

export default async function InvitationPage() {
  const session = await readSession()
  return (
    <main className="auth-page">
      <p className="eyebrow">Private research workspace</p>
      <h1>Join a workspace</h1>
      <p className="auth-intro">
        Invitations are for existing AppSea accounts and can be used once.
      </p>
      {session ? (
        <InvitationAcceptanceForm />
      ) : (
        <div className="auth-form" role="status">
          <p className="auth-intro">
            Sign in to the invited AppSea account before accepting this workspace invitation.
          </p>
          <Link className="quiet-button" href="/login">
            Sign in
          </Link>
        </div>
      )}
      <p className="auth-switch">
        Need an account? <Link href="/signup">Create one first</Link>
      </p>
    </main>
  )
}
