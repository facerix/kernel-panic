// Registers the source-resolution hook (see ./hooks.mjs) ahead of the test run.
// Wired via `node --import ./tests/support/loader.mjs` in the `test` script.
import { register } from 'node:module';

register('./hooks.mjs', import.meta.url);
