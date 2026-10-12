// Turns the directory's features on in Rapid Response's Firebase project,
// from the terminal, using your `firebase login`:
//
//   1. Reads the LIVE Firestore rules (whatever is published now, not a repo
//      copy), saves a backup, puts the directory's block in (or replaces it),
//      shows what changes, and publishes only after you type "yes". Firebase
//      checks the rules before they go live; on any error nothing changes.
//   2. Turns on sign-in by email link (password sign-in keeps working) and
//      adds the site's domains to the authorized list. Google sign-in, if it
//      is off, has to be switched on once in the console (it needs keys only
//      the console creates); the script says so.
//
//   cd tools/rrt-rules && npm install && npx firebase login && node sync.mjs
import { createRequire } from "node:module";
import { writeFileSync, mkdirSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { merge } from "../../tests/rules/merge.mjs";

const PROJECT = "rrt-new-backend";
const DOMAINS = ["rapid-response.in", "www.rapid-response.in", "ngo-finder-omega.vercel.app"];
const RULES = "https://firebaserules.googleapis.com/v1";
const IDT = "https://identitytoolkit.googleapis.com/admin/v2/projects/" + PROJECT;
const OUT = join(homedir(), "Desktop", "rrt-ngo-ship");

const require = createRequire(import.meta.url);
const auth = require("firebase-tools/lib/auth.js");

function stop(msg) { console.error("\n" + msg); process.exit(1); }

async function token() {
  if (process.env.NGO_SYNC_TOKEN) return process.env.NGO_SYNC_TOKEN;  // tests only
  const acct = auth.getGlobalDefaultAccount();
  if (!acct || !acct.tokens || !acct.tokens.refresh_token) stop("Not signed in. Run: npx firebase login");
  const t = await auth.getAccessToken(acct.tokens.refresh_token, ["https://www.googleapis.com/auth/cloud-platform"]);
  console.log("Signed in as " + acct.user.email);
  return t.access_token;
}

async function call(tok, method, url, body) {
  const r = await fetch(url, {
    method, headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json", "x-goog-user-project": PROJECT },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await r.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { raw: text }; }
  if (!r.ok) {
    const e = new Error((data.error && data.error.message) || text || r.statusText);
    e.status = r.status; e.data = data; throw e;
  }
  return data;
}

async function rules(tok) {
  console.log("\n1. Firestore rules");
  const rel = await call(tok, "GET", RULES + "/projects/" + PROJECT + "/releases/cloud.firestore");
  const set = await call(tok, "GET", RULES + "/" + rel.rulesetName);
  const files = (set.source && set.source.files) || [];
  if (files.length !== 1) stop("The live rules have " + files.length + " files; expected 1. Nothing changed.");
  const live = files[0].content;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  mkdirSync(OUT, { recursive: true });
  const backup = join(OUT, "live-rules-backup-" + stamp + ".rules");
  writeFileSync(backup, live);
  console.log("   Live rules saved as a backup: " + backup);

  const next = merge(live);
  const repoCopy = join(OUT, "firestore-security-rules.rules");
  writeFileSync(repoCopy, next);
  if (next === live) { console.log("   The directory block is already live and up to date."); return; }
  const had = live.includes("NGO-DIRECTORY START");
  const outside = (s) => s.replace(/\n?\s*\/\/ ===== NGO-DIRECTORY START =====[\s\S]*?\/\/ ===== NGO-DIRECTORY END =====\n?/, "").replace(/\s+/g, " ").trim();
  if (outside(next) !== outside(live)) stop("Safety check failed: RRT's own rules would change. Nothing changed.");
  console.log("   " + (had ? "Updates" : "Adds") + " the directory block (" + next.split("\n").length + " lines in all, was " +
    live.split("\n").length + "). RRT's own rules stay exactly as they are.");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ans = (await rl.question("   Type yes to publish: ")).trim().toLowerCase();
  rl.close();
  if (ans !== "yes") stop("Not published. Nothing changed.");

  let created;
  try {
    created = await call(tok, "POST", RULES + "/projects/" + PROJECT + "/rulesets",
      { source: { files: [{ name: files[0].name || "firestore.rules", content: next }] } });
  } catch (e) {
    stop("Firebase refused the rules, so nothing changed:\n" + JSON.stringify(e.data, null, 2));
  }
  await call(tok, "PATCH", RULES + "/projects/" + PROJECT + "/releases/cloud.firestore",
    { release: { name: "projects/" + PROJECT + "/releases/cloud.firestore", rulesetName: created.name } });
  console.log("   Published. To undo: Firebase console > Firestore > Rules > history.");
  console.log("   Your repo copy with the block: " + repoCopy);
}

async function signIn(tok) {
  console.log("\n2. Sign-in");
  const cfg = await call(tok, "GET", IDT + "/config");
  const email = (cfg.signIn && cfg.signIn.email) || {};
  const domains = cfg.authorizedDomains || [];
  const add = DOMAINS.filter((d) => !domains.includes(d));
  const mask = [], patch = {};
  if (!email.enabled || email.passwordRequired !== false) {
    patch.signIn = { email: { enabled: true, passwordRequired: false } };
    mask.push("signIn.email.enabled", "signIn.email.passwordRequired");
  }
  if (add.length) { patch.authorizedDomains = domains.concat(add); mask.push("authorizedDomains"); }
  if (mask.length) {
    await call(tok, "PATCH", IDT + "/config?updateMask=" + mask.join(","), patch);
    if (patch.signIn) console.log("   Email link sign-in: turned on (email and password sign-in still work).");
    if (add.length) console.log("   Authorized domains added: " + add.join(", "));
  } else console.log("   Email link sign-in and domains: already set.");
  let google = false;
  try { google = !!(await call(tok, "GET", IDT + "/defaultSupportedIdpConfigs/google.com")).enabled; } catch (e) { google = false; }
  console.log(google ? "   Google sign-in: on." :
    "   Google sign-in is OFF. Turn it on once: https://console.firebase.google.com/project/" + PROJECT + "/authentication/providers > Google > Enable > Save.");
}

async function check() {
  // No key and no sign-in: exactly what a visitor's browser is allowed to read.
  const r = await fetch("https://firestore.googleapis.com/v1/projects/" + PROJECT +
    "/databases/(default)/documents/ngo/dir/public/index");
  console.log("\n3. Check: " + (r.status === 404 || r.status === 200
    ? "live. Comments and \"Did you reach them?\" now show on rapid-response.in/ngos."
    : "not live yet (HTTP " + r.status + "). Wait a minute and run this again."));
}

const tok = await token();
try {
  await rules(tok);
  await signIn(tok);
  await check();
} catch (e) {
  if (e.status === 403) stop("This Google account cannot change " + PROJECT + " (" + e.message + "). Sign in with the project owner: npx firebase login --reauth");
  stop("Stopped: " + e.message);
}
