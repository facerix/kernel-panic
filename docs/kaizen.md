## Kaizen — Recorded Problems & Deferred Fixes

> 改善 — *the standard we walk by is the standard we accept.*

Living register of issues, design TODOs, and clarifications surfaced during development but intentionally not acted on in the current scope. Each item carries a status marker:

- **▶ Phase 2 candidate** — real design TODO; decide in Phase 2 planning.
- **◇ Monitored** — still applies; no action needed at current scale, but each entry carries a revisit trigger.
- **✓ Closed** — resolved by a later milestone; kept for history so the audit trail survives `git log`.

When an item lands, gets reclassified, or develops new context, edit it in place. Items that turn out to be design clarifications rather than defects should be moved into the relevant module's docstring and removed from this register.

---

## ▶ Phase 2 candidates

- **Melee always hits.** Deterministic in V1 by design; will get parry/dodge math when archetype kits expand. `MELEE_DAMAGE` is the one knob today.
- **Corpse positions aren't memorised.** Live and dead entities follow the same "we don't track where things were" rule — duck out of LOS and the corpse vanishes from memory until you can see the tile again. Logically a corpse doesn't move, so memorising them would be more honest. Cheap to add (a `seenCorpses` map on `VisionField` + a memory-mode branch in `frame.js`); revisit when telemetry or quest mechanics need the data.
- **NEUTRAL faction is shootable by anyone.** `canFireRanged` only blocks same-faction targets — civilians can be hit by player or corp shots. Intentional today (narrative consequences); revisit when noise/Vouch lands and we have UI to express the cost. Noted in `Combat.js`.

## ◇ Monitored

- **Diagonal movement cost equals orthogonal.** Drone AI didn't expose obvious cheese in M5 (path lengths feel right), but √2 rounding will probably go in alongside Razor's Slide if positional play gets tighter.
- **`World.entityAt` is O(n) linear scan.** Acceptable for V1; revisit if entity count crosses ~hundreds. M5 hits it from both `findPath` (per neighbour) and `acquireTarget`; M8 still sits at ~5 entities per scene.
- **CRT vignette uses canvas dimensions directly.** Will look off if the canvas is non-uniformly CSS-stretched. Currently scaled uniformly so it's fine.
- **Renderer redraws the whole canvas per turn.** No dirty-cell tracking. Reconsider only if/when we animate moves.
- **Harness ranged targeting uses first-hostile-along-Bresenham (game shell is unaffected).** Fine for a single-drone debug map; a real reticle / target-cycle UI would land alongside any future targeting-UX milestone. Already shares `withinRange` + `blockerKeys` with Combat so the harness can no longer offer targets Combat would reject. The M8 game shell at `/index.html` routes through `applyIntent` and doesn't hit this code path.
- **Vision recomputed every entity move.** Cheap at V1 grid sizes (~24×16) but it's an O(R²·R) per recompute, and M5 triggers it on *any* `entity:moved` so a multi-drone scene compounds the cost. Revisit if maps grow past ~128² or sight range past 16 — shadowcasting would be the swap.
- **Per-input aim mode (M7) drift.** `KeyboardController` and `<touch-pad>` each own their own `MODE` field, so on mixed-input desktop testing the modes can drift: keyboard `f` then touch direction emits `move` (touch never entered FIRE_AIM); touch `FIRE` then keyboard direction does the same. **Cancel is patched** — the harness's `cancel` case calls `resetInputModes()` so an Esc/CANCEL from either side clears both. The general drift case (aim from one side, direction from the other) is deferred. Two future paths: (a) cross-sync on every mode-change with a re-entrance guard, or (b) lift mode to a single harness-owned field both controllers consult. Doesn't bite on touch-only or keyboard-only devices, which is the realistic shipping surface.
- **M8 grid serialisation is plain `number[]`.** Snapshot grids carry a JS array of u8 bytes — ~3× larger on disk than base64, but trivially portable across `node --test` and the browser without a `btoa`/`Buffer` shim. A 24×16 grid is 384 bytes either way; revisit if maps grow past 64×64 or save records start brushing localStorage's ~5 MB ceiling. The encoding choice is local to `src/game/persistence.js` and `Run.snapshot()`.
- **Drone fallback anchors have no patrol path.** `buildMap` falls back to picking arbitrary FLOOR tiles for drone spawns when the stamped prefabs don't declare enough drone anchors (e.g. a map dominated by `hallway` prefabs). Fallback drones get a single-tile "stand still" waypoint, so they patrol in place. This is correct for M8 but deflates the gameplay variety on those seeds — the long-term fix is either a richer prefab set with anchors on every prefab, or a procgen-side patrol synthesiser.
- **M8 corridor carving overwrites WALL only — but cover that lies on the L-corridor stays cover.** That's deliberate (a cover-blocked corridor is a tactical pinch) but it can produce odd "chokepoints" where a corridor enters a prefab through a cover tile. Cosmetically fine; revisit if connectivity tests start producing rooms with awkward L-shaped cover walls. Logged under the procgen-tuning bucket alongside the drone-anchor item above.
- **`Run.id` collision risk.** `Run.makeRunId(seed)` concatenates `seed` and `Date.now()` for a non-cryptographic id; two runs started on the same millisecond with the same seed would collide. Vanishingly unlikely in practice, but if a future automated playthrough harness ever spins many runs quickly, switch to `crypto.randomUUID()`. Logged in `Run.js`.

## ✓ Closed

- ~~**Vault doesn't go through `World.moveEntity`.**~~ Closed in M6 — `Merc.vault` now emits `entity:moved` directly so vision/AI listeners see the post-vault state without the harness calling `recomputeVision()` inline.
- ~~**Vault-while-firing combo not implemented.**~~ Closed in v0.1.0 — `applyIntent.doVault` resolves a free shot (normal hit/cover math, no extra AP) in the vault direction from the landing position after `Merc.vault` commits the hop. `Combat.resolveRanged` accepts `{ freeShot: true }` to skip the AP gate.
- ~~**Stealth doesn't break on attack.**~~ Closed in v0.1.0 — `resolveRanged` and `resolveMelee` both clear `attacker.stealthed` on a committed attack (hit or miss). Guard is `if (attacker.stealthed)` so it's a no-op for non-stealthed entities.
