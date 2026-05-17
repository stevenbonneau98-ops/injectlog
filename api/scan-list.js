// /api/scan-list — Anthropic Claude Haiku vision endpoint. Reads a phone
// photo of a daily injection schedule and returns a list of patient
// identifiers (name, initials, chart number) ONLY. The prompt explicitly
// forbids extracting diagnoses, drugs, indications, or any clinical
// content so identifiers leaving the device match what's on a chart
// sticker.

export const config = { runtime: 'edge' };

const MODEL = 'claude-haiku-4-5';
const ANTHROPIC_VERSION = '2023-06-01';

const PROMPT = `You are reading a daily anti-VEGF injection schedule, OR list, or appointment sheet.

For each patient that appears in the list, return ONLY:
- name: the patient's name as written. If "Last, First" or "Last First" is shown, return it as "Last, First".
- initials: 2-4 uppercase letters. If shown explicitly, use them; otherwise derive from the first letter of each name part.
- patientNumber: the chart number / MRN / file number, if visible. Plain string. Empty string if not visible.

CRITICAL — do NOT extract or return ANY of the following even if they appear:
- diagnoses, indications, clinical findings
- drug names, dosages
- injection eye (OD/OS), interval
- ages, dates of birth
- room numbers, surgeon names, anesthesia info, times
- any free-text notes

Return ONLY: {"patients":[{"name":"...","initials":"...","patientNumber":"..."}, ...]}. No other keys, no code fences, no commentary.

If the image is empty, blurry, or contains no patient list, return {"patients":[]}.`;

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ error: 'invalid JSON' }, 400); }
  const { image } = body || {};
  if (!image || typeof image !== 'string') return json({ error: 'missing image' }, 400);
  const m = image.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/);
  if (!m) return json({ error: 'invalid data URL' }, 400);
  const [, mediaType, b64] = m;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY not configured' }, 500);

  const payload = JSON.stringify({
    model: MODEL,
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
        { type: 'text', text: PROMPT },
      ],
    }],
  });

  const RETRY_ON = new Set([429, 503, 529]);
  let claudeRes;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt - 1)));
    try {
      claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: payload,
      });
    } catch (e) {
      if (attempt === 3) return json({ error: 'network error', details: String(e) }, 502);
      continue;
    }
    if (claudeRes.ok || !RETRY_ON.has(claudeRes.status)) break;
  }

  if (!claudeRes.ok) {
    const text = await claudeRes.text().catch(() => '');
    return json({ error: `Anthropic ${claudeRes.status}: ${text.slice(0, 400)}` }, 502);
  }
  const data = await claudeRes.json().catch(() => ({}));
  const text = data?.content?.[0]?.text || '';
  const jm = text.match(/\{[\s\S]*\}/);
  let parsed = { patients: [] };
  if (jm) {
    try {
      const obj = JSON.parse(jm[0]);
      const list = Array.isArray(obj.patients) ? obj.patients : [];
      parsed.patients = list.map(r => ({
        name: String(r?.name || '').trim().slice(0, 120),
        initials: String(r?.initials || '').trim().toUpperCase().slice(0, 6),
        patientNumber: String(r?.patientNumber || '').trim().slice(0, 40),
      })).filter(r => r.name || r.initials || r.patientNumber);
    } catch {}
  }
  return json(parsed, 200);
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
