// Shared helpers for the federation pages. Text from people is only ever set with textContent.

export function $(id) { return document.getElementById(id); }

export function el(tag, attrs, kids) {
  const e = document.createElement(tag);
  if (attrs) for (const k of Object.keys(attrs)) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === "text") e.textContent = v;
    else if (k === "cls") e.className = v;
    else if (k === "on") for (const ev of Object.keys(v)) e.addEventListener(ev, v[ev]);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids || []) if (c != null && c !== false) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  return e;
}

export function clear(node) { node.textContent = ""; return node; }

export function slug(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

// The same id the public directory uses for a group (see app.js gidOf).
export function gidOf(o) {
  return o.ac ? "awbi-" + slug(o.ac) : slug(o.n) + "--" + slug(o.d) + "--" + slug(o.st);
}

// Payment details and fundraising asks. Mirrors hasMoney() in firestore.rules,
// so people get a clear message before the server refuses.
const MONEY = new RegExp("(" + String.fromCharCode(0x20b9) + "|\\brs\\.? ?[0-9]|[0-9] ?/-|\\binr\\b|rupee|\\bu\\.? ?p\\.? ?i\\b|@(ok[a-z]+|ybl|ibl|axl|apl|paytm|upi)\\b|paytm|g-? ?pay|google ?pay|phone-? ?pe|amazon ?pay|paypal|razorpay|milaap|ketto|bhim|\\bneft\\b|\\bimps\\b|cheque|bank ?(account|details|transfer|a/?c)|acc?t\\.? ?(no|number)|account ?(no|number)|\\ba/c\\b|ifsc|\\bcash\\b|money|\\bfunds?\\b|fund ?rais|crowd ?fund|qr ?code|wallet|sponsor|donat(e|ion)s? (of|in) (money|cash))", "is");
export function moneyIn(...texts) {
  for (const t of texts) {
    const m = String(t || "").match(MONEY);
    if (m) return m[0];
  }
  return "";
}
export const NO_MONEY = "This platform never handles money. Please remove payment details or requests for money (found: \"%s\"). Ask for things or help instead.";

export const NEED_KINDS = [
  ["food", "Food or fodder"], ["medicine", "Medicines"], ["supplies", "Supplies"], ["volunteers", "Volunteers"],
  ["transport", "Transport"], ["foster", "Foster homes"], ["adoption", "Adoption"], ["vet", "Vet help"], ["other", "Other"]
];
export const REG_TYPES = [
  ["awbi", "AWBI recognition"], ["darpan", "NGO Darpan ID"], ["trust", "Trust registration"],
  ["society", "Society registration"], ["section8", "Section 8 company"], ["other", "Other registration"]
];
export const REPORT_REASONS = [
  ["fake", "Not a real group"], ["money", "Asking for money"], ["wrong", "Wrong details"],
  ["cruelty", "Animals not cared for"], ["closed", "Closed down"], ["other", "Something else"]
];
export const STATUS_LABEL = {
  submitted: "Waiting for review", info_needed: "More information needed", docs_ok: "Documents checked",
  visit_required: "Visit or video call needed", verified: "Verified", rejected: "Not approved", suspended: "Suspended"
};

export function fmtDate(ts) {
  const d = ts && ts.toDate ? ts.toDate() : ts instanceof Date ? ts : null;
  return d ? d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";
}

let toastTimer;
export function toast(msg) {
  let t = $("toast");
  if (!t) { t = el("div", { id: "toast", cls: "toast", role: "status" }); document.body.appendChild(t); }
  t.textContent = msg; t.classList.add("on");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("on"), 3200);
}

export function errText(e) {
  const code = (e && e.code) || "";
  if (code.includes("permission-denied")) return "Not allowed. If this looks wrong, sign out and in again, or contact the admins.";
  if (code.includes("popup-closed")) return "Sign-in window was closed.";
  if (code.includes("network")) return "No connection. Try again.";
  return (e && e.message) || "Something went wrong.";
}

// A collapsible block: a "+" toggle that reveals its body on demand.
export function expander(label, body, open) {
  const plus = el("span", { cls: "plusdot" }, [plusIcon()]);
  const t = el("button", { cls: "more-toggle", type: "button", "aria-expanded": String(!!open) }, [plus, el("span", { text: label })]);
  const wrap = el("div", { cls: "more" + (open ? " open" : "") }, [body]);
  t.addEventListener("click", () => {
    const o = !wrap.classList.contains("open");
    wrap.classList.toggle("open", o); t.setAttribute("aria-expanded", String(o));
  });
  return el("div", null, [t, wrap]);
}

export function plusIcon() {
  const ns = "http://www.w3.org/2000/svg";
  const s = document.createElementNS(ns, "svg");
  s.setAttribute("class", "icon"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(ns, "path"); p.setAttribute("d", "M12 5v14M5 12h14"); s.appendChild(p);
  return s;
}

export function field(label, input, hint) {
  return el("label", { cls: "field" }, [el("span", { cls: "flabel", text: label }), input, hint ? el("span", { cls: "fhint", text: hint }) : null]);
}

export function select(options, value) {
  const s = el("select");
  for (const [v, l] of options) s.appendChild(el("option", { value: v, text: l, selected: v === value }));
  return s;
}

// Shrink a photo of a document so it fits the free plan (stored as a data URL).
export async function fileToDataUrl(file) {
  const MAX = 900000;
  if (file.type === "application/pdf") {
    if (file.size > 650000) throw new Error("That PDF is too large (keep it under 650 KB), or upload photos of the pages instead.");
    return readAsDataUrl(file);
  }
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Upload a photo (JPG or PNG) or a PDF.");
  const img = await loadImage(file);
  let w = img.naturalWidth, h = img.naturalHeight;
  const scale = Math.min(1, 1600 / Math.max(w, h));
  w = Math.round(w * scale); h = Math.round(h * scale);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  c.getContext("2d").drawImage(img, 0, 0, w, h);
  for (const q of [0.8, 0.7, 0.6, 0.5, 0.4]) {
    const url = c.toDataURL("image/jpeg", q);
    if (url.length < MAX) return url;
  }
  throw new Error("That photo is too detailed to store. Try a smaller photo.");
}
function readAsDataUrl(file) {
  return new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = bad; r.readAsDataURL(file); });
}
function loadImage(file) {
  return new Promise((ok, bad) => {
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); ok(img); };
    img.onerror = () => { URL.revokeObjectURL(url); bad(new Error("Could not read that image.")); };
    img.src = url;
  });
}

// The public directory (for claiming a listed group and cross-checks).
let DIR = null;
export async function directory() {
  if (!DIR) {
    const r = await fetch(new URL("../data/ngos.json", import.meta.url), { cache: "no-cache" });
    if (!r.ok) throw new Error("Directory could not be loaded.");
    DIR = await r.json();
    DIR.orgs.forEach((o) => { o._id = gidOf(o); o._f = fold([o.n, (o.k || []).join(" "), o.a, o.d, o.st, o.ac].join(" ")); });
  }
  return DIR;
}
export function fold(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
export function findGroups(q, max = 20) {
  const terms = fold(q).split(/[^a-z0-9]+/).filter(Boolean);
  if (!DIR || !terms.length) return [];
  return DIR.orgs.filter((o) => terms.every((t) => o._f.includes(t))).slice(0, max);
}
