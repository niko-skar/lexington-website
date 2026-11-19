// Lets plain Node run the site's TypeScript modules: "@/x" → lexington-site/x(.ts|.tsx|/index.ts).
// Used as: node --import ./structure/tools/alias.mjs structure/tools/<script>.ts
import { register } from "node:module";
register(new URL("./alias-hooks.mjs", import.meta.url));
