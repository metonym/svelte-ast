import { declarations, tweaks } from "./acorn-bridge";
import { extendParser, type ParserConstructor } from "./acorn-internals";
import { tsPlugin } from "./ts-plugin";

export const TypeScriptParser: ParserConstructor = /* @__PURE__ */ extendParser(
  declarations,
  tsPlugin,
  tweaks,
);
