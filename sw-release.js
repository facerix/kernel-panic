// Canonical player-facing release metadata shared by production and dev workers.
// Increment shellEpoch only when the new app shell cannot safely coexist with
// the previous worker (for example, removed or renamed runtime modules).
self.KernelPanicRelease = Object.freeze({
  version: '0.3.6',
  shellEpoch: 2,
  title: 'Visual effects, Sound, and Quality-of-life improvements',
  highlights: Object.freeze([
    'Improved visual effects throughout the game.',
    'Ambient music and sound effects!',
    'Improvements to the crew-management and Finn shop flows.',
  ]),
});
