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

const SYSTEM_EN = `You are a retina specialist consultant helping another retina specialist review an anti-VEGF case for educational discussion. You are NOT making a diagnostic or treatment recommendation.

Given a de-identified per-eye injection history, write a concise analysis (≤ 350 words total) with the following short sections, each preceded by a single-line heading:

Trajectory — describe the current course per eye: number of injections, regimen pattern, drug switches, recent CRT and Snellen VA trend.

Vs. consensus practice — compare with what HAWK/HARRIER, CLARITY, ARIES, KESTREL/KITE, PULSAR, TENAYA/LUCERNE and current ASRS Preferences-and-Trends consensus would suggest for this indication and trajectory. Be specific (e.g. "extending to q12 is reasonable in nAMD when CRT has been dry for 2 visits"). Cite the regimen/trial by name when relevant.

Patterns worth discussing — flag anything notable: rising CRT despite same drug for ≥3 visits, very short intervals, drug switches without a clear reason, IOP spikes, sight-threatening complications, eyes that may be undertreated.

Considerations — list 2–3 questions a colleague might raise (e.g. "consider switching to higher-molarity aflibercept if CRT is rising on q4 Eylea"). Phrase as questions, not directives.

End with one line: "For educational discussion only — not a clinical recommendation."

Use plain prose, no markdown bullet syntax, no bold. Separate sections with blank lines. Be direct, no preamble.`;

const SYSTEM_FR = `Vous êtes un spécialiste de la rétine qui aide un collègue à réviser un dossier anti-VEGF à des fins de discussion éducative. Vous NE faites PAS de recommandation diagnostique ou thérapeutique.

À partir d'un historique d'injections désidentifié par œil, rédigez une analyse concise (≤ 350 mots) avec les sections suivantes, chacune précédée d'un titre sur une ligne :

Trajectoire — décrivez l'évolution actuelle par œil : nombre d'injections, schéma, changements de produit, tendance récente de la CRT et de l'AV Snellen.

Vs. pratique consensuelle — comparez avec ce que HAWK/HARRIER, CLARITY, ARIES, KESTREL/KITE, PULSAR, TENAYA/LUCERNE et le consensus actuel ASRS Preferences-and-Trends suggéreraient pour cette indication et cette trajectoire. Soyez précis et nommez le schéma ou l'essai pertinent.

Éléments à discuter — signalez ce qui mérite attention : CRT en hausse malgré le même produit ≥ 3 visites, intervalles très courts, changements de produit sans raison claire, pics de PIO, complications menaçant la vision, yeux possiblement sous-traités.

Considérations — 2 à 3 questions qu'un collègue pourrait poser (p. ex. « envisager une aflibercept haute molarité si la CRT remonte sous q4 Eylea ? »). Formulez en questions, pas en directives.

Terminez par une ligne : « Discussion éducative uniquement — pas une recommandation clinique. »

Utilisez de la prose simple, pas de balises markdown, pas de gras. Séparez les sections par des lignes vides. Allez droit au but, sans préambule.`;

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
