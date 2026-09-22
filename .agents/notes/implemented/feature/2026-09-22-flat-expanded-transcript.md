# Agent Note: Flat Expanded transcript mode

Status: implemented

English | [中文](2026-09-22-flat-expanded-transcript.zh.md)

## Problem

0.1.7 folds a completed Turn behind a whole-Turn control and keeps every process group behind its own header in all three work-details modes. The person reading a long Session sees nested disclosures they did not ask for, and no setting removes them: `presentation-policy.ts` sets `foldCompletedTurns: true` for `compact`, `detailed`, and `expanded` alike, so choosing the most open mode still hides process rows behind a control.

## Decision

`expanded` becomes this branch's flat mode. Its policy sets `foldCompletedTurns: false`, and `ChatGroupSeat` groups by `stepGrouping` alone, so a mode without step grouping never renders a group header — for historical Turns as well as running ones. In `expanded` the whole-Turn control unmounts and every process row renders in place, which restores the Alpha.2 reading experience.

`compact` and `detailed` keep the shipped behavior: the whole-Turn control, group headers, and collapsed group bodies. The upstream specs that pinned `expanded`'s grouping and its paging anchors were narrowed to those two modes, and the policy, folding, and paged-visibility specs now assert the flat contract for `expanded`.

## Alternatives considered

**Add a fourth mode.** Rejected: the person asked for the mode they already choose, and a fourth row in Work details adds a setting nobody needs.

**Keep group headers but open them by default.** Rejected: the header rows are the clutter being removed, and the bodies render either way, so opening them by default changes nothing about the reading path.

## Consequences

A completed Turn in `expanded` has no fold to reveal hidden content, so the searchable-hidden reveal path no longer applies there; `compact` and `detailed` keep it. The mode renders every row uncapped, so a very long Session scrolls further than it does in the folding modes.

## Related

- [Local-exclusive DSH features and their upgrade treatment](../process/2026-09-16-local-exclusive-upgrade-treatment.md) — the inventory an upgrade consults before taking a released version of these files.
- [Web Turn process folding](../../archived/feature/2026-08-14-web-turn-process-folding.md) — the released folding design this mode declines.
