import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import LeaderboardPage from './page'

describe('public leaderboard page', () => {
  it('keeps the public surface sparse and fixture-disclosed', () => {
    const markup = renderToStaticMarkup(<LeaderboardPage />)

    expect(markup).toContain('<h1>Leaderboard</h1>')
    expect(markup).toContain('Inbox Relay')
    expect(markup).toContain('Complaints')
    expect(markup).toContain('Score')
    expect(markup).toContain('Synthetic fixture ranking for product and interface validation.')
    expect(markup).not.toContain('AppSea opportunity intelligence')
    expect(markup).not.toContain('Evidence-ranked software opportunities')
    expect(markup).not.toContain('Research status')
    expect(markup).not.toContain('Selected opportunity')
  })
})
