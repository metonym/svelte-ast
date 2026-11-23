// svelte-ast/a11y: the a11y warnings svelte's compiler gives, from one
// walk of the markup. The checks are in a11y-checks.ts, so
// svelte-ast/warnings can run them in its own walk.
import { a11yChecks, type A11yWarning } from "./a11y-checks";
import { MarkupWalk } from "./markup-walk";
import type { AST } from "./types/svelte-ast";

export interface A11yOptions {
  /**
   * Whether the component compiles in runes mode, as {@link isRunesMode}
   * says. It decides how `<!-- svelte-ignore -->` reads its codes: in
   * runes mode only svelte 5's codes, separated by commas, count; in
   * legacy mode svelte 4's `a11y-…` codes do too. Default `false`.
   */
  runes?: boolean;
}

/**
 * The warnings svelte's compiler gives for a component's accessibility,
 * the `a11y_…` ones, with the same codes, messages and positions, and
 * none that a `<!-- svelte-ignore -->` comment silences.
 *
 * ```ts
 * import { isRunesMode, parse } from "svelte-ast";
 * import { a11yWarnings } from "svelte-ast/a11y";
 *
 * const runes = isRunesMode(source);
 * const warnings = a11yWarnings(parse(source), { runes });
 * ```
 */
export function a11yWarnings(
  ast: AST.Root,
  options: A11yOptions = {},
): A11yWarning[] {
  const warnings: A11yWarning[] = [];
  new MarkupWalk(options.runes ?? false, a11yChecks(warnings)).walk(ast);
  return warnings;
}

export type { A11yWarning } from "./a11y-checks";
