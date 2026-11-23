import { ENTITIES } from "./entity-table";
import { type EntityNames, lazyEntityNames } from "./html-entities";

export const htmlEntityNames: () => EntityNames =
  /* @__PURE__ */ lazyEntityNames(ENTITIES);
