// Canonical player-facing release metadata shared by production and dev workers.
// Increment shellEpoch only when the new app shell cannot safely coexist with
// the previous worker (for example, removed or renamed runtime modules).
self.KernelPanicRelease = Object.freeze({
  version: '0.3.3b',
  shellEpoch: 2,
  title: 'Update controls online',
  highlights: Object.freeze([
    'Release notes now accompany app updates.',
    'Breaking updates now require a safe restart.',
  ]),
});
