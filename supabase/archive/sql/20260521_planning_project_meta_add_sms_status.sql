ALTER TABLE public.planning_project_meta
  ADD COLUMN IF NOT EXISTS sms_notified boolean,
  ADD COLUMN IF NOT EXISTS sms_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS sms_notified_by text,
  ADD COLUMN IF NOT EXISTS sms_recipient_phone text,
  ADD COLUMN IF NOT EXISTS sms_provider_message_id text,
  ADD COLUMN IF NOT EXISTS sms_delivery_status text,
  ADD COLUMN IF NOT EXISTS sms_last_error text;

CREATE INDEX IF NOT EXISTS idx_planning_project_meta_sms_notified
  ON public.planning_project_meta (sms_notified);

CREATE INDEX IF NOT EXISTS idx_planning_project_meta_sms_provider_message_id
  ON public.planning_project_meta (sms_provider_message_id);

COMMENT ON COLUMN public.planning_project_meta.sms_notified IS 'Whether an SMS notification was accepted by Twilio';
COMMENT ON COLUMN public.planning_project_meta.sms_notified_at IS 'Timestamp when the latest SMS notification was accepted';
COMMENT ON COLUMN public.planning_project_meta.sms_notified_by IS 'User who triggered the latest SMS notification';
COMMENT ON COLUMN public.planning_project_meta.sms_recipient_phone IS 'Recipient phone number used for the latest SMS notification';
COMMENT ON COLUMN public.planning_project_meta.sms_provider_message_id IS 'Twilio MessageSid for the latest SMS notification';
COMMENT ON COLUMN public.planning_project_meta.sms_delivery_status IS 'Latest Twilio delivery status for the latest SMS notification';
COMMENT ON COLUMN public.planning_project_meta.sms_last_error IS 'Latest Twilio error code or message for the latest SMS notification';
