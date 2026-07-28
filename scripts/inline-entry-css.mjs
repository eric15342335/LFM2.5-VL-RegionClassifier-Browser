import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";

const distDirectory = resolve("dist");
const htmlPath = resolve(distDirectory, "index.html");

if (!existsSync(htmlPath)) throw new Error("Cannot inline entry CSS: dist/index.html is missing");

const html = readFileSync(htmlPath, "utf8");
const linkPattern = /<link\b[^>]*>/gi;
const links = [...html.matchAll(linkPattern)];
const localLinks = links.filter((match) => {
  if (!/\brel=["']stylesheet["']/i.test(match[0])) return false;
  const href = match[0].match(/\bhref=["']([^"']+)["']/i)?.[1];

  return href && !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href);
});

if (!localLinks.length)
  throw new Error("Cannot inline entry CSS: no generated local stylesheet was found");

const cssFiles = new Map();

for (const match of localLinks) {
  const tag = match[0];
  const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1];

  if (!href) continue;
  const pathname = decodeURIComponent(href.split(/[?#]/, 1)[0]);
  const cssPath = resolve(distDirectory, pathname.replace(/^\.\//, ""));
  const pathRelativeToDist = relative(distDirectory, cssPath);

  if (
    !pathRelativeToDist ||
    pathRelativeToDist.startsWith(`..${sep}`) ||
    isAbsolute(pathRelativeToDist)
  ) {
    throw new Error(`Cannot inline stylesheet outside dist: ${href}`);
  }
  if (!cssPath.toLowerCase().endsWith(".css")) continue;
  if (!existsSync(cssPath)) throw new Error(`Cannot inline stylesheet: ${href} is missing`);
  try {
    cssFiles.set(cssPath, readFileSync(cssPath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read stylesheet ${href}: ${error.message}`, { cause: error });
  }
}

if (!cssFiles.size)
  throw new Error("Cannot inline entry CSS: no generated local stylesheet was found");

let updatedHtml = html;

for (const [cssPath, css] of cssFiles) {
  const cleanedCss = css.replace(/\/\*[#@]\s*sourceMappingURL=[^*]+\*\//gi, "");
  const escapedCss = cleanedCss.replace(/<\/style/gi, "<\\/style");
  const cssBytes = Buffer.byteLength(cleanedCss);
  const href = `assets/${relative(resolve(distDirectory, "assets"), cssPath).replaceAll(sep, "/")}`;
  const style = `<style data-entry-css="${href}">${escapedCss}</style>`;
  const originalTag = localLinks.find((match) => {
    const originalHref = match[0].match(/\bhref=["']([^"']+)["']/i)?.[1];

    if (!originalHref) return false;
    const pathname = decodeURIComponent(originalHref.split(/[?#]/, 1)[0]);

    return resolve(distDirectory, pathname.replace(/^\.\//, "")) === cssPath;
  })?.[0];

  if (!originalTag) throw new Error(`Inlining failed: ${href} was not found in dist/index.html`);
  updatedHtml = updatedHtml.replace(originalTag, style);
  console.log(
    `Inlined ${relative(distDirectory, cssPath).replaceAll(sep, "/")}: ${cssBytes} bytes raw, ${gzipSync(Buffer.from(cleanedCss)).byteLength} bytes gzip`
  );
}

for (const [cssPath] of cssFiles) {
  const filename = cssPath.slice(distDirectory.length + 1).replaceAll(sep, "/");

  if (
    new RegExp(
      `<link\\b[^>]*\\brel=["']stylesheet["'][^>]*\\bhref=["'][^"']*${filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`,
      "i"
    ).test(updatedHtml)
  ) {
    throw new Error(`Inlining failed: ${filename} is still linked by dist/index.html`);
  }
}

const tempPath = `${htmlPath}.${process.pid}.tmp`;

writeFileSync(tempPath, updatedHtml);
renameSync(tempPath, htmlPath);

for (const [cssPath] of cssFiles) {
  unlinkSync(cssPath);
  const mapPath = `${cssPath}.map`;

  if (existsSync(mapPath)) unlinkSync(mapPath);
}

const htmlBytes = Buffer.byteLength(updatedHtml);

console.log(
  `Final dist/index.html: ${htmlBytes} bytes raw, ${gzipSync(Buffer.from(updatedHtml)).byteLength} bytes gzip`
);
