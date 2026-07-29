'use client'

import { useState } from 'react'

export function PasswordRecoveryForm() {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [pending, setPending] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setPending(true)
    setMessage(null)
    try {
      const response = await fetch('/api/auth/password-reset/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email })
      })
      const body = (await response.json()) as { error?: string }
      if (!response.ok) {
        setMessage(body.error ?? 'Password recovery is temporarily unavailable')
        return
      }
      setSubmitted(true)
    } catch {
      setMessage('The service is unavailable. Try again shortly.')
    } finally {
      setPending(false)
    }
  }

  if (submitted) {
    return (
      <div className="auth-form" role="status">
        <p className="auth-intro">
          If an AppSea account uses that address, a reset link will arrive shortly.
        </p>
      </div>
    )
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label>
        Email
        <input
          autoComplete="email"
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </label>
      <button disabled={pending} type="submit">
        {pending ? 'Sending…' : 'Send reset link'}
      </button>
      {message ? (
        <p className="form-error" role="alert">
          {message}
        </p>
      ) : null}
    </form>
  )
}
