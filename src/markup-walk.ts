// One walk of a component's markup, as svelte 5's analyzer visits it:
// each node once, in order, with the codes `<!-- svelte-ignore -->`
// comments silence there, and a component's children grouped by slot.
// The template warnings and the a11y checks share it, so a caller that
// wants both walks the markup once. svelte is MIT licensed.

import { ignoreCodes } from "./svelte-ignore";
import type { AST } from "./types/svelte-ast";

type Node = AST.SvelteNode;

/**
 * Called for each element and `<svelte:element>` before its children, with
 * the nodes above it and the codes ignored there.
 */
export type ElementVisitor = (
  node: AST.RegularElement | AST.SvelteElement,
  ancestors: readonly Node[],
  ignores: ReadonlySet<string>,
) => void;

const NO_IGNORES: ReadonlySet<string> = new Set();

// svelte's `element_nodes`, since `determine_slot` reads a `slot` only
// from these.
const ELEMENTS: ReadonlySet<string> = new Set([
  "Component",
  "TitleElement",
  "SlotElement",
  "RegularElement",
  "SvelteBody",
  "SvelteBoundary",
  "SvelteComponent",
  "SvelteDocument",
  "SvelteElement",
  "SvelteFragment",
  "SvelteHead",
  "SvelteOptions",
  "SvelteSelf",
  "SvelteWindow",
]);

const isElementLike = (node: Node): node is AST.ElementLike =>
  ELEMENTS.has(node.type);

// svelte's `determine_slot`, since a component's children are grouped by
// the static `slot` attribute it reads.
export function slotOf(node: Node): string | null {
  if (!isElementLike(node)) return null;
  for (const attribute of node.attributes) {
    if (attribute.type !== "Attribute" || attribute.name !== "slot") continue;
    const { value } = attribute;
    if (!Array.isArray(value) || value.length !== 1) continue;
    const [only] = value;
    if (only?.type === "Text") return only.data;
  }
  return null;
}

/**
 * Walks the markup. A subclass checks a node in {@link visitNode}, then
 * calls `super.visitNode` to walk its children.
 */
// eslint-disable-next-line no-restricted-syntax -- a subclass shares svelte's analyzer state, the path and parent_element, with the walk
export class MarkupWalk {
  protected readonly runes: boolean;
  // The nodes above the one being visited, as svelte's `context.path`;
  // while a node is visited, it ends with that node.
  protected readonly path: Node[] = [];
  // svelte's `parent_element`: the element the markup sits in, until a
  // component, snippet or `<svelte:element>` resets it.
  protected parentElement: string | null = null;
  private readonly onElement: ElementVisitor | undefined;

  constructor(runes: boolean, onElement?: ElementVisitor) {
    this.runes = runes;
    this.onElement = onElement;
  }

  /** Walks `ast`'s markup from its root fragment. */
  walk(ast: AST.Root): void {
    this.fragment(ast.fragment.nodes, NO_IGNORES);
  }

  /**
   * Visits a fragment's nodes, as svelte's analyzer with its `svelte-ignore`
   * comments.
   */
  protected fragment(
    nodes: readonly Node[],
    ignored: ReadonlySet<string>,
  ): void {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node === undefined || node.type === "Comment" || node.type === "Text")
        continue;
      let ignores = ignored;
      const previous = nodes[i - 1]?.type ?? "";
      if (previous === "Comment" || previous === "Text") {
        const codes = this.ignoredBefore(nodes, i);
        if (codes.length > 0) ignores = new Set([...ignored, ...codes]);
      }
      this.visit(node, ignores);
    }
  }

  /** The codes the comments right before `nodes[index]` ignore. */
  private ignoredBefore(nodes: readonly Node[], index: number): string[] {
    const codes: string[] = [];
    for (let i = index - 1; i >= 0; i--) {
      const previous = nodes[i];
      if (previous === undefined) break;
      if (previous.type === "Comment")
        codes.push(...ignoreCodes(previous.data, this.runes));
      else if (previous.type !== "Text") break;
    }
    return codes;
  }

  private visit(node: Node, ignores: ReadonlySet<string>): void {
    if (
      this.onElement !== undefined &&
      (node.type === "RegularElement" || node.type === "SvelteElement")
    ) {
      this.onElement(node, this.path, ignores);
    }
    this.path.push(node);
    this.visitNode(node, ignores);
    this.path.pop();
  }

  /**
   * Visits `node`'s fragment with `parentElement` as svelte's
   * `parent_element`.
   */
  protected within(
    parentElement: string | null,
    nodes: readonly Node[],
    ignores: ReadonlySet<string>,
  ): void {
    const outer = this.parentElement;
    this.parentElement = parentElement;
    this.fragment(nodes, ignores);
    this.parentElement = outer;
  }

  /** Walks `node`'s children. */
  protected visitNode(node: Node, ignores: ReadonlySet<string>): void {
    // eslint-disable-next-line typescript/switch-exhaustiveness-check -- the default walks nothing, as most nodes have no markup children
    switch (node.type) {
      case "RegularElement":
        this.within(node.name, node.fragment.nodes, ignores);
        return;
      case "SvelteElement":
      case "SvelteFragment":
        this.within(null, node.fragment.nodes, ignores);
        return;
      case "SnippetBlock":
        this.within(null, node.body.nodes, ignores);
        return;
      case "Component":
      case "SvelteComponent":
      case "SvelteSelf":
        this.componentChildren(node, ignores);
        return;
      case "SlotElement":
      case "TitleElement":
      case "SvelteBoundary":
      case "SvelteHead":
      case "KeyBlock":
        this.fragment(node.fragment.nodes, ignores);
        return;
      case "IfBlock":
        this.fragment(node.consequent.nodes, ignores);
        if (node.alternate) this.fragment(node.alternate.nodes, ignores);
        return;
      case "EachBlock":
        this.eachBody(node, ignores);
        if (node.fallback) this.fragment(node.fallback.nodes, ignores);
        return;
      case "AwaitBlock":
        if (node.pending) this.fragment(node.pending.nodes, ignores);
        if (node.then) this.fragment(node.then.nodes, ignores);
        if (node.catch) this.fragment(node.catch.nodes, ignores);
        return;
      default:
        // The rest have no markup children: tags, text, comments,
        // `<svelte:window>` and its kin.
        return;
    }
  }

  /** Walks an `{#each}` block's body; a subclass may track what's open. */
  protected eachBody(node: AST.EachBlock, ignores: ReadonlySet<string>): void {
    this.fragment(node.body.nodes, ignores);
  }

  private componentChildren(
    node: AST.Component | AST.SvelteComponent | AST.SvelteSelf,
    ignores: ReadonlySet<string>,
  ): void {
    const children = node.fragment.nodes;
    // With no comment and no named slot, svelte's grouping keeps the
    // children as they are.
    if (
      !children.some(
        (child) => child.type === "Comment" || slotOf(child) !== null,
      )
    ) {
      this.within(null, children, ignores);
      return;
    }
    // svelte walks each slot's children, with the comments before them,
    // as a fragment of its own, so the default slot's comments carry on
    // past its children.
    let comments: Node[] = [];
    const slots = new Map<string, Node[]>([["default", []]]);
    for (const child of children) {
      if (child.type === "Comment") {
        comments.push(child);
        continue;
      }
      const slot = slotOf(child) ?? "default";
      const nodes = slots.get(slot);
      if (nodes === undefined) slots.set(slot, [...comments, child]);
      else nodes.push(...comments, child);
      if (slot !== "default") comments = [];
    }
    for (const nodes of slots.values()) this.within(null, nodes, ignores);
  }
}
