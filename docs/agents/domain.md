# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Layout: single-context

**This repo is single-context**: one shared `GLOSSARY.md` at the repo root, and architecture decisions in `docs/adr/`.
There is no `GLOSSARY-MAP.md` and no per-subproject glossary — the project is one Node server plus one browser client and
one deterministic sim shared by both, not a multi-package monorepo (`package.json` has no `workspaces`, there is no
`pnpm-workspace.yaml`, there is no populated `packages/*`).

Neither file exists yet, and that is the intended starting state: they are created lazily by `/domain-modeling` the first
time a term or a decision is actually resolved. Do not create them upfront just to fill this layout in.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root — the single domain glossary for this context.
- **`docs/adr/`** — read the ADRs that touch the area you're about to work in.

If either doesn't exist, **proceed silently**. Don't flag its absence; don't suggest creating it upfront. The
`/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when
terms or decisions actually get resolved.

## File structure

```
/
├── GLOSSARY.md          ← created lazily, on the first real term
├── docs/adr/            ← created lazily, on the first real decision
│   ├── 0001-….md
│   └── 0002-….md
├── docs/                ← the reference docs this repo already has (ARCHITECTURE / DESIGN / FORK / …)
└── server/ · public/ · shared/ · tools/ · test/
```

The repo's own reference docs are **not** ADRs and are not replaced by them:

| Doc | Role |
| --- | --- |
| `docs/ARCHITECTURE.md` | the code map — where things live, data flow, import boundaries |
| `docs/DESIGN.md` | the index of the rules: current rules in `docs/design/`, per-release revisions in `docs/history/` |
| `docs/FORK.md` | what this fork adds over upstream, item by item, with the owner's rulings |
| `docs/SIM.md` / `docs/META.md` / `docs/DATA.md` / `docs/I18N.md` | the reference for the part you touch |

`docs/adr/` is for **decisions with a date and an alternative that lost**, not for describing how the code works today.
When a rule is settled by the owner, it belongs in `docs/design/` (and `docs/FORK.md` if it is fork-only); when a choice
was made *between options*, it belongs in an ADR.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term
as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

Two vocabularies already exist in this repo and should be respected even before `GLOSSARY.md` is written:

- **The owner's Chinese names** for the game's own concepts: 扩展模拟 / 同盟模拟 / 独立模拟, 盟约, 机变, 干员调配,
  房间配置, 对局选项, 自选编队, 一键满配, 交流, 弹幕. These are what the UI says; the code's English identifiers
  (`ultimate`, `bond`, `spDraft`, `loadout`, `hostConfig`) are the same things.
- **The repo's own English vocabulary**: a *content pack* (`packId`, `PACK_KEYS`) is add-on data, a *record* is one entry
  of a generated `data/*.json`, a *golden* is a pinned battle result under `test/golden/`.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't
use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_
