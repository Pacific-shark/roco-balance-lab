// A deployable encyclopedia-only artifact. Never copy public/ wholesale:
// that directory also holds research results and historical model outputs.
import { build } from "vite";
import { mkdir, copyFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const output = new URL("../.local/dex-pages/", import.meta.url);
await build({
  configFile: false,
  root,
  base: "./",
  publicDir: false,
  define: { "import.meta.env.VITE_DEX_STATIC_ONLY": "true" },
  build: {
    outDir: fileURLToPath(output),
    emptyOutDir: false,
    rollupOptions: {
      input: fileURLToPath(new URL("../index.html", import.meta.url)),
    },
  },
});
await mkdir(new URL("data/", output), { recursive: true });
await copyFile(
  new URL("../public/data/dex.json", import.meta.url),
  new URL("data/dex.json", output),
);
const contents = await readdir(output);
if (contents.some((name) => !["assets", "data", "index.html"].includes(name)))
  throw Error(
    "Unexpected file in standalone artifact; inspect before publishing",
  );
console.log(`Encyclopedia-only artifact: ${fileURLToPath(output)}`);
