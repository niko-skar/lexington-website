// The slab thickness and beam schedule for each floor, exactly as the concrete estimator reads the
// engineer's drawings (lexington-site/lib/concrete/estimate.ts), for the structural model.
//   node --import ./structure/tools/alias.mjs structure/tools/export-slabs.ts > structure/model/slabs.json
import { slabSpecFor } from "../../lexington-site/lib/concrete/estimate.ts";
const keys = ["g", "1", "2", "3", "4", "5", "6", "7", "roof"];
const out: Record<string, unknown> = {};
for (const k of keys) out[k] = slabSpecFor(k);
process.stdout.write(JSON.stringify(out, null, 1));
