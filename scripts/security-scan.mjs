import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const excluded = new Set([".git", "node_modules", ".security-npm-cache"]);
const git = (args, input) => {
  try {
    return execFileSync("git", ["-c", `safe.directory=${root.replaceAll("\\", "/")}`, ...args], {
      cwd: root, input, maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    throw new Error("Git security scan failed; raw command output has been withheld to avoid exposing credentials.");
  }
};
const findings = [];
const placeholder = value => /^(?:your[_-]|example|placeholder|changeme|<|\$\{|process\.|import\.|Deno\.)/i.test(value);

function scan(buffer, location) {
  if (buffer.includes(0)) return;
  const text = buffer.toString("utf8");
  const record = (kind, index) => findings.push({ location, line: text.slice(0, index).split("\n").length, kind });
  for (const match of text.matchAll(/(?:sb_secret_[A-Za-z0-9_-]{12,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}|\bgsk_[A-Za-z0-9_-]{20,}|\bre_[A-Za-z0-9_-]{24,}|\bgh[pousr]_[A-Za-z0-9]{24,}|\bgithub_pat_[A-Za-z0-9_]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/g)) {
    record("private credential signature; ROTATION REQUIRED if real", match.index);
  }
  for (const match of text.matchAll(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)) {
    try {
      const payload = JSON.parse(Buffer.from(match[0].split(".")[1], "base64url").toString());
      if (payload.role !== "anon") record(`hardcoded JWT (${payload.role === "service_role" ? "service role" : "non-anon"}); ROTATION REQUIRED if real`, match.index);
    } catch { /* Not a decodable JWT. */ }
  }
  for (const match of text.matchAll(/\b(?:SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|AI_API_KEY|GROQ_API_KEY|OPENAI_API_KEY|RESEND_API_KEY|SMTP_PASSWORD|DB_PASSWORD|JWT_SECRET|PRIVATE_KEY|SECRET_KEY|ACCESS_TOKEN|WEBHOOK_SECRET|password)\b\s*[=:]\s*["'`]([A-Za-z0-9_./+=:@%-]{12,})["'`]/gi)) {
    if (!placeholder(match[1]) && !["access_token", "refresh_token"].includes(match[1])) record("possible literal private credential; review redacted location", match.index);
  }
  for (const match of text.matchAll(/^\s*(?:export\s+)?(?:VITE_)?(?:SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|AI_API_KEY|GROQ_API_KEY|OPENAI_API_KEY|RESEND_API_KEY|SMTP_PASSWORD|DB_PASSWORD|DATABASE_URL|JWT_SECRET|PRIVATE_KEY|SECRET_KEY|ACCESS_TOKEN|WEBHOOK_SECRET)\s*=\s*([A-Za-z0-9_./+=:@%-]{12,})\s*$/gm)) {
    if (!placeholder(match[1])) record("possible private environment credential; review redacted location", match.index);
  }
  for (const match of text.matchAll(/(?:postgres(?:ql)?|https?):\/\/[^\s/"']+:([^\s/@"']+)@[^\s"']+/g)) {
    if (!placeholder(match[1])) record("credential-bearing connection URL; review redacted location", match.index);
  }
  for (const match of text.matchAll(/Authorization\s*[:=]\s*["'`]Bearer\s+([A-Za-z0-9_.-]{12,})/gi)) {
    if (!placeholder(match[1])) record("hardcoded bearer token; review redacted location", match.index);
  }
}

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name) || entry.name.startsWith(".security-")) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile()) scan(fs.readFileSync(full), path.relative(root, full));
  }
}

if (process.argv.includes("--dist")) walk(path.join(root, "dist"));
else walk(root);

let historyBlobs = 0;
let historyBinaryBlobs = 0;
if (process.argv.includes("--history")) {
  const objects = git(["rev-list", "--objects", "--all"]).toString().trim().split("\n");
  const names = new Map(objects.map(line => { const index = line.indexOf(" "); return [index < 0 ? line : line.slice(0, index), index < 0 ? "" : line.slice(index + 1)]; }));
  const metadata = git(["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"], [...names.keys()].join("\n") + "\n").toString().trim().split("\n");
  let batch = [], batchBytes = 0;
  const scanBatch = () => {
    if (!batch.length) return;
    const data = git(["cat-file", "--batch"], batch.join("\n") + "\n");
    let position = 0;
    for (const id of batch) {
      const end = data.indexOf(10, position);
      const size = Number(data.subarray(position, end).toString().split(" ")[2]);
      position = end + 1;
      const content = data.subarray(position, position + size);
      if (content.includes(0)) historyBinaryBlobs += 1;
      else { scan(content, `history:${id.slice(0, 12)}:${names.get(id)}`); historyBlobs += 1; }
      position += size + 1;
    }
    batch = []; batchBytes = 0;
  };
  for (const line of metadata) {
    const [id, type, bytes] = line.split(" ");
    if (type !== "blob") continue;
    if (/\.(?:apk|png|jpe?g|webp|ico|woff2?|zip|pdf)$/i.test(names.get(id))) { historyBinaryBlobs += 1; continue; }
    const size = Number(bytes);
    if (size > 48 * 1024 * 1024) throw new Error("Oversize text blob requires separate review; scan has not completed.");
    if (batchBytes + size > 32 * 1024 * 1024) scanBatch();
    batch.push(id); batchBytes += size;
  }
  scanBatch();
  scan(git(["log", "--all", "--format=%B"]), "history:commit-messages");
  scan(fs.readFileSync(path.join(root, ".git", "config")), ".git/config");
}

// Locations and categories only: never print matches, values, or Git blob content.
console.log(JSON.stringify({ historyBlobs, historyBinaryBlobs, findings }, null, 2));
if (findings.length) process.exitCode = 1;
