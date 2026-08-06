import { describe, expect, it } from 'vitest'
import {
  captureRoutes,
  captureViewports,
  privateCaptureRoutes,
  summarizeUiAudit
} from './capture_ui_reference.mjs'

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

  it('keeps authenticated capture routes private and identifier-bound', () => {
    expect(privateCaptureRoutes.map((route) => route.id)).toEqual([
      'workspace-sources',
      'workspace-campaigns',
      'workspace-imports',
      'workspace-seed-reviews',
      'workspace-members',
      'workspace-agent-access',
      'workspace-activity',
      'workspace-usage',
      'account-security'
    ])
    expect(privateCaptureRoutes[0].path('workspace%3Aexample')).toBe(
      '/workspace/workspace%3Aexample/sources'
    )
    expect(privateCaptureRoutes[8].path('ignored')).toBe('/account/security')
  })

  it('fails closed on runtime errors, missing content, and horizontal overflow', () => {
    expect(
      summarizeUiAudit({
        title: 'AppSea',
        innerWidth: 480,
        scrollWidth: 480,
        hasMain: true,
        hasRuntimeError: false
      })
    ).toEqual({
      status: 'ok',
      failures: [],
      hasRuntimeError: false,
      hasMain: true,
      innerWidth: 480,
      scrollWidth: 480
    })

    expect(
      summarizeUiAudit({
        title: 'AppSea',
        innerWidth: 480,
        scrollWidth: 512,
        hasMain: true,
        hasRuntimeError: true
      })
    ).toMatchObject({
      status: 'failed',
      failures: ['runtime-error', 'horizontal-overflow']
    })
    expect(
      summarizeUiAudit({ title: '', innerWidth: 1280, scrollWidth: 1280, hasMain: false })
    ).toMatchObject({ status: 'failed', failures: ['missing-main', 'missing-title'] })
  })
})
