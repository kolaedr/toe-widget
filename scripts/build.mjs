// Збирає статичний сайт у dist/:
//   index.html            — сторінка встановлення
//   toe-light.js          — скрипт (з версією та адресою сайту для самооновлення)
//   toe-light.scriptable  — той самий скрипт у форматі імпорту Scriptable
//   version.json          — версія, яку перевіряє самооновлення
//
// BASE_URL=https://<user>.github.io/<repo>/ node scripts/build.mjs
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const SCRIPT_NAME = "TOE Light";

let baseUrl = process.env.BASE_URL || "https://kolaedr.github.io/toe-widget/";
if (!baseUrl.endsWith("/")) baseUrl += "/";

const source = readFileSync(join(root, "src", "toe-light.js"), "utf8");
for (const ph of ["__VERSION__", "__BASE_URL__"]) {
  if (!source.includes(`"${ph}"`)) throw new Error(`У src/toe-light.js немає плейсхолдера ${ph}`);
}

// версія = хеш вмісту: змінився код → змінилась версія → телефони оновляться самі
const version = createHash("sha256").update(source).digest("hex").slice(0, 8);

const script = source
  .replace('"__VERSION__"', JSON.stringify(version))
  .replace('"__BASE_URL__"', JSON.stringify(baseUrl));

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(root, "web"), dist, { recursive: true });

writeFileSync(join(dist, "toe-light.js"), script);
writeFileSync(join(dist, "toe-light.scriptable"), JSON.stringify({
  always_run_in_app: false,
  icon: { color: "deep-blue", glyph: "bolt" },
  name: SCRIPT_NAME,
  script,
  share_sheet_inputs: [],
}));
writeFileSync(join(dist, "version.json"), JSON.stringify({ version, builtAt: new Date().toISOString() }));

// щоб GitHub Pages не пропускав файли через Jekyll
writeFileSync(join(dist, ".nojekyll"), "");

console.log(`dist/ готовий · версія ${version} · ${baseUrl}`);
