# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in
this repo's issue tracker (GitHub, `B0r1ng-del/ShPtol-Re-fork`).

All five already exist on the repo, created by this setup — no overrides, the canonical names are used as-is.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

`wontfix` predates this setup: it is GitHub's own default label on every new repo, so triage reuses it rather than
creating a duplicate.

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this
table.

## Wayfinder labels

`/wayfinder` uses its own set, also created by this setup:

| Label | Use |
| --- | --- |
| `wayfinder:map` | the map: one issue holding Notes / Decisions-so-far / Fog |
| `wayfinder:research` | a ticket that answers a question by reading |
| `wayfinder:prototype` | a ticket that answers a question by building a throwaway |
| `wayfinder:grilling` | a ticket that answers a question by interrogating the owner |
| `wayfinder:task` | a ticket that is already specified — just do it |

## Note on the repo

`gh` resolves this clone's repo to the **upstream** remote (`sganggs/Stronghold-Protocol`), not to the fork, so label
writes without `-R` fail with `HTTP 404`. This setup created the labels with
`gh label create -R B0r1ng-del/ShPtol-Re-fork`. See `issue-tracker.md` for the same warning applied to every `gh` call.
