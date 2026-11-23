import { fieldsOf, isNode } from "./nodes";
import type { Node } from "./types/estree";

export interface Comment {
  type: "Line" | "Block";
  value: string;
  start: number;
  end: number;
  loc?: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
}

let commentSource = "";
let commentSink: Comment[] = [];
let commentEnd = 0;
let queue: Comment[] = [];
let next = 0;

export function bindOnComment(source: string, comments: Comment[]): void {
  commentSource = source;
  commentSink = comments;
  commentEnd = 0;
}

export function lastCommentEnd(): number {
  return commentEnd;
}

export function skipComment(
  _block: boolean,
  _value: string,
  _start: number,
  end: number,
) {
  commentEnd = end;
}

export function onComment(
  block: boolean,
  rawValue: string,
  start: number,
  end: number,
  startLoc?: { line: number; column: number } | false,
  endLoc?: { line: number; column: number } | false,
) {
  commentEnd = end;
  let value = rawValue;

  if (block && value.includes("\n")) {
    const lineStart = commentSource.lastIndexOf("\n", start - 1) + 1;
    let indentEnd = lineStart;
    let code = commentSource.charCodeAt(indentEnd);
    while (code === 32 || code === 9) {
      code = commentSource.charCodeAt(++indentEnd);
    }
    if (indentEnd > lineStart) {
      value = stripLeadingIndentation(
        value,
        commentSource.slice(lineStart, indentEnd),
      );
    }
  }

  const comment: Comment = {
    type: block ? "Block" : "Line",
    value,
    start,
    end,
  };
  if (startLoc && endLoc) comment.loc = { start: startLoc, end: endLoc };
  commentSink.push(comment);
}

function stripLeadingIndentation(value: string, indentation: string): string {
  let from = value.startsWith(indentation) ? indentation.length : 0;
  let result = "";
  let newline = value.indexOf("\n", from);
  while (newline !== -1) {
    result += value.slice(from, newline + 1);
    from = newline + 1;
    if (value.startsWith(indentation, from)) from += indentation.length;
    newline = value.indexOf("\n", from);
  }
  return result + value.slice(from);
}

export function attachComments(
  ast: Node,
  comments: Comment[],
  fromIndex: number,
): void {
  let low = 0;
  let high = comments.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((comments[mid]?.start ?? Infinity) < fromIndex) low = mid + 1;
    else high = mid;
  }
  if (low >= comments.length) return;

  queue = comments
    .slice(low)
    .map(({ type, value, start, end }) => ({ type, value, start, end }));
  next = 0;
  visit(ast, undefined, false);

  const after = queue[next];
  if (after && (after.start >= ast.end || ast.type === "Program")) {
    ast.trailingComments ??= [];
    ast.trailingComments.push(...queue.slice(next));
    next = queue.length;
  }
}

const LIST_KEYS = new Map([
  ["BlockStatement", "body"],
  ["Program", "body"],
  ["ArrayExpression", "elements"],
  ["ObjectExpression", "properties"],
]);

function gapBlocked(from: number, to: number): boolean {
  for (let i = from; i < to; i++) {
    const code = commentSource.charCodeAt(i);
    if (code !== 44 && code !== 41 && code !== 32 && code !== 9) return true;
  }
  return false;
}

function visit(
  node: Node,
  parent: Node | undefined,
  lastInBody: boolean,
): void {
  for (let c = queue[next]; c && c.start < node.start; c = queue[next]) {
    node.leadingComments ??= [];
    node.leadingComments.push(c);
    next++;
  }
  const upcomingComment = queue[next];
  if (!upcomingComment) return;

  const upcoming = upcomingComment.start;
  if (upcoming < node.end || !gapBlocked(node.end, upcoming)) {
    const fields = fieldsOf(node);
    const listKey = LIST_KEYS.get(node.type);
    const list = listKey === undefined ? undefined : fields[listKey];
    const listEmpty = Array.isArray(list) && list.length === 0;
    for (const key in fields) {
      if (next >= queue.length) return;
      if (key === "type") continue;
      const value = fields[key];
      if (Array.isArray(value)) {
        const inList = key === listKey;
        for (let i = 0; i < value.length; i++) {
          const child: unknown = value[i];
          if (isNode(child)) {
            visit(child, node, inList ? i === value.length - 1 : listEmpty);
          }
        }
      } else if (isNode(value)) {
        visit(value, node, listEmpty);
      }
    }
    if (next >= queue.length) return;
  }

  if (parent !== undefined && node.end === parent.end) return;

  if (lastInBody) {
    for (let c = queue[next]; c; c = queue[next]) {
      if (parent && c.start >= parent.end) break;
      node.trailingComments ??= [];
      node.trailingComments.push(c);
      next++;
    }
    return;
  }
  const c = queue[next];
  if (c && node.end <= c.start && !gapBlocked(node.end, c.start)) {
    node.trailingComments = [c];
    next++;
  }
}
