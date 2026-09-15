// Additive build step: generates .min.js / .min.css next to every
// client-facing source file, then rewrites <script>/<link> tags and
// relative import specifiers to point at the minified versions.
//
// The source files are untouched and remain the ones you edit. Run this
// before deploying (`npm run build`), or point Vercel's build command at it.
// It never touches /api (server code, not shipped to the browser),
// node_modules, the Unity game build, or anything in Docs/uploads.

import { readFile, writeFile } from "node:fs/promises";
import { minify as minifyJs } from "terser";
import CleanCSS from "clean-css";
import { globSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const EXCLUDE = /(?:^|[\\/])(node_modules|game|api|Docs|uploads)(?:[\\/]|$)/;

function findFiles(pattern) {
  return globSync(pattern, { cwd: ROOT })
    .filter((f) => !EXCLUDE.test(f))
    .filter((f) => !f.endsWith(".min.js") && !f.endsWith(".min.css"));
}

async function minifyJsFiles() {
  const files = findFiles("**/*.js");
  const outputs = new Map(); // sourceRelPath -> minRelPath
  for (const rel of files) {
    const abs = path.join(ROOT, rel);
    const code = await readFile(abs, "utf8");
    const result = await minifyJs(code, {
      module: true,
      compress: true,
      mangle: true
    });
    if (result.error) throw result.error;
    const minRel = rel.replace(/\.js$/, ".min.js");
    await writeFile(path.join(ROOT, minRel), result.code, "utf8");
    outputs.set(rel, minRel);
  }
  return outputs;
}

async function minifyCssFiles() {
  const files = findFiles("**/*.css");
  const outputs = new Map();
  const cleaner = new CleanCSS({ level: 2 });
  for (const rel of files) {
    const abs = path.join(ROOT, rel);
    const code = await readFile(abs, "utf8");
    const result = cleaner.minify(code);
    if (result.errors.length) throw new Error(result.errors.join("\n"));
    const minRel = rel.replace(/\.css$/, ".min.css");
    await writeFile(path.join(ROOT, minRel), result.styles, "utf8");
    outputs.set(rel, minRel);
  }
  return outputs;
}

// Rewrite relative import/export specifiers inside the minified JS so the
// whole module graph loads minified files, not just the entry point.
async function rewriteJsImports(jsMap) {
  for (const minRel of jsMap.values()) {
    const abs = path.join(ROOT, minRel);
    let code = await readFile(abs, "utf8");
    code = code.replace(
      /(from"|import")(\.\.?\/[^"]+?)\.js"/g,
      (full, prefix, specifier) => {
        const sourceRel = path
          .normalize(path.join(path.dirname(minRel), `${specifier}.js`))
          .split(path.sep)
          .join("/");
        if (jsMap.has(sourceRel)) {
          return `${prefix}${specifier}.min.js"`;
        }
        return full;
      }
    );
    await writeFile(abs, code, "utf8");
  }
}

// Point <script type="module" src="X.js"> and <link rel="stylesheet"
// href="X.css"> at the minified sibling, for local files only (never CDN
// URLs, node_modules, or the Vercel speed-insights snippet).
async function rewriteHtml(jsMap, cssMap) {
  const htmlFiles = findFiles("**/*.html");
  for (const rel of htmlFiles) {
    const abs = path.join(ROOT, rel);
    let html = await readFile(abs, "utf8");
    const dir = path.dirname(rel);

    html = html.replace(
      /(<script[^>]*\bsrc=")([^"]+\.js)(")/g,
      (full, pre, src, post) => {
        if (/^https?:\/\//.test(src) || src.startsWith("/_vercel")) return full;
        const sourceRel = path.normalize(path.join(dir, src)).split(path.sep).join("/");
        return jsMap.has(sourceRel) ? `${pre}${src.replace(/\.js$/, ".min.js")}${post}` : full;
      }
    );

    html = html.replace(
      /(<link[^>]*\brel="stylesheet"[^>]*\bhref=")([^"]+\.css)(")/g,
      (full, pre, href, post) => {
        if (/^https?:\/\//.test(href)) return full;
        const sourceRel = path.normalize(path.join(dir, href)).split(path.sep).join("/");
        return cssMap.has(sourceRel) ? `${pre}${href.replace(/\.css$/, ".min.css")}${post}` : full;
      }
    );

    await writeFile(abs, html, "utf8");
  }
}

const jsMap = await minifyJsFiles();
const cssMap = await minifyCssFiles();
await rewriteJsImports(jsMap);
await rewriteHtml(jsMap, cssMap);

console.log(`Minified ${jsMap.size} JS files and ${cssMap.size} CSS files.`);
console.log("HTML files now reference the .min. versions; source files are untouched.");
