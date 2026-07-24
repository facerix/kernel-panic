// Node module-resolution hook for the test runner.
//
// The browser imports compiled `.js` modules, while tests execute the TypeScript
// source directly under Node 24. Resolve in-repository `.js` specifiers to their
// `.ts` source counterparts, including browser-root imports such as
// `/src/domUtils.js`.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const ROOT_PREFIX = `${ROOT}${path.sep}`;
const BROWSER_ROOT_PREFIXES = ['/src/', '/components/', '/debug/'];

function isInsideRoot(filePath) {
  return filePath === ROOT || filePath.startsWith(ROOT_PREFIX);
}

function sourcePathFor(specifier, parentURL) {
  if (!specifier.endsWith('.js')) return null;

  let jsPath;
  if (BROWSER_ROOT_PREFIXES.some(prefix => specifier.startsWith(prefix))) {
    jsPath = path.join(ROOT, specifier);
  } else if (
    parentURL?.startsWith('file:') &&
    (specifier.startsWith('./') || specifier.startsWith('../'))
  ) {
    jsPath = fileURLToPath(new URL(specifier, parentURL));
  } else {
    return null;
  }

  if (!isInsideRoot(jsPath)) return null;

  const tsPath = `${jsPath.slice(0, -3)}.ts`;
  return existsSync(tsPath) ? tsPath : null;
}

export async function resolve(specifier, context, nextResolve) {
  const tsPath = sourcePathFor(specifier, context.parentURL);
  if (tsPath) {
    return { url: pathToFileURL(tsPath).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
