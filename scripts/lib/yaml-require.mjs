// yaml is not a root dependency; resolve it through @pfdsl/core, which depends on it.
import { createRequire } from "node:module";

const require_ = createRequire(new URL("../../packages/core/package.json", import.meta.url));

export const { parseDocument } = require_("yaml");
