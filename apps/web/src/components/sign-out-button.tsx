'use client'

import { useState } from 'react'

export function SignOutButton() {
  const [pending, setPending] = useState(false)
  async function signOut(): Promise<void> {
    setPending(true)
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.assign('/')
  }
  return (
    <button className="quiet-button" disabled={pending} onClick={signOut} type="button">
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  )
}
