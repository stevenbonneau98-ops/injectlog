# InjectLog

Anti-VEGF injection tracker for general ophthalmologists and retina specialists.
A privacy-first PWA built on the same architecture as LidCatch — all patient
data lives in the device's IndexedDB; nothing is uploaded unless the surgeon
explicitly triggers an AI feature.

## Drugs supported (v0.1)

| Display name | Scientific name | Brand | Half-life (vit.) | Typical loading |
|---|---|---|---|---|
| Avastin | bevacizumab | (off-label) | ~5 days | none / load + q4 |
| Lucentis | ranibizumab | Lucentis | ~9 days | 3× q4 → TAE / PRN |
| Eylea (2 mg) | aflibercept | Eylea | ~11 days | 3× q4 → q8 fixed or TAE |
| Eylea HD (8 mg) | aflibercept-HD | Eylea HD | longer | 3× q4 → q8–q16 TAE |
| Vabysmo | faricimab-svoa | Vabysmo | longer (dual Ang2/VEGF) | 4× q4 → q8/q12/q16 TAE |

## Core features (v0.1)

1. **Patient list** — initials, name (Last, First), chart #, DOB, eye(s)
   being treated, primary diagnosis per eye.
2. **Per-eye treatment plan** — drug, indication, regimen (Loading / TAE /
   Fixed / PRN), current interval (weeks), next-due date.
3. **Injection log per eye** — date, drug, dose, lot # (optional), anatomy
   notes, IOP pre/post, complications.
4. **Calendar view** — month + week grid of every upcoming injection,
   colour-coded by drug. Tap a day to see the list of patients due.
5. **Notifications / badges** — home-screen badge count of "due today" +
   "late" patients. Optional in-app banner.
6. **Per-patient stats** — total injections per eye, drug-switch timeline,
   VA / CRT trend (sparkline), mean interval, longest dry interval, time
   on each drug.
7. **Population stats** — drug share, indication share, mean injections
   per patient per year, % patients on TAE / fixed / PRN, complications
   per 1 000 injections.

## Anti-VEGF indications (v0.1)

- nAMD (neovascular AMD)
- DME (diabetic macular oedema)
- BRVO macular oedema
- CRVO macular oedema
- mCNV (myopic CNV)
- PCV (polypoidal choroidal vasculopathy)
- ROP (ranibizumab)
- Other (free text)

## Regimen library

- **Loading dose** — N consecutive monthly injections; tracker shows 1/3,
  2/3, 3/3.
- **Treat-and-Extend (TAE)** — start at q4, extend by 2 weeks if dry,
  shorten by 1–2 weeks if wet. Per-eye current interval is the source of
  truth for next-due.
- **Fixed (e.g. q8, q12)** — interval doesn't change unless the surgeon
  edits it.
- **PRN** — no scheduled next visit; the OCT visit drives the call.

## "Due / late" logic

- For each eye on active treatment, `nextDueDate = lastInjectionDate +
  intervalWeeks * 7`.
- Status:
  - `Future` — next-due > today + 3 days
  - `Due` — next-due within ±3 days of today
  - `Late` — next-due < today − 3 days
- Badge count = sum of patients with at least one eye in Due / Late.

## Per-patient ideas to consider (v0.2+)

- **Vision tracking** — record best-corrected VA at every visit (Snellen
  fraction OR ETDRS letter score). Sparkline + ETDRS line gain/loss vs
  baseline.
- **OCT CRT** — central retinal thickness in µm per visit. Trend line +
  delta from last visit.
- **OCT screenshot** — attach a clinical photo of the OCT scan to each
  visit (stored as a Blob like LidCatch's clinical photos).
- **Adverse-event log** — endophthalmitis, IOP spike, RPE tear, vitreous
  haemorrhage, traumatic cataract, stroke (anti-VEGF systemic concern).
- **Drug switches** — timeline showing when the surgeon changed agents
  and why (free text / reason chips).
- **Compliance** — flag patients who no-show ≥ 2 scheduled injections.

## Population stats (v0.2+)

- Drug share over time (stacked area).
- Mean injections per patient per year, by indication.
- Mean dry interval reached on TAE, by drug.
- % patients gaining ≥ 5 / ≥ 10 / ≥ 15 ETDRS letters at 1 y.
- Endophthalmitis rate per 1 000 injections.
- "Surgeon score" — same-day same-eye contralateral injection count, useful
  for billing / capacity planning.

## Privacy / storage

- **Local-only** by default. IndexedDB for patients, eyes, injections, OCT
  screenshots. localStorage for settings.
- **Encrypted backups** with a user-chosen passphrase (AES-256-GCM /
  PBKDF2 250 k iterations) — same scheme as LidCatch.
- **Colleague sync** (later) — same encrypted-file-over-AirDrop model.
- **AI features (opt-in)** — only thing that touches the network. Two
  ideas for v0.2+:
  - **Schedule scan**: take a photo of today's injection schedule, AI
    reads names/initials/chart # only (no diagnoses) — same approach as
    LidCatch's list import.
  - **OCT extraction**: a photo of an OCT report → AI extracts CRT in µm.
    Redaction step before any image leaves the device.

## Files (planned)

- `index.html` — entire app (UI + state + IndexedDB layer + Mediapipe-free)
- `manifest.json` — PWA manifest (Add to Home Screen)
- `sw.js` — service worker (offline shell)
- `vercel.json` — deploy config
- `api/scan-list.js` — Haiku endpoint for schedule import (later)
- `api/scan-oct.js` — Haiku endpoint for OCT extraction (later)
- `injectlog_icon.png` — home-screen icon

## Open questions for the surgeon

See bottom of this README — answered before v0.1 build starts.
