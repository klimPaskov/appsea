import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SiteHeader } from './site-header'

describe('site header', () => {
  it('uses the generated mark without adding content to the leaderboard', () => {
    const markup = renderToStaticMarkup(<SiteHeader />)

    expect(markup).toContain('AppSea leaderboard')
    expect(markup).toContain('appsea-mark-generated.png')
    expect(markup).toContain('Leaderboard')
    expect(markup).toContain('Sign in')
    expect(markup).not.toContain('Research status')
    expect(markup).not.toContain('dashboard')
  })
})
