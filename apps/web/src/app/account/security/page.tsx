import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AccountSessionsPanel } from '../../../components/account-sessions-panel'
import { AccountClosurePanel } from '../../../components/account-closure-panel'
import { AccountMfaPanel } from '../../../components/account-mfa-panel'
import { AccountExternalIdentitiesPanel } from '../../../components/account-external-identities-panel'
import { authRepository, readSession, readSessionToken } from '../../../server/auth-session'
import { oidcIsConfigured } from '../../../server/oidc'

export const dynamic = 'force-dynamic'

type AccountSecurityPageProps = {
  searchParams?: Promise<{ oidc?: string }>
}

function oidcStatusMessage(code: string | undefined): string | undefined {
  switch (code) {
    case 'linked':
      return 'The verified identity provider was linked to this account.'
    case 'already_linked':
      return 'That provider identity is already linked to another AppSea account.'
    case 'step_up_required':
      return 'Verify your password and MFA again before changing identities.'
    case 'unavailable':
      return 'Identity-provider linking is temporarily unavailable.'
    default:
      return undefined
  }
}

export default async function AccountSecurityPage({ searchParams }: AccountSecurityPageProps) {
  const query = searchParams ? await searchParams : {}
  const session = await readSession()
  if (!session) redirect('/login')
  const token = await readSessionToken()
  if (!token) redirect('/login')

  const sessions = await authRepository().listActiveSessions(token)
  const mfaStatus = await authRepository().readMfaStatus(token)
  const externalIdentities = await authRepository().listExternalIdentities(token)
  const statusMessage = oidcStatusMessage(query.oidc)

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
      {statusMessage ? <p className="member-policy">{statusMessage}</p> : null}
      <section className="workspace-section" aria-labelledby="active-sessions-heading">
        <div className="section-intro">
          <h2 id="active-sessions-heading">Active sessions</h2>
          <p>
            {sessions.length} active session{sessions.length === 1 ? '' : 's'}.
          </p>
        </div>
        <AccountSessionsPanel initialSessions={sessions} />
      </section>
      <AccountExternalIdentitiesPanel
        initialIdentities={externalIdentities}
        oidcConfigured={oidcIsConfigured()}
        mfaEnabled={mfaStatus.enabled}
      />
      <AccountMfaPanel initialStatus={mfaStatus} />
      <AccountClosurePanel />
    </main>
  )
}
