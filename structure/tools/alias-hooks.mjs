import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const SITE = fileURLToPath(new URL("../../lexington-site/", import.meta.url));
const tryFile = (base) => [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find((p) => existsSync(p) && !p.endsWith("/"));
export async function resolve(spec, ctx, next) {
  if (spec.startsWith("@/")) {
    const f = tryFile(SITE + spec.slice(2));
    if (f) return next(pathToFileURL(f).href, ctx);
  }
  if ((spec.startsWith("./") || spec.startsWith("../")) && ctx.parentURL?.includes("/lexington-site/")) {
    const f = tryFile(fileURLToPath(new URL(spec, ctx.parentURL)));
    if (f) return next(pathToFileURL(f).href, ctx);
  }
  return next(spec, ctx);
}
