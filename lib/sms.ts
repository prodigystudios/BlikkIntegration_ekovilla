export type SendSmsArgs = {
  to: string;
  body: string;
  messagingServiceSid?: string;
  statusCallback?: string;
};

export type SendSmsResult = {
  sid: string;
  status: string | null;
  to: string;
};

function env(name: string): string {
  return (process.env[name] || '').trim();
}

export async function sendSms(args: SendSmsArgs): Promise<SendSmsResult> {
  const accountSid = env('TWILIO_ACCOUNT_SID');
  const authToken = env('TWILIO_AUTH_TOKEN');
  const messagingServiceSid = (args.messagingServiceSid || env('TWILIO_MESSAGING_SERVICE_SID')).trim();
  const statusCallback = (args.statusCallback || env('TWILIO_STATUS_CALLBACK_URL')).trim();

  if (!accountSid || !authToken || !messagingServiceSid) {
    throw new Error('SMS not configured (need TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_MESSAGING_SERVICE_SID)');
  }

  const twilioModule = await import('twilio');
  const twilio = twilioModule.default;
  const client = twilio(accountSid, authToken);

  const message = await client.messages.create({
    to: args.to,
    body: args.body,
    messagingServiceSid,
    statusCallback: statusCallback || undefined,
  });

  return {
    sid: message.sid,
    status: message.status || null,
    to: message.to || args.to,
  };
}
