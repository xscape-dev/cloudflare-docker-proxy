import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default {
  context: dirname,
  target: "webworker",
  mode: "production",
  optimization: { usedExports: true },
  module: {
    rules: [{ include: /node_modules/, test: /\.mjs$/, type: "javascript/auto" }],
  },
};
