import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AccountSessionsPanel } from '../../../components/account-sessions-panel'
import { AccountClosurePanel } from '../../../components/account-closure-panel'
import { AccountMfaPanel } from '../../../components/account-mfa-panel'
import { authRepository, readSession, readSessionToken } from '../../../server/auth-session'

export const dynamic = 'force-dynamic'

export default async function AccountSecurityPage() {
  const session = await readSession()
  if (!session) redirect('/login')
  const token = await readSessionToken()
  if (!token) redirect('/login')

  const sessions = await authRepository().listActiveSessions(token)
  const mfaStatus = await authRepository().readMfaStatus(token)

  return (
    <main className="workspace-page account-security-page">
      <p className="breadcrumb">
        <Link href="/workspace">Workspace</Link>
        <span aria-hidden="true">/</span>
        <span>Account security</span>
      </p>
      <div className="workspace-toolbar workspace-opportunity-heading">
        <div>
          <p className="eyebrow">Account security</p>
          <h1>Active sessions</h1>
          <p className="auth-intro">
            Review where your AppSea account is signed in and revoke access you no longer recognize.
          </p>
        </div>
        <Link className="quiet-button" href="/workspace">
          Back to workspace
        </Link>
      </div>
      <section className="workspace-section" aria-labelledby="active-sessions-heading">
        <div className="section-intro">
          <h2 id="active-sessions-heading">Active sessions</h2>
          <p>
            {sessions.length} active session{sessions.length === 1 ? '' : 's'}.
          </p>
        </div>
        <AccountSessionsPanel initialSessions={sessions} />
      </section>
      <AccountMfaPanel initialStatus={mfaStatus} />
      <AccountClosurePanel />
    </main>
  )
}
