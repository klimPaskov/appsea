import {
  operationalAlertOutboxStatusInputSchema,
  operationalAlertOutboxStatusLimits,
  type OperationalAlertOutboxStatusInput,
  type OperationalAlertOutboxStatusResult
} from '@appsea/contracts'

export const operationalAlertStatusTaskQueue = 'appsea-operational-alert-status-v1'
export const operationalAlertStatusFailureCode = 'APPSEA_ALERT_STATUS_FAILED'

export function operationalAlertStatusEnabled(
  environment: NodeJS.ProcessEnv = process.env
): boolean {
  return (
    ['development', 'test'].includes(environment.NODE_ENV ?? '') ||
    (environment.NODE_ENV === 'production' &&
      environment.APPSEA_OPERATIONAL_ALERT_STATUS_ENABLED === 'true')
  )
}

export function operationalAlertStatusInputFromEnv(
  environment: NodeJS.ProcessEnv = process.env
): OperationalAlertOutboxStatusInput {
  const limit = Number(
    environment.APPSEA_OPERATIONAL_ALERT_STATUS_LIMIT ??
      String(operationalAlertOutboxStatusLimits.defaultLimit)
  )
  const alertAfterSeconds = Number(
    environment.APPSEA_OPERATIONAL_ALERT_STATUS_ALERT_AFTER_SECONDS ??
      String(operationalAlertOutboxStatusLimits.defaultAlertAfterSeconds)
  )
  return operationalAlertOutboxStatusInputSchema.parse({ limit, alertAfterSeconds })
}

export function operationalAlertStatusEvent(
  result: OperationalAlertOutboxStatusResult
):
  | 'operational_alert_outbox_clear'
  | 'operational_alert_outbox_alert'
  | 'operational_alert_outbox_incomplete' {
  if (result.state === 'alert') return 'operational_alert_outbox_alert'
  if (result.state === 'incomplete') return 'operational_alert_outbox_incomplete'
  return 'operational_alert_outbox_clear'
}
