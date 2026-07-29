export function localTemporalAddressFromEnv(environment: NodeJS.ProcessEnv = process.env): string {
  if (environment.NODE_ENV === 'production') {
    throw new Error('Production Temporal TLS and authorization are not configured')
  }
  const address = environment.APPSEA_TEMPORAL_ADDRESS ?? '127.0.0.1:7233'
  const [host, port] = address.split(':')
  const numericPort = Number(port)
  if (
    !['127.0.0.1', 'localhost'].includes(host ?? '') ||
    !/^\d{1,5}$/.test(port ?? '') ||
    !Number.isInteger(numericPort) ||
    numericPort < 1 ||
    numericPort > 65_535
  ) {
    throw new Error('Local Temporal must use a loopback host and explicit port')
  }
  return address
}
