// /api/digest — send a daily digest email via Resend.
//
// Triggered either by:
//   a) the client (POST { to, subject, body }) when the surgeon taps
//      "Email today's list" or the app autopilots after a daily-trigger
//      window, or
//   b) a Vercel cron job hitting /api/digest with a stored payload (TODO
//      v0.3 — requires a small server-side store of the last snapshot).
//
// Resend is the simplest transactional email provider; swap to Postmark
// or AWS SES by editing only the fetch URL and headers.
//
// Required env vars on Vercel:
//   RESEND_API_KEY        — Resend API key
//   DIGEST_FROM_ADDRESS   — verified sending address (e.g. "InjectLog
//                            <digest@yourdomain.com>")

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ error: 'invalid JSON' }, 400); }
  const { to, subject, body: text } = body || {};
  if (!to || !subject || !text) return json({ error: 'missing to/subject/body' }, 400);
  // Soft client-side validation against accidental open relay.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return json({ error: 'bad email' }, 400);
  if (text.length > 20000) return json({ error: 'body too long' }, 400);

  const apiKey = process.env.RESEND_API_KEY;
  const from   = process.env.DIGEST_FROM_ADDRESS;
  if (!apiKey || !from) return json({ error: 'RESEND_API_KEY / DIGEST_FROM_ADDRESS not configured' }, 500);

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      text,
    }),
  });
  const data = await resendRes.json().catch(() => ({}));
  if (!resendRes.ok) {
    return json({ error: data?.message || `Resend ${resendRes.status}` }, 502);
  }
  return json({ ok: true, id: data?.id }, 200);
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'content-type': 'application/json' },
  });
}
