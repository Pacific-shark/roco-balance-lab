import { readFile, writeFile, mkdir } from "node:fs/promises";
const root = new URL("../", import.meta.url);
const names = [
  "Catalog",
  "Skills",
  "Learnsets",
  "Evolutions",
  "Terms",
  "Config",
];
const manifest = JSON.parse(
  await readFile(new URL("public/data/pilot-manifest.json", root), "utf8"),
);
const modules = Object.fromEntries(
  await Promise.all(
    names.map(async (name) => [
      name,
      JSON.parse(
        await readFile(
          new URL(`.cache/pilot-source/${name}.parsed.json`, root),
          "utf8",
        ),
      ),
    ]),
  ),
);
await mkdir(new URL("data/", root), { recursive: true });
await writeFile(
  new URL("data/catalog-s4-20261015.json", root),
  JSON.stringify({
    provenance: {
      ...manifest.sourceManifest,
      description: "固定社区资料修订，不代表全部当前排位合法或实机认证",
    },
    modules,
  }),
);
console.log(
  `Exported ${Object.keys(modules.Catalog).length} forms, ${Object.keys(modules.Skills).length} skills/traits.`,
);
