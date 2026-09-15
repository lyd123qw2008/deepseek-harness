# Agent Note: Web diff card renders through a scroll viewport

Status: implemented

English | [中文](2026-09-15-web-diff-card-scroll-viewport.zh.md)

## Problem

The Web diff card was first built to show whole old and new sides under a head/tail height cap with an expand button ([Web diff card](../../archived/feature/2026-07-30-web-diff-card.md)). That design spent the cap on unchanged text, so a small change inside a large fragment pushed the changed lines out of the collapsed view, and the expand control sat between the head and tail slices of one change.

This branch replaced that presentation with a client-derived scroll viewport. The upstream release then landed an independent contextual-diff implementation (`structuredPatch` with three context lines per side, folding, and a bounded edit-distance search) and rewrote `diff-block.client.spec.tsx`'s `DiffBlock local changes` block to specify it. A code upgrade carries reviewed local files forward while taking released files wholesale, so the released test block arrived while `DiffBlock.tsx` and `DiffBlock.module.css` stayed local. The suite then failed four assertions against an implementation that never had that design, and the only two local test files that pin the viewport were the survivors, which left the contract for this surface split across two designs.

## Decision

The card renders every row of a hunk into a vertically scrolling body whose height is capped at `DEFAULT_DIFF_MAX_LINES` (10) content lines by `maxHeight`, with `maxLines: Infinity` disabling the cap. There is no expand control and no fold range: a reader reaches the rest of the change through the body's own scrollbar, so a change can never be hidden behind a control and the changed rows stay in place.

Within each hunk the browser repeats the line comparison with the maintained `diff` library rather than consuming row markers, because the `FileDiff` contract carries before/after text instead of a marked patch and never carries change statistics. Every unchanged segment between changes contributes exactly one neutral context row. That one-row rule is what keeps a long unchanged stretch from crowding out the change, and it is the reason the recorded remote-end behavior of three context lines per side does not apply here.

A one-line replacement in a hunk that stores `oldStart`/`newStart` renders both sides with 1-based line numbers and word-level `<mark>` segments inside the changed line; leading indentation stays outside the highlight because the line-level gutter already marks the change. A multi-line replacement stays at line granularity. The optional starts come from the host's applied hunks, so call-time diffs and older metadata render without the gutter, which is the intended fallback rather than an error.

The changed-line totals the collapsed chat row prints and the rows the expanded card draws both come from the same line comparison over the same hunk, so the compact row and the full card can never report different numbers for one change. The counts are row-based: a shared line that a hunk carries on both sides is counted once per side it appears on, which is self-consistent with the rows the card draws but is not git's hunk-header convention. This stays Client presentation under the [Client-derived tool presentation decision](../architecture/2026-08-23-client-derived-tool-presentation.md): the host `FileDiff` contract, the persisted result metadata, and the public component props are unchanged, so replay stays safe and no wire format moves.

This branch owns the diff-card source deliberately. An upgrade keeps `packages/client/ui-primitives/src/DiffBlock.tsx`, `packages/client/ui-primitives/src/DiffBlock.module.css`, `packages/client/ui-tool/src/client/tool/models/diff-card-model.ts`, and `packages/client/ui-primitives/tests/diff-block.client.spec.tsx` on the local side and drops the released contextual-diff test block instead of re-deriving this surface from it. The upstream design is what the change declined, not an unapplied improvement.

## Alternatives considered

**Head/tail cap with an expand control.** The [original card design](../../archived/feature/2026-07-30-web-diff-card.md). Rejected after use: it trades a control and a hidden middle for the same screen area that a scroll viewport spends showing real change rows, and it drops changed content in exactly the case a reader opens a diff to inspect.

**Three neutral context lines per side with distant changes split into separate hunks.** The upstream design. Rejected: three lines per side reproduces unchanged text into the card and hides the surrounding change rows below the fold in a short body, and the per-side cost grows with the number of hunks. One line per unchanged segment keeps the change adjacent to its context without spending rows on repetition.

**Adopt the upstream bounded edit-distance search.** Rejected: the bound exists so an unbounded comparison cannot stall a collapsed summary, and it falls back to a coarse whole-fragment replacement above the limit. Real usage does not reach the size that matters, and the fallback would regress this viewport by handing the body a whole-fragment row list. See the Measurement section.

**Keep the released test block and adapt the implementation to it.** Rejected: the block specifies the folding design this note declines, so satisfying it would mean rebuilding the surface that was deliberately replaced rather than keeping the local one.

## Measurement

A local Node probe replicated the component's per-hunk derivation over fragments whose size matches what the card can actually be handed. Inputs and results on the development machine:

| Input | One derivation |
| --- | --- |
| Complete replacement, 10,000 lines | 18.1 s |
| Alternating repeated lines, 10,000 lines | 10.3 s |
| `replace_all`, 1,500 replacements | 428 ms |
| Sparse change, 100 of 10,000 lines | 9.4 ms |

A scan of 339 released `session.v3.jsonl.zstd` logs (542,752 Zstandard frames, 18,808 `edit` calls) measured every edit argument fragment. The largest fragment ever recorded is 316 lines; 18,474 calls are 1–50 lines, 283 are 51–200 lines, and two are 201–316 lines. No fragment approaches the size at which an unbounded comparison is slow, so the bound buys nothing for this workload while its coarse fallback would cost the viewport its detail.

## Testing

`packages/client/ui-primitives/tests/diff-block.client.spec.tsx` pins the structure arms (create, edit, a same-file `⋯` gap versus a new path header, the empty-diffs null render, the line-terminator rule, a full deletion) and a `DiffBlock viewport and context preview` block that pins this decision: the capped body's `max-height`, one context line per unchanged segment, every changed row staying reachable when the viewport is short, a separated second hunk's own context row, a multi-line replacement kept together, and the uncapped `Infinity` body. `packages/client/ui-tool/tests/diff-card.client.spec.tsx` pins the derivation at both render sites. Per-file coverage stays at the package's required level.

## Consequences

The card needs no expand state, so a diff has no interactive surface beyond copy. Reaching a distant change costs a scroll rather than a click, which is a deliberate trade for never hiding a change. The gutter and inline highlights exist only for hunks that carry `oldStart`/`newStart`, so a call-time diff renders plain; that asymmetry is visible but bounded. Because the counts are row-based, a hunk that carries a shared line on both sides reports that line on both sides, which differs from git's hunk-header numbers outside a `replace_all` boundary; changing that would require the host to carry change statistics, and it is not required to keep the compact row and the card consistent. Every future release that rewrites the contextual-diff test block reintroduces the split this note resolves, so the file ownership above is a standing rule for upgrades, not a one-time cleanup.

## Related

- [Web diff card](../../archived/feature/2026-07-30-web-diff-card.md) — the original cap-and-expand design this presentation replaces; its deferred line-number-gutter alternative is what this card now ships.
- [Web diff cards compare contextual content](2026-09-14-web-diff-context.md) — the upstream contextual-diff decision; its bounded comparison and coarse fallback are the alternatives declined above.
- [Client-derived tool presentation](../architecture/2026-08-23-client-derived-tool-presentation.md) — the ownership boundary this card stays inside.
