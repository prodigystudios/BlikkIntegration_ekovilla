type SendEmailArgs = {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;
  replyTo?: string | string[];
};

function env(name: string): string {
  return (process.env[name] || '').trim();
}

export async function sendEmail(args: SendEmailArgs): Promise<void> {
  const apiKey = env('RESEND_API_KEY');
  const from = (args.from || env('MAIL_FROM')).trim();

  if (!apiKey || !from) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Email not configured (need RESEND_API_KEY and MAIL_FROM)');
    }
    console.warn('[email] Skipping send (missing RESEND_API_KEY/MAIL_FROM)', {
      hasKey: !!apiKey,
      from,
      to: args.to,
      subject: args.subject,
    });
    return;
  }

  const { Resend } = await import('resend');
  const resend = new Resend(apiKey);

  const to = Array.isArray(args.to) ? args.to : [args.to];
  const replyTo = args.replyTo
    ? (Array.isArray(args.replyTo) ? args.replyTo : [args.replyTo]).map((item) => String(item).trim()).filter(Boolean)
    : undefined;
  const html = args.html || undefined;
  const text = typeof args.text === 'string' ? args.text : '';

  const res = await resend.emails.send({
    from,
    to,
    replyTo,
    subject: args.subject,
    html,
    text,
  });

  if ((res as any)?.error) {
    const msg = (res as any).error?.message || 'Unknown email error';
    throw new Error(msg);
  }
}
