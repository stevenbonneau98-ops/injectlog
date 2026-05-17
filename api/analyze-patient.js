// /api/analyze-patient — Anthropic Claude Opus 4.7 educational analysis.
//
// Receives a de-identified anti-VEGF history (no name, chart #, DOB, or
// free-text notes — the client strips those before sending) and asks the
// model to compare the trajectory with consensus practice. The output is
// explicitly framed as educational and NOT a clinical recommendation.
//
// Required env var on Vercel:
//   ANTHROPIC_API_KEY

export const config = { runtime: 'edge' };

const MODEL = 'claude-opus-4-7';
const ANTHROPIC_VERSION = '2023-06-01';

const SYSTEM_EN = `You are a retina specialist consultant helping another retina specialist scan an anti-VEGF case in <30 seconds. Educational only — NOT a clinical recommendation.

Output ONE block per active eye. Skip eyes with no injections. Use EXACTLY this format, no preamble, no closing summary:

OD — <indication> · <regimen> · n=<inj count>
• Trajectory: <one short line — CRT trend, VA trend, drug stability>
• Vs. consensus: <one short line — name the relevant trial/regimen, say if on-pattern or off>
• Flag: <one short line OR omit the bullet entirely if nothing notable>
• Consider: <one question, ≤15 words>

(blank line)

OS — <indication> · <regimen> · n=<inj count>
• Trajectory: ...
• Vs. consensus: ...
• Flag: ... (omit if nothing)
• Consider: ...

End with one line:
For educational discussion only — not a clinical recommendation.

Hard rules:
- Use "•" as the bullet character (not "-", not "*").
- Each bullet ≤ 18 words. Telegraphic style. No hedging.
- Name trials when relevant: HAWK/HARRIER, KESTREL/KITE, PULSAR, TENAYA/LUCERNE, ASRS PAT.
- "Flag" bullet is optional — omit it entirely if the eye is unremarkable. Never write "none" or "n/a".
- "Consider" is a question (ends with ?), not a directive.
- If both eyes are inactive or have no injections, output one line: "No active eyes with injection history."`;

const SYSTEM_FR = `Vous êtes un spécialiste de la rétine qui aide un collègue à survoler un dossier anti-VEGF en <30 secondes. Discussion éducative uniquement — PAS une recommandation clinique.

Produisez UN bloc par œil actif. Sautez les yeux sans injections. Utilisez EXACTEMENT ce format, sans préambule ni résumé final :

OD — <indication> · <schéma> · n=<nombre>
• Trajectoire : <une ligne brève — tendance CRT, tendance AV, stabilité du produit>
• Vs. consensus : <une ligne brève — nommez l'essai/schéma pertinent, dire si conforme ou non>
• Drapeau : <une ligne brève OU omettez complètement la puce si rien à signaler>
• À considérer : <une question, ≤15 mots>

(ligne vide)

OS — <indication> · <schéma> · n=<nombre>
• Trajectoire : ...
• Vs. consensus : ...
• Drapeau : ... (omettre si rien)
• À considérer : ...

Terminez par une ligne :
Discussion éducative uniquement — pas une recommandation clinique.

Règles strictes :
- Utilisez « • » comme puce (pas « - », pas « * »).
- Chaque puce ≤ 18 mots. Style télégraphique. Pas de prudence excessive.
- Citez les essais : HAWK/HARRIER, KESTREL/KITE, PULSAR, TENAYA/LUCERNE, ASRS PAT.
- La puce « Drapeau » est facultative — omettez-la si l'œil est sans particularité. N'écrivez jamais « aucun » ou « s/o ».
- « À considérer » est une question (finit par ?), pas une directive.
- Si les deux yeux sont inactifs ou sans injections, écrivez une ligne : « Aucun œil actif avec historique d'injections. »`;

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ error: 'invalid JSON' }, 400); }
  if (!body || !Array.isArray(body.eyes)) return json({ error: 'missing eyes' }, 400);

  // Reject if anything that looks like an identifier slipped through.
  // The client is supposed to strip these but we double-check here so
  // accidental misuse never reaches the model.
  const forbidden = ['name', 'patientName', 'patientNumber', 'mrn', 'chart', 'dob', 'birthdate', 'notes'];
  for (const k of forbidden) {
    if (k in body) return json({ error: `payload must not contain '${k}'` }, 400);
  }
  for (const e of body.eyes) {
    for (const k of forbidden) {
      if (k in e) return json({ error: `eye payload must not contain '${k}'` }, 400);
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY not configured' }, 500);

  const lang = body.lang === 'fr' ? 'fr' : 'en';
  const system = lang === 'fr' ? SYSTEM_FR : SYSTEM_EN;
  const userText = `De-identified patient data follows.

Age (years): ${body.ageYears ?? 'unknown'}
Known drug allergies / intolerances: ${(body.allergies || []).join(', ') || 'none'}

Eyes:
${JSON.stringify(body.eyes, null, 2)}`;

  const payload = JSON.stringify({
    model: MODEL,
    max_tokens: 1500,
    system,
    messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
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
    // Friendlier message for the most common deploy mishap: the API key
    // is missing or wrong on Vercel. We surface what to do in the UI.
    if (claudeRes.status === 401 || claudeRes.status === 403) {
      return json({
        error: 'auth',
        message: 'Anthropic API key invalid or missing. Set ANTHROPIC_API_KEY in Vercel → Project → Settings → Environment Variables, then redeploy.',
        detail: text.slice(0, 200),
      }, 502);
    }
    return json({ error: `Anthropic ${claudeRes.status}: ${text.slice(0, 400)}` }, 502);
  }
  const data = await claudeRes.json().catch(() => ({}));
  const text = (data?.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  if (!text) return json({ error: 'empty response' }, 502);
  return json({ text }, 200);
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'content-type': 'application/json' },
  });
}
