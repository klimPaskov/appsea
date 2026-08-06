import { describe, expect, it } from 'vitest'
import { captureRoutes, captureViewports } from './capture_ui_reference.mjs'

describe('local UI reference capture contract', () => {
  it('captures the canonical public route and every focused opportunity surface', () => {
    expect(captureRoutes.map((route) => route.path)).toEqual([
      '/leaderboard',
      '/opportunities/inbox-relay',
      '/opportunities/inbox-relay/complaints',
      '/opportunities/inbox-relay/competitors',
      '/opportunities/inbox-relay/plan'
    ])
  })

  it('keeps desktop and responsive viewports explicit', () => {
    expect(captureViewports).toEqual([
      { id: 'desktop-1280', width: 1280, height: 900 },
      { id: 'desktop-1024', width: 1024, height: 768 },
      { id: 'desktop-768', width: 768, height: 900 },
      { id: 'mobile-480', width: 480, height: 900 }
    ])
    expect(captureViewports.filter((viewport) => viewport.id.startsWith('desktop'))).toHaveLength(3)
  })
})
