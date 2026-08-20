/**
 * Resolve hook: map relative/absolute specifiers ending in `.js` to their
 * sibling `.ts` source when the `.js` file does not exist (same hook as the
 * CLI's bin — duplicated per package so each bin is self-contained).
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
