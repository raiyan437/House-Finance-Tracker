'use strict';

// Fixed ceiling: options cannot disable the stack-safety invariant.
const MAX_DEPTH = 128;

const checkDepth = depth => {
  if (depth > MAX_DEPTH) {
    throw new SyntaxError(`Brace pattern nesting exceeds the safe limit (${MAX_DEPTH})`);
  }
};

// Traverse only child edges: parser ASTs intentionally have parent/prev links.
// Check before walkers mutate an AST, and cover direct lib/* consumers too.
const checkAst = ast => {
  const pending = [{ node: ast, depth: 0 }];
  while (pending.length) {
    const { node, depth } = pending.pop();
    checkDepth(depth);
    if (node && node.nodes) {
      for (const child of node.nodes) pending.push({ node: child, depth: depth + 1 });
    }
  }
};

module.exports = { MAX_DEPTH, checkDepth, checkAst };
