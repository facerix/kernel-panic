# M5.3 — Hub Clinic NPC (Patch)

## Context

Crew HP persists across jobs but there's no Hub-side healing — attrition is purely punitive. M5.3 adds a clinic NPC ("Patch") so players can spend Creds to heal crew between runs. This closes the long-standing "no Hub heal" gap and makes the economy loop more coherent: salvage → sell → Creds → heal/gear.

## Implementation Plan

### 1. Constants (`src/game/constants.ts`)

Add `CLINIC_COST_PER_HP = 15` alongside the existing shop cost constants.

### 2. Clinic entity (`src/game/hub/Clinic.ts` — new file)

Follow the Finn/Terminal pattern exactly:
- `Clinic extends Entity`, NEUTRAL faction, glyph `⧰`, `maxAp: 0`, `maxHp: 1`
- Constructor takes optional `{ id?, x?, y? }`, defaults id to `'clinic'`
- No gameplay methods — interaction is entirely shell-mediated (same as Finn/Terminal)

### 3. Hub map (`src/game/hub/SafeSpace.ts`)

Add `HUB_CLINIC_SPAWN = { x: 2, y: 5 }` — bottom-left area. The spec suggests bottom-left quadrant; player spawns at (6,5), Curator/Finn/Terminal are along y=2. Placing the clinic at (2,5) puts it in the player's path on the left side, filling the empty bottom-left corner.

Update the ASCII art comment. Add `clinicSpawn` to `buildHub()` return object.

### 4. Campaign class (`src/game/Campaign.ts`)

**New fields:**
- `clinic: Clinic | null` — Hub entity ref (same pattern as `finn`, `terminal`)
- `healedThisVisit: Set<string>` — tracks member IDs healed this Hub visit; reset in `enterHub()`

**New method — `healMember(memberId: string)`:**
- Guards: must be in HUB state, member must exist, not flatlined, not already full HP, not already healed this visit, sufficient Creds
- Cost: `(member.maxHp - member.hp) * CLINIC_COST_PER_HP`
- Effect: deducts Creds, sets `member.hp = member.maxHp`, adds to `healedThisVisit`, persists
- Throws on all illegal preconditions (crash over silent fallback)

**`enterHub()` changes:**
- Reset `healedThisVisit = new Set()`
- Create + add Clinic entity at `hub.clinicSpawn`
- Store on `this.clinic`

**`#tearDownHubWorld()` changes:**
- Clear `this.clinic = null`

### 5. Persistence (`src/game/persistence.ts`)

**`CampaignSnapshot`:** Add optional `healedThisVisit?: string[]`.

**`snapshotCampaign`:** Serialize `[...campaign.healedThisVisit]`.

**`restoreCampaign`:** Restore `campaign.healedThisVisit = new Set(record.healedThisVisit ?? [])`. Pre-M5.3 saves default to empty set.

**Restore COMBAT/ENDED paths:** Clear `campaign.clinic = null` (same as finn/terminal).

### 6. Clinic modal component (`components/ClinicModal.ts` — new file)

Web component `<clinic-modal>` following the FinnShop pattern:
- Shadow DOM, `show()`/`hide()` via `open` attribute, Esc to dismiss
- `setPatients(crew, balances)` — accepts crew snapshots + credits
- Renders each living, non-full-HP crew member as a row: callsign, archetype, `HP: n/m`, cost, **PATCH UP** button
- Already-full → greyed "FULL HP"; flatlined → greyed "FLATLINED"; already healed → greyed "HEALED"; insufficient Creds → greyed "INSUFFICIENT CREDS"
- Keyboard nav: ↑/↓ to select, Enter to heal, Esc to close
- Emits `heal` custom event `{ memberId }` and `dismiss` event
- CSS follows FinnShop's CRT terminal aesthetic (reuse CSS variables)

### 7. Shell wiring (`index.ts`)

**HTML:** Add `<clinic-modal id="clinic-modal"></clinic-modal>` to `index.html`.

**Boot:** Add `customElements.whenDefined('clinic-modal')` to `allComponentsReady`. Get ref via `mustGetElement`.

**`presentClinic()`** — mirrors `presentFinnShop()`: populate modal with crew + credits, show.

**`handleInteract()`** — add clinic adjacency check (before the Curator fallthrough):
```
if (campaign.player && campaign.clinic && isChebyshevAdjacent(campaign.player, campaign.clinic)) {
  flash('PATCH — clinic services.');
  presentClinic();
  return;
}
```

**Event handlers:** `onClinicHeal(evt)` calls `campaign.healMember(memberId)`, flashes result, refreshes modal. `onClinicDismiss()` hides modal.

**Flash hint update:** Update the "Step adjacent to…" fallthrough message to mention Patch.

### 8. Key help (`components/KeyHelp.ts`)

Add `⧰` → `Clinic (Patch)` to the Hub tiles section in `#buildTileHints()`.

### 9. Tests (`tests/unit/game/clinic.test.ts` — new file)

- **Heal cost calculation:** `(maxHp - hp) * CLINIC_COST_PER_HP` for various HP states
- **Cred deduction:** Credits reduced correctly after heal
- **HP restoration:** Member restored to `maxHp`
- **Once-per-visit:** Second heal for same member throws
- **Different members:** Can heal two different members in same visit
- **Flatlined rejection:** Throws for flatlined member
- **Full HP rejection:** Throws for already-full member
- **Insufficient Creds:** Throws when can't afford
- **Unknown member:** Throws for bad ID
- **Wrong state:** Throws when not in HUB
- **`healedThisVisit` reset:** New `enterHub()` call clears the set
- **Snapshot round-trip:** `healedThisVisit` persists and restores
- **Pre-M5.3 save migration:** Missing `healedThisVisit` defaults to empty set

### 10. Existing test updates

- `Campaign.test.ts` — verify `clinic` entity exists on Hub world after `enterHub()`
- `persistence.test.ts` — verify `healedThisVisit` round-trips in campaign snapshots

## File Summary

| File | Action |
|------|--------|
| `src/game/constants.ts` | Add `CLINIC_COST_PER_HP` |
| `src/game/hub/Clinic.ts` | **New** — entity class |
| `src/game/hub/SafeSpace.ts` | Add spawn point + return field |
| `src/game/Campaign.ts` | Add `clinic`, `healedThisVisit`, `healMember()` |
| `src/game/persistence.ts` | Snapshot/restore `healedThisVisit`, null clinic on restore |
| `components/ClinicModal.ts` | **New** — web component |
| `index.html` | Add `<clinic-modal>` element |
| `index.ts` | Wire interact, present, event handlers |
| `components/KeyHelp.ts` | Add clinic to Hub tile legend |
| `tests/unit/game/clinic.test.ts` | **New** — unit tests |
| `tests/unit/game/Campaign.test.ts` | Verify clinic on Hub |
| `tests/unit/game/persistence.test.ts` | Verify healedThisVisit round-trip |

## Verification

1. `npm test` — all existing tests pass + new clinic tests green
2. `npm run typecheck` — no type errors
3. Manual: `npm start` → new campaign → complete a run → return to Hub → walk to Patch → Space interact → heal a damaged crew member → verify Creds deducted and HP restored → next Hub visit allows healing again
