// Canonical player-facing release metadata shared by production and dev workers.
// Increment shellEpoch only when the new app shell cannot safely coexist with
// the previous worker (for example, removed or renamed runtime modules).
self.KernelPanicRelease = Object.freeze({
  version: '0.3.5',
  shellEpoch: 2,
  title: 'Chimera archetype online',
  highlights: Object.freeze([
    'Recruit Chimera operators and trigger their Nanite Repair perk.',
    'Nanite Repair converts scrap salvage into HP, repeatable while it lasts.',
  ]),
});
