import { describe, expect, it } from 'vitest'
import {
  agentAccessTokenCreateInputSchema,
  agentAccessTokenSchema,
  mcpJsonRpcRequestSchema,
  mcpToolCallInputSchema
} from './index'

describe('MCP and agent access contracts', () => {
  it('accepts bounded read-only token requests and JSON-RPC calls', () => {
    expect(
      agentAccessTokenCreateInputSchema.parse({
        label: 'Build agent',
        scopes: ['opportunities:read', 'plans:read'],
        expiresInDays: 30
      })
    ).toMatchObject({ label: 'Build agent', expiresInDays: 30 })
    expect(agentAccessTokenSchema.safeParse(`appsea_mcp_${'a'.repeat(48)}`).success).toBe(true)
    expect(
      mcpJsonRpcRequestSchema.parse({
        jsonrpc: '2.0',
        id: 'request-1',
        method: 'tools/list',
        params: {}
      }).method
    ).toBe('tools/list')
    expect(mcpToolCallInputSchema.parse({ name: 'appsea.search_opportunities' }).arguments).toEqual(
      {}
    )
  })

  it('rejects duplicate scopes, malformed tokens, and unknown JSON-RPC fields', () => {
    expect(
      agentAccessTokenCreateInputSchema.safeParse({
        label: 'Build agent',
        scopes: ['plans:read', 'plans:read'],
        expiresInDays: 30
      }).success
    ).toBe(false)
    expect(agentAccessTokenSchema.safeParse('appsea_mcp_short').success).toBe(false)
    expect(
      mcpJsonRpcRequestSchema.safeParse({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        unexpected: true
      }).success
    ).toBe(false)
  })
})
