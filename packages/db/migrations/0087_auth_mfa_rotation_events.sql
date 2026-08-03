-- Record bounded, identifier-only audit events when an operator rewraps an
-- MFA secret from the configured previous key. The event carries no key
-- material, ciphertext, code, or account profile data.
ALTER TABLE appsea.auth_mfa_events
  DROP CONSTRAINT IF EXISTS auth_mfa_events_event_type_check;

ALTER TABLE appsea.auth_mfa_events
  ADD CONSTRAINT auth_mfa_events_event_type_check
  CHECK (
    event_type IN (
      'enrollment_started',
      'enrollment_completed',
      'disabled',
      'challenge_created',
      'challenge_succeeded',
      'challenge_failed',
      'recovery_code_used',
      'key_rotation_rewrapped'
    )
  );
