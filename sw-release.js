// Canonical player-facing release metadata shared by production and dev workers.
// Increment shellEpoch only when the new app shell cannot safely coexist with
// the previous worker (for example, removed or renamed runtime modules).
self.KernelPanicRelease = Object.freeze({
  version: '0.3.5',
  shellEpoch: 2,
  title: 'Rolled crew stats & archetype unlocks',
  highlights: Object.freeze([
    'Crew stats are now rolled, not picked — every operator has a distinct hit/dodge profile.',
    '3 new crew classes: Berserk, Adept, and Chimera; unlock one with a clean Score.',
  ]),
});
