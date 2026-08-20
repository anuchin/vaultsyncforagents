/**
 * Resolve hook: map relative/absolute specifiers ending in `.js` to their
 * sibling `.ts` source when the `.js` file does not exist. This is the
 * standard NodeNext convention (tsc rewrites nothing), and it lets the `vsa`
 * bin run the workspace TS directly on Node's native type stripping — no
 * tsx/ts-node dependency, no build step during development.
 */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (
      (specifier.startsWith('.') || specifier.startsWith('/')) &&
      /\.js$/.test(specifier) &&
      !specifier.endsWith('.node.js')
    ) {
      return nextResolve(specifier.replace(/\.js$/, '.ts'), context);
    }
    throw error;
  }
}
