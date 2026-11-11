#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");
const fileArg = args.find((arg) => !arg.startsWith("--"));

if (!fileArg) {
  console.error("Usage: node verify.mjs <presentation.html> [--json]");
  process.exit(2);
}

const filePath = path.resolve(fileArg);
if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(2);
}

const html = fs.readFileSync(filePath, "utf8");
const failures = [];
const warnings = [];
const passes = [];

function count(pattern) {
  return [...html.matchAll(pattern)].length;
}

function record(condition, message, severity = "failure") {
  if (condition) passes.push(message);
  else if (severity === "warning") warnings.push(message);
  else failures.push(message);
}

function stripMarkup(value) {
  return value
    .replace(/<!--[^]*?-->/g, " ")
    .replace(/<script\b[^]*?<\/script>/gi, " ")
    .replace(/<style\b[^]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z0-9#]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlAttribute(value) {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:39|x27);/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

record(/<!doctype\s+html/i.test(html), "HTML doctype exists");
record(/<html\b[^>]*\blang=["'][^"']+["']/i.test(html), "Document language exists");
record(/<meta\b[^>]*charset=["']?utf-8/i.test(html), "UTF-8 charset exists");
record(/<meta\b[^>]*name=["']viewport["'][^>]*width=device-width/i.test(html), "Responsive viewport exists");
record(/<meta\b[^>]*name=["']color-scheme["'][^>]*content=["'][^"']*\b(?:light|dark)\b/i.test(html), "Document color scheme is declared");
record(/<title>\s*\S[^]*?<\/title>/i.test(html), "Document title exists");
record(/<meta\b[^>]*name=["']description["'][^>]*content=["']\s*\S/i.test(html), "Meta description exists");
record(/<main\b/i.test(html), "Main landmark exists");

const h1Count = count(/<h1\b/gi);
const sectionCount = count(/<section\b/gi);
record(h1Count === 1, `Exactly one h1 exists (found ${h1Count})`);
record(sectionCount > 0, `At least one section exists (found ${sectionCount})`);
record(/class=["'][^"']*skip-link|href=["']#(?:main|content|deck)["']/i.test(html), "Skip link exists");
record(/:focus-visible/i.test(html), "Visible focus style is defined");
record(/prefers-reduced-motion\s*:\s*reduce/i.test(html), "Reduced-motion mode is defined");
record(/@media\s+(?:[^{]*\band\s+)?print\b/i.test(html), "Print stylesheet exists");
record(!/\b(?:TODO|LOREM IPSUM|PLACEHOLDER|UNDEFINED)\b/i.test(stripMarkup(html)), "No obvious placeholder text remains");

const allIds = new Set([...html.matchAll(/<[^>]*\s+id=["']([^"']+)["'][^>]*>/gi)].map((m) => m[1]));
const duplicateIds = [...allIds].filter((id) => count(new RegExp(`\\s+id=["']${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`, "gi")) > 1);
record(duplicateIds.length === 0, `IDs are unique (${duplicateIds.join(", ") || "ok"})`);

const numericIds = [...allIds].filter((id) => /^\d/.test(id));
record(numericIds.length === 0, `IDs do not begin with digits (${numericIds.join(", ") || "ok"})`);

const anchorTargets = [...html.matchAll(/<a\b[^>]*\bhref=["']#([^"']+)["'][^>]*>/gi)].map((m) => m[1]);
record(anchorTargets.length > 0, `Static anchor navigation exists (${anchorTargets.length} links)`);
const missingTargets = [...new Set(anchorTargets.filter((target) => !allIds.has(target)))];
record(missingTargets.length === 0, `Anchor targets exist (${missingTargets.join(", ") || "ok"})`);

const imageMatches = [...html.matchAll(/<img\b([^>]*)>/gi)];
const imagesWithoutAlt = imageMatches.filter((m) => !/\balt=["'][^"']*["']/i.test(m[1]));
record(imagesWithoutAlt.length === 0, `Images define alt text (${imagesWithoutAlt.length} missing)`);

const detailsCount = count(/<details\b/gi);
const summaryCount = count(/<summary\b/gi);
record(summaryCount >= detailsCount, `Every details block has a summary (${detailsCount}/${summaryCount})`);

const externalAssets = [
  ...html.matchAll(/<(?:img|script|video|audio|source)\b[^>]*\bsrc=["']https?:\/\//gi),
  ...html.matchAll(/<link\b(?=[^>]*\brel=["'](?:stylesheet|preload|modulepreload|icon|apple-touch-icon|manifest)["'])[^>]*\bhref=["']https?:\/\//gi),
  ...html.matchAll(/url\(\s*["']?https?:\/\//gi),
  ...html.matchAll(/@import\s+(?:url\()?\s*["']?https?:\/\//gi),
];
record(externalAssets.length === 0, `No required external assets (${externalAssets.length} found)`);

const inlineScripts = count(/<script\b(?![^>]*\bsrc=)/gi);
record(inlineScripts === 0, inlineScripts === 0 ? "No inline JavaScript" : `Inline JavaScript present (${inlineScripts} scripts): verify the complete no-JS reading mode`, "warning");

const externalLinks = [...html.matchAll(/<a\b([^>]*\bhref=["']https?:\/\/[^"']+["'][^>]*)>/gi)];
const insecureLinks = externalLinks.filter((m) => /\bhref=["']http:\/\//i.test(m[1]));
record(insecureLinks.length === 0, `External links use HTTPS (${insecureLinks.length} HTTP links)`);
const sameTabExternalLinks = externalLinks.filter((m) => !/\btarget=["']_blank["']/i.test(m[1]));
record(sameTabExternalLinks.length === 0, `External links open a new tab (${sameTabExternalLinks.length} same-tab links)`);

const unsafeBlankLinks = externalLinks.filter((m) => {
  const attrs = m[1];
  if (!/\btarget=["']_blank["']/i.test(attrs)) return false;
  const rel = attrs.match(/\brel=["']([^"']+)["']/i)?.[1] || "";
  return !/\bnoopener\b/i.test(rel) || !/\bnoreferrer\b/i.test(rel);
});
record(unsafeBlankLinks.length === 0, `New-tab links use noopener noreferrer (${unsafeBlankLinks.length} incomplete)`);

const sourceUiExists = /sources?|источники?|методик|methodology|source-card|source-list/i.test(html);
record(sourceUiExists, "Source or methodology UI is detectable");

const provenanceContainer = html.match(/<(?:aside|div|header)\b[^>]*(?:data-markinfo-trace\b|data-provenance=["']1["'])[^>]*>/i);
record(Boolean(provenanceContainer), "Visible MarkInfo provenance header exists");
let provenanceHeaderHtml = "";
if (provenanceContainer) {
  const traceIndex = provenanceContainer.index ?? -1;
  const firstContentIndex = [html.search(/<nav\b/i), html.search(/<header\b[^>]*class=["'][^"']*hero/i)]
    .filter((index) => index >= 0)
    .reduce((min, index) => Math.min(min, index), Number.POSITIVE_INFINITY);
  record(traceIndex >= 0 && traceIndex <= firstContentIndex, "MarkInfo provenance appears before navigation or hero");
  const traceTail = html.slice(traceIndex);
  const traceEnd = [traceTail.search(/<nav\b/i), traceTail.search(/<header\b[^>]*class=["'][^"']*hero/i)]
    .filter((index) => index > 0)
    .reduce((min, index) => Math.min(min, index), traceTail.length);
  provenanceHeaderHtml = traceTail.slice(0, traceEnd);
}

const provenanceMetaMatch = html.match(/<meta\b[^>]*name=["']provenance["'][^>]*content=["']([^"']+)["'][^>]*>/i);
record(Boolean(provenanceMetaMatch), "Machine-readable provenance metadata exists");
let provenanceData = null;
if (provenanceMetaMatch) {
  try {
    provenanceData = JSON.parse(decodeHtmlAttribute(provenanceMetaMatch[1]));
  } catch {
    record(false, "Machine-readable provenance metadata is valid JSON");
  }
}
if (provenanceData) {
  const requiredProvenance = ["built_at", "source", "source_session_id", "session_title", "session_code", "client", "object", "doc_kind", "status", "edition", "tags"];
  const missingProvenance = requiredProvenance.filter((key) => {
    const value = provenanceData[key];
    if (Array.isArray(value)) return value.length === 0 || value.some((item) => !String(item ?? "").trim() || /\{\{[^}]+\}\}/.test(String(item)));
    const text = String(value ?? "").trim();
    return !text || /\{\{[^}]+\}\}/.test(text);
  });
  record(missingProvenance.length === 0, `Provenance metadata fields are complete (${missingProvenance.join(", ") || "ok"})`);
}

for (const [attribute, label] of [
  ["data-markinfo-source", "source"],
  ["data-markinfo-session-title", "session title"],
  ["data-markinfo-session-id", "safe session code"],
  ["data-markinfo-tags", "tag list"],
]) {
  record(new RegExp(`\\b${attribute}(?:=["'][^"']*["'])?`, "i").test(html), `Visible MarkInfo ${label} exists`);
}

const visibleTags = [...html.matchAll(/<[^>]*\bdata-markinfo-tag\b[^>]*>([^]*?)<\/[^>]+>/gi)]
  .map((match) => stripMarkup(match[1]).trim())
  .filter(Boolean);
record(visibleTags.length > 0, `Visible MarkInfo hashtags exist (${visibleTags.length} found)`);
record(visibleTags.every((tag) => tag.startsWith("#")), "Visible MarkInfo tags keep the # prefix");
if (provenanceData && Array.isArray(provenanceData.tags)) {
  const normalizeTag = (tag) => String(tag).trim().replace(/^#/, "");
  const expectedTags = provenanceData.tags.map(normalizeTag);
  const actualTags = visibleTags.map(normalizeTag);
  record(JSON.stringify(actualTags) === JSON.stringify(expectedTags), `Visible MarkInfo tags match provenance metadata (${actualTags.length}/${expectedTags.length})`);
} else {
  record(false, "Provenance metadata contains the final MarkInfo tag list");
}
if (provenanceData && provenanceHeaderHtml) {
  const visibleTraceText = stripMarkup(provenanceHeaderHtml);
  const sourceName = String(provenanceData.source_name || provenanceData.source || "").trim();
  record(Boolean(sourceName) && visibleTraceText.includes(sourceName), "Visible provenance shows the source name");
  record(visibleTraceText.includes(String(provenanceData.session_title || "")), "Visible provenance shows the exact task title");
  record(visibleTraceText.includes(String(provenanceData.session_code || "")), "Visible provenance shows the safe session code");
  record(!visibleTraceText.includes(String(provenanceData.source_session_id || "")), "Raw source_session_id stays machine-readable only");
}

const buyLinks = [...html.matchAll(/<a\b([^>]*)>([^]*?)<\/a>/gi)].filter((m) => /купить|заказать|в корзину|buy/i.test(stripMarkup(m[2])));
const genericBuyLinks = buyLinks.filter((m) => /(?:search|catalog|category|корзин|cart)(?:[/?#=&]|$)/i.test(m[1]));
record(genericBuyLinks.length === 0, `Purchase CTAs avoid generic search/category/cart links (${genericBuyLinks.length} suspicious)`, "warning");

const denseSections = [];
for (const [index, match] of [...html.matchAll(/<section\b[^>]*>([^]*?)<\/section>/gi)].entries()) {
  const words = stripMarkup(match[1]).split(/\s+/).filter(Boolean).length;
  if (words > 650) denseSections.push(`section ${index + 1}: ${words} words`);
}
record(denseSections.length === 0, `Section density is reviewable (${denseSections.join("; ") || "ok"})`, "warning");

const report = {
  file: filePath,
  summary: {
    failures: failures.length,
    warnings: warnings.length,
    passes: passes.length,
    sections: sectionCount,
    anchors: anchorTargets.length,
    images: imageMatches.length,
    externalLinks: externalLinks.length,
  },
  failures,
  warnings,
  passes,
};

if (jsonMode) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`\nTechnopack HTML presentation audit: ${filePath}`);
  console.log(`PASS ${passes.length} | WARN ${warnings.length} | FAIL ${failures.length}`);
  failures.forEach((item) => console.log(`FAIL  ${item}`));
  warnings.forEach((item) => console.log(`WARN  ${item}`));
  if (!failures.length) console.log("No blocking static findings.");
}

process.exit(failures.length ? 1 : 0);
