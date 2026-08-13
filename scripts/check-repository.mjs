import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

let tracked;
let usedGitIndex = true;
try {
  tracked = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
} catch {
  // Some managed sandboxes deny child processes. Fall back to source paths;
  // GitHub Actions uses a clean checkout, so this is equivalent there.
  usedGitIndex = false;
  const excludedDirectories = new Set([
    ".git", ".next", ".vercel", "node_modules", ".npm-cache", ".codex-run",
    ".claude", ".git-alt", "test-results", "playwright-report",
  ]);
  const walk = (directory = ".") => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name).replaceAll("\\", "/").replace(/^\.\//, "");
    if (entry.isDirectory()) return excludedDirectories.has(entry.name) ? [] : walk(path);
    if (/^\.env(?:$|\.(?!example$))/.test(entry.name) || entry.name === "memory.md" || entry.name.endsWith(".log")) {
      return [];
    }
    return [path];
  });
  tracked = walk();
}

const forbidden = usedGitIndex
  ? tracked.filter((file) =>
      /(^|\/)(\.env($|\.(?!example$))|\.vercel(?:\/|$))/.test(file.replaceAll("\\", "/")),
    )
  : [];

const suspicious = [];
const textExtensions = /(?:^|\/)(?:[^/]+\.(?:js|mjs|cjs|ts|tsx|json|toml|ya?ml|md|sql|txt)|\.env\.example)$/;
const secretPatterns = [
  /sbp_[A-Za-z0-9_-]{20,}/,
  /sb_secret_[A-Za-z0-9_-]{20,}/,
  /postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/,
];

const ignoreFile = readFileSync(".gitignore", "utf8");
for (const requiredRule of [".env*", "!.env.example", ".vercel/"]) {
  if (!ignoreFile.split(/\r?\n/).includes(requiredRule)) {
    console.error(`Missing required .gitignore rule: ${requiredRule}`);
    process.exit(1);
  }
}

for (const file of tracked.filter((name) => textExtensions.test(name.replaceAll("\\", "/")))) {
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const pattern of secretPatterns) {
    if (pattern.test(content)) suspicious.push(file);
  }
  for (const match of content.matchAll(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)) {
    try {
      const payload = JSON.parse(Buffer.from(match[0].split(".")[1], "base64url").toString("utf8"));
      if (payload.role === "service_role") suspicious.push(file);
    } catch {
      // Not a decodable JWT; ignore it instead of reporting a false positive.
    }
  }
}

if (forbidden.length || suspicious.length) {
  if (forbidden.length) console.error(`Forbidden tracked paths: ${forbidden.join(", ")}`);
  if (suspicious.length) console.error(`Possible secrets in tracked files: ${[...new Set(suspicious)].join(", ")}`);
  process.exit(1);
}

console.log(
  `Repository safety check passed; ${tracked.length} ${usedGitIndex ? "Git-listed" : "source"} paths inspected.`,
);
