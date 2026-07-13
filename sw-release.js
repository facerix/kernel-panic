// Canonical player-facing release metadata shared by production and dev workers.
// Increment shellEpoch only when the new app shell cannot safely coexist with
// the previous worker (for example, removed or renamed runtime modules).
self.KernelPanicRelease = Object.freeze({
  version: '0.3.4b',
  shellEpoch: 2,
  title: 'Berserk archetype online',
  highlights: Object.freeze([
    'Recruit Berserk operators and trigger their Surge perk.',
    'Surge boosts damage and AP before an unavoidable Crash.',
  ]),
});
