// NGO portal: sign in, claim or apply, follow verification, then keep the profile,
// capacity and in-kind needs current. Coordinators and verified groups vouch here.
import { backend } from "./api.js";
import {
  $, el, clear, toast, errText, expander, field, select, fileToDataUrl, moneyIn, NO_MONEY, NEED_KINDS, REG_TYPES,
  REPORT_REASONS, STATUS_LABEL, fmtDate, directory, findGroups, gidOf
} from "./common.js";
import { proofList, appSummary } from "./shared.js";

const view = $("view");
const params = new URLSearchParams(location.search);
let B = null, user = null, roles = null, DIR = null;

function setTitle(t, sub) { $("title").textContent = t; $("sub").textContent = sub || ""; }
function card(kids, cls) { return el("section", { cls: "card " + (cls || "") }, kids); }
function busy(btn, on, label) { btn.disabled = on; if (label) btn.textContent = label; }
function guardMoney(...texts) {
  const m = moneyIn(...texts);
  if (m) { toast(NO_MONEY.replace("%s", m)); return false; }
  return true;
}

async function start() {
  try { B = await backend(); } catch (e) { B = null; }
  if (!B) {
    setTitle("For animal groups", "Opening soon.");
    clear(view).appendChild(card([el("p", { text: "Group sign-in is being set up. Until then, the directory is open to everyone." })]));
    return;
  }
  try { await B.finishLink(); } catch (e) { toast(errText(e)); }
  B.onUser(async (u) => {
    user = u;
    renderWho();
    if (!u) return signIn();
    clear(view).appendChild(el("div", { cls: "loading" }, [el("div", { cls: "skel" })]));
    try { roles = await B.roles(); await route(); } catch (e) { toast(errText(e)); }
  });
}

function renderWho() {
  const w = clear($("who"));
  if (!user) return;
  w.appendChild(el("span", { cls: "muted", text: user.email || "" }));
  w.appendChild(el("button", { cls: "pill", type: "button", text: "Sign out", on: { click: () => B.signOut() } }));
}

// ------------------------------------------------------------------ sign in
function signIn() {
  setTitle("For animal groups", "Sign in to claim your listing or ask to be listed.");
  const mail = el("input", { type: "email", placeholder: "you@yourgroup.org", autocomplete: "email", "aria-label": "Email" });
  const send = el("button", { cls: "pill blue", type: "button", text: "Email me a sign-in link" });
  send.addEventListener("click", async () => {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail.value.trim())) return toast("Enter a valid email.");
    busy(send, true, "Sending...");
    try { await B.sendLink(mail.value.trim()); toast("Check your inbox for the sign-in link."); busy(send, false, "Sent. Send again"); }
    catch (e) { toast(errText(e)); busy(send, false, "Email me a sign-in link"); }
  });
  const google = el("button", { cls: "pill", type: "button", text: "Continue with Google" });
  google.addEventListener("click", () => B.signInGoogle().catch((e) => toast(errText(e))));
  clear(view).appendChild(card([
    el("div", { cls: "label", text: "Sign in" }),
    el("div", { cls: "row-actions" }, [google]),
    el("div", { cls: "or", text: "or" }),
    el("div", { cls: "row-actions" }, [mail, send]),
    el("p", { cls: "fhint", text: "No passwords, no SMS or WhatsApp codes." })
  ]));
}

// ------------------------------------------------------------------ routing
async function route() {
  if (params.get("report")) return reportView(params.get("report"), params.get("name") || "");
  const tabs = [];
  if (roles.member) tabs.push(["group", "Our group", (b) => memberHome(b, roles.member.gid)]);
  if (roles.member || roles.coordinator) tabs.push(["vouch", "Vouch and visits", vouchView]);
  if (!roles.member) tabs.push(["apply", "Application", applicationHome]);
  if (roles.admin) tabs.push(["admin", "Admin", () => { location.href = "admin.html"; }]);
  const bar = el("nav", { cls: "types tabs" });
  const body = el("div");
  const show = (key) => {
    Array.from(bar.children).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.k === key)));
    clear(body);
    const t = tabs.find((x) => x[0] === key);
    Promise.resolve(t[2](body)).catch((e) => toast(errText(e)));
  };
  tabs.forEach(([k, label]) => bar.appendChild(el("button", { cls: "pill", type: "button", "data-k": k, text: label, on: { click: () => show(k) } })));
  clear(view);
  if (tabs.length > 1) view.appendChild(bar);
  view.appendChild(body);
  show(tabs[0][0]);
}

// ------------------------------------------------------------------ applying
async function applicationHome(body) {
  const mine = (await B.myApplications()).sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
  const open = mine.find((a) => a.status !== "rejected");
  if (open) return statusView(body, open);
  if (mine.length) body.appendChild(card([el("p", { text: "Your last application was not approved: " + (mine[0].decision || "no reason given") + ". You can apply again with better documents." })]));
  return findView(body);
}

async function findView(body) {
  setTitle("Find your group", "Claim it if it is listed, or ask to be listed.");
  DIR = DIR || await directory();
  const q = el("input", { type: "search", placeholder: "Group name, town or AWBI code", "aria-label": "Find your group" });
  const out = el("ul", { cls: "list" });
  const run = () => {
    clear(out);
    findGroups(q.value).forEach((o) => out.appendChild(el("li", { cls: "item" }, [
      el("div", { cls: "head static" }, [
        el("div", { cls: "body" }, [el("div", { cls: "nm", text: o.n }),
          el("div", { cls: "meta" }, [el("span", { text: [o.a, o.d !== "Unknown" ? o.d : "", o.st].filter(Boolean).join(", ") }),
            o.ac ? el("span", { cls: "chip awbi", text: "AWBI " + o.ac }) : null])]),
        el("button", { cls: "pill blue", type: "button", text: "This is us", on: { click: () => form(body, "claim", o) } })
      ])
    ])));
  };
  let t; q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(run, 150); });
  const g = params.get("g");
  const pre = g ? DIR.orgs.find((o) => o._id === g) : null;
  if (pre) return form(body, "claim", pre);
  body.appendChild(card([el("div", { cls: "label", text: "Search the directory" }), q, out,
    expander("We are not listed", el("div", null, [el("button", { cls: "pill", type: "button", text: "Ask to be listed", on: { click: () => form(body, "new", null) } })]))]));
  q.focus();
}

function stateDistrict(stateVal, districtVal) {
  const states = Object.keys(DIR.meta.states).sort();
  const st = select([["", "State"]].concat(states.map((s) => [s, s])), stateVal || "");
  const di = select([["", "District"]], "");
  const fill = () => {
    clear(di);
    di.appendChild(el("option", { value: "", text: "District" }));
    (DIR.meta.states[st.value] || []).map((d) => d[0]).sort().forEach((d) => di.appendChild(el("option", { value: d, text: d, selected: d === districtVal })));
  };
  st.addEventListener("change", fill); fill();
  return [st, di];
}

async function form(body, kind, o, existing) {
  DIR = DIR || await directory();
  clear(body);
  setTitle(kind === "claim" ? "Claim " + o.n : existing ? "Update your application" : "Ask to be listed",
    "Takes about 5 minutes. Keep a photo of your registration certificate ready.");
  const a = existing || {};
  const name = el("input", { value: a.name || (o ? o.n : ""), maxlength: "200", readonly: kind === "claim" ? true : null });
  const [st, di] = stateDistrict(a.state || (o ? o.st : ""), a.district || (o && o.d !== "Unknown" ? o.d : ""));
  const town = el("input", { value: a.town || (o ? o.a || "" : ""), maxlength: "120" });
  const address = el("textarea", { rows: "2", maxlength: "500" }); address.value = a.address || (o ? o.ad || "" : "");
  const role = el("input", { value: a.role || "", maxlength: "100", placeholder: "Founder, trustee, secretary..." });
  const regType = select(REG_TYPES, a.regType || (o && o.ac ? "awbi" : "trust"));
  const regNumber = el("input", { value: a.regNumber || (o && o.ac ? o.ac : ""), maxlength: "80" });
  const phone = el("input", { type: "tel", value: a.phone || (o && o.p ? o.p[0] || "" : ""), maxlength: "30" });
  const officialEmail = el("input", { type: "email", value: a.officialEmail || (o && o.e ? o.e[0] || "" : ""), maxlength: "200" });
  const website = el("input", { type: "url", value: a.website || (o ? o.w || "" : ""), maxlength: "300", placeholder: "https://" });
  const about = el("textarea", { rows: "4", maxlength: "2000", placeholder: "What you do, which animals, since when, how many in your care." }); about.value = a.about || "";
  const voucher = el("input", { type: "email", value: a.voucherEmail || "", maxlength: "200", placeholder: "Optional" });
  const files = el("input", { type: "file", accept: "image/jpeg,image/png,image/webp,application/pdf", multiple: true });
  const drive = el("input", { type: "url", value: a.driveLink || "", maxlength: "500", placeholder: "Optional: a Google Drive folder you share with us" });
  const declare = el("input", { type: "checkbox" });
  const submit = el("button", { cls: "pill blue", type: "button", text: existing ? "Send update" : "Send for verification" });

  submit.addEventListener("click", async () => {
    if (!name.value.trim() || !st.value || !di.value) return toast("Fill in the name, state and district.");
    if (regNumber.value.trim().length < 3) return toast("Add your registration number.");
    if (!existing && !declare.checked) return toast("Please tick the declaration.");
    if (!guardMoney(about.value, address.value, role.value, name.value)) return;
    const picked = Array.from(files.files || []).slice(0, 6 - (a.proofs || []).length);
    if (!existing && !picked.length && !drive.value.trim()) return toast("Add at least one document photo, or a Drive link.");
    busy(submit, true, "Sending...");
    try {
      const ids = (a.proofs || []).slice();
      for (let i = 0; i < picked.length; i++) {
        submit.textContent = "Uploading " + (i + 1) + " of " + picked.length + "...";
        ids.push(await B.addProof(await fileToDataUrl(picked[i]), picked[i].name.slice(0, 120), st.value, di.value));
      }
      const data = {
        about: about.value.trim(), address: address.value.trim(), regNumber: regNumber.value.trim(), regType: regType.value,
        phone: phone.value.trim(), officialEmail: officialEmail.value.trim().toLowerCase(), website: website.value.trim(),
        voucherEmail: voucher.value.trim().toLowerCase(), proofs: ids, driveLink: drive.value.trim(), town: town.value.trim()
      };
      if (existing) await B.updateMine(existing.id, data);
      else {
        const gid = kind === "claim" ? o._id : gidOf({ n: name.value.trim(), d: di.value, st: st.value });
        await B.apply(Object.assign(data, {
          kind, gid, name: name.value.trim(), state: st.value, district: di.value, role: role.value.trim(),
          awbiCode: regType.value === "awbi" ? regNumber.value.trim() : "", declaration: true
        }));
      }
      toast("Sent. Check back here to see how it is going.");
      await route();
    } catch (e) { toast(errText(e)); busy(submit, false, existing ? "Send update" : "Send for verification"); }
  });

  body.appendChild(card([
    el("div", { cls: "label", text: "Your group" }),
    el("div", { cls: "grid2" }, [field("Name", name), field("Your role", role), field("State", st), field("District", di),
      field("Town or area", town), field("Phone (official)", phone)]),
    field("Address", address),
    field("What you do", about, "No requests for money. Needs are posted as items or help once you are verified."),
    expander("Email and website", el("div", { cls: "grid2" }, [field("Email (official)", officialEmail), field("Website or page", website)]), !!(a.officialEmail || a.website))
  ]));
  body.appendChild(card([
    el("div", { cls: "label", text: "Proof" }),
    el("div", { cls: "grid2" }, [field("Registration", regType), field("Number", regNumber, "AWBI code, Darpan ID or certificate number")]),
    field("Photos or PDF of the certificate", files, "Up to 6. Trust deed, registration certificate, AWBI letter, 12A or 80G."),
    a.proofs && a.proofs.length ? el("p", { cls: "fhint", text: a.proofs.length + " document(s) already sent." }) : null,
    expander("Share a Drive folder instead", field("Drive link", drive), !!a.driveLink)
  ]));
  body.appendChild(card([
    el("div", { cls: "label", text: "Who can vouch for you" }),
    field("Email of a coordinator or a verified group that knows your work", voucher, "Leave blank and a coordinator for your district will get in touch."),
    existing ? null : el("label", { cls: "check" }, [declare, el("span", { text: "We are a genuine animal welfare group. We will never use this platform to ask for money. False information means removal." })]),
    el("div", { cls: "row-actions" }, [submit])
  ]));
}

function step(done, label, detail, state) {
  return el("li", { cls: "step " + (state || (done ? "done" : "")) }, [
    el("span", { cls: "dot" }), el("div", null, [el("div", { text: label }), detail ? el("div", { cls: "fhint", text: detail }) : null])
  ]);
}

async function statusView(body, a) {
  setTitle(a.name, STATUS_LABEL[a.status] || a.status);
  const steps = el("ol", { cls: "steps" }, [
    step(true, "Sent", fmtDate(a.createdAt)),
    step(!!a.docsOk, "Documents checked", a.status === "info_needed" ? "More information needed: " + (a.decision || a.docsNote || "") : a.docsOk ? "" : "An admin will check them.", a.status === "info_needed" ? "warn" : ""),
    step(!!(a.vouch && a.vouch.ok), "Vouched", a.vouch ? (a.vouch.ok ? "By " + a.vouch.email : "Could not vouch: " + (a.vouch.note || "")) : "Waiting for " + (a.voucherEmail || "a coordinator for " + a.district), a.vouch && !a.vouch.ok ? "warn" : ""),
    a.needsVisit ? step(!!(a.visit && a.visit.ok), "Visit or video call", a.visit ? (a.visit.ok ? "Done" : "Not passed: " + (a.visit.note || "")) : "A coordinator will contact you.") : null,
    step(a.status === "verified", a.status === "rejected" ? "Not approved" : "Verified", a.status === "rejected" ? a.decision || "" : "", a.status === "rejected" ? "warn" : "")
  ]);
  body.appendChild(card([el("div", { cls: "label", text: "Where it stands" }), steps]));
  if (a.status === "submitted" || a.status === "info_needed") {
    body.appendChild(card([expander("Update your application", el("div", null, [
      el("button", { cls: "pill", type: "button", text: "Edit and resend", on: { click: () => form(body, a.kind, null, a) } })
    ]), a.status === "info_needed")]));
  }
}

// ------------------------------------------------------------------ verified group
async function memberHome(body, gid) {
  gid = gid || roles.member.gid;
  const p = await B.profile(gid);
  if (!p) return body.appendChild(card([el("p", { text: "Your profile could not be loaded." })]));
  setTitle(p.name, "Verified. Keep your details, capacity and needs current.");
  const tabs = el("nav", { cls: "types sub" });
  const inner = el("div");
  const parts = [["profile", "Profile", profileForm], ["capacity", "Capacity", capacityForm], ["needs", "Needs", needsList]];
  const show = (k) => {
    Array.from(tabs.children).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.k === k)));
    clear(inner); parts.find((x) => x[0] === k)[2](inner, p);
  };
  parts.forEach(([k, l]) => tabs.appendChild(el("button", { cls: "pill", type: "button", "data-k": k, text: l, on: { click: () => show(k) } })));
  body.appendChild(tabs); body.appendChild(inner); show("needs");
}

function listInput(arr) { return el("input", { value: (arr || []).join(", "), maxlength: "300" }); }
function listValue(inp) { return inp.value.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 5); }

function profileForm(box, p) {
  const about = el("textarea", { rows: "4", maxlength: "2000" }); about.value = p.about || "";
  const hours = el("input", { value: p.hours || "", maxlength: "300", placeholder: "e.g. 8am to 6pm, emergencies any time" });
  const phones = listInput(p.phones), emails = listInput(p.emails);
  const website = el("input", { type: "url", value: p.website || "", maxlength: "300" });
  const save = el("button", { cls: "pill blue", type: "button", text: "Save" });
  save.addEventListener("click", async () => {
    if (!guardMoney(about.value, hours.value)) return;
    busy(save, true, "Saving...");
    try {
      await B.saveProfile(p.id, { about: about.value.trim(), hours: hours.value.trim(), phones: listValue(phones), emails: listValue(emails), website: website.value.trim() });
      Object.assign(p, { about: about.value.trim(), hours: hours.value.trim() });
      toast("Saved.");
    } catch (e) { toast(errText(e)); }
    busy(save, false, "Save");
  });
  box.appendChild(card([field("About", about), field("Hours", hours),
    el("div", { cls: "grid2" }, [field("Phones (comma separated)", phones), field("Emails (comma separated)", emails)]),
    field("Website or page", website), el("div", { cls: "row-actions" }, [save])]));
}

function capacityForm(box, p) {
  const c = p.capacity || {};
  const intake = select([["open", "Taking animals in"], ["limited", "Limited space"], ["full", "Full right now"]], c.intake || "open");
  const note = el("input", { value: c.note || "", maxlength: "300", placeholder: "e.g. Dogs and cats only; no large animals this week" });
  const save = el("button", { cls: "pill blue", type: "button", text: "Update" });
  save.addEventListener("click", async () => {
    if (!guardMoney(note.value)) return;
    busy(save, true, "Saving...");
    try { await B.saveProfile(p.id, { capacity: { intake: intake.value, note: note.value.trim() } }); p.capacity = { intake: intake.value, note: note.value.trim() }; toast("Capacity updated."); }
    catch (e) { toast(errText(e)); }
    busy(save, false, "Update");
  });
  box.appendChild(card([el("div", { cls: "label", text: "Can you take animals in?" }), field("Status", intake), field("Note", note),
    el("div", { cls: "row-actions" }, [save])]));
}

async function needsList(box, p) {
  const all = (await B.needsFor(p.id)).filter((n) => n.status !== "removed")
    .sort((a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1));
  const kind = select(NEED_KINDS, "supplies");
  const text = el("textarea", { rows: "3", maxlength: "600", placeholder: "What exactly, how much, and how people can bring it." });
  const urgent = el("input", { type: "checkbox" });
  const days = select([["7", "1 week"], ["14", "2 weeks"], ["30", "1 month"]], "14");
  const post = el("button", { cls: "pill blue", type: "button", text: "Post need" });
  post.addEventListener("click", async () => {
    if (text.value.trim().length < 5) return toast("Describe what you need.");
    if (!guardMoney(text.value)) return;
    busy(post, true, "Posting...");
    try { await B.postNeed(p, kind.value, text.value.trim(), urgent.checked, Number(days.value)); toast("Posted."); clear(box); await needsList(box, p); }
    catch (e) { toast(errText(e)); busy(post, false, "Post need"); }
  });
  box.appendChild(card([expander("Post a need (items or help, never money)", el("div", null, [
    el("div", { cls: "grid2" }, [field("Kind", kind), field("Show for", days)]), field("Details", text),
    el("label", { cls: "check" }, [urgent, el("span", { text: "Urgent" })]), el("div", { cls: "row-actions" }, [post])
  ]), !all.length)]));
  const ul = el("ul", { cls: "list" });
  all.forEach((n) => {
    const label = (NEED_KINDS.find((k) => k[0] === n.kind) || [0, n.kind])[1];
    const acts = n.status === "open" ? el("div", { cls: "row-actions" }, [
      el("button", { cls: "pill", type: "button", text: "Met", on: { click: async () => { await B.setNeed(n.id, "met").catch((e) => toast(errText(e))); clear(box); needsList(box, p); } } }),
      el("button", { cls: "pill", type: "button", text: "Close", on: { click: async () => { await B.setNeed(n.id, "closed").catch((e) => toast(errText(e))); clear(box); needsList(box, p); } } })
    ]) : el("span", { cls: "muted", text: n.status === "met" ? "Met" : "Closed" });
    ul.appendChild(el("li", { cls: "item" }, [el("div", { cls: "head static" }, [el("div", { cls: "body" }, [
      el("div", { cls: "nm", text: label + (n.urgent ? " (urgent)" : "") }), el("div", { text: n.text }),
      el("div", { cls: "fhint", text: "Until " + fmtDate(n.expiresAt) })]), acts])]));
  });
  if (all.length) box.appendChild(ul);
}

// ------------------------------------------------------------------ vouching and visits
async function vouchView(body) {
  setTitle("Vouch and visits", "Only vouch for groups you know first-hand.");
  const seen = {}, apps = [];
  const add = (list) => list.forEach((a) => { if (!seen[a.id] && a.uid !== user.uid && !["verified", "rejected"].includes(a.status)) { seen[a.id] = 1; apps.push(a); } });
  if (roles.member) add(await B.forVoucher());
  if (roles.coordinator) add(await B.forCoordinator(roles.coordinator));
  if (!apps.length) return body.appendChild(card([el("p", { cls: "muted", text: "Nothing waiting for you." })]));
  const ul = el("ul", { cls: "list" });
  apps.forEach((a) => ul.appendChild(vouchItem(a)));
  body.appendChild(ul);
}

function vouchItem(a) {
  const li = el("li", { cls: "item open" });
  const note = el("textarea", { rows: "2", maxlength: "1000", placeholder: "How you know them, what you have seen." });
  const acts = el("div", { cls: "row-actions" });
  const done = (msg) => { clear(acts).appendChild(el("span", { cls: "muted", text: msg })); };
  if (!a.vouch || a.vouch.by !== user.uid) {
    acts.appendChild(el("button", { cls: "pill blue", type: "button", text: "I know them: vouch", on: { click: async () => {
      if (!note.value.trim()) return toast("Add a line on how you know them.");
      try { await B.vouch(a, true, note.value.trim()); done("Vouched. Thank you."); } catch (e) { toast(errText(e)); } } } }));
    acts.appendChild(el("button", { cls: "pill", type: "button", text: "I can't vouch", on: { click: async () => {
      try { await B.vouch(a, false, note.value.trim()); done("Recorded."); } catch (e) { toast(errText(e)); } } } }));
  } else acts.appendChild(el("span", { cls: "muted", text: a.vouch.ok ? "You vouched." : "You could not vouch." }));
  const visitBox = el("div");
  if (roles.coordinator && a.status === "visit_required" && !(a.visit && a.visit.ok)) {
    const how = select([["site", "Site visit"], ["video", "Video call"]], "site");
    const vnote = el("textarea", { rows: "2", maxlength: "1000", placeholder: "What you saw: animals, conditions, people." });
    visitBox.appendChild(expander("Record the visit", el("div", null, [field("How", how), field("Notes", vnote), el("div", { cls: "row-actions" }, [
      el("button", { cls: "pill blue", type: "button", text: "Visit passed", on: { click: async () => { try { await B.visit(a, true, how.value, vnote.value.trim()); toast("Visit recorded."); } catch (e) { toast(errText(e)); } } } }),
      el("button", { cls: "pill", type: "button", text: "Visit not passed", on: { click: async () => { try { await B.visit(a, false, how.value, vnote.value.trim()); toast("Recorded."); } catch (e) { toast(errText(e)); } } } })
    ])])));
  }
  li.appendChild(el("div", { cls: "detail" }, [appSummary(a), roles.coordinator ? proofList(B, a) : null, field("Your note", note), acts, visitBox]));
  return li;
}

// ------------------------------------------------------------------ reports
function reportView(gid, name) {
  setTitle("Report a problem", name ? "About " + name : "");
  const reason = select(REPORT_REASONS, "wrong");
  const text = el("textarea", { rows: "4", maxlength: "2000", placeholder: "What is wrong? Admins read every report." });
  const send = el("button", { cls: "pill blue", type: "button", text: "Send report" });
  send.addEventListener("click", async () => {
    busy(send, true, "Sending...");
    try { await B.report(gid, name, reason.value, text.value.trim()); clear(view).appendChild(card([el("p", { text: "Thank you. An admin will look into it." }), el("a", { cls: "pill", href: "./", text: "Back to the directory" })])); }
    catch (e) { toast(errText(e)); busy(send, false, "Send report"); }
  });
  clear(view).appendChild(card([field("What kind of problem", reason), field("Details", text), el("div", { cls: "row-actions" }, [send])]));
}

start();
