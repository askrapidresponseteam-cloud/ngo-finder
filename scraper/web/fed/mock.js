// In-memory stand-in for api.js, only for trying the pages on localhost:
//   join.html?mock=1&as=applicant|member|coord   admin.html?mock=1&as=admin
// It mimics the shapes, not the security rules (those are tested on the emulator).
const params = new URLSearchParams(location.search);
const who = params.get("as") || "applicant";
const T = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) });
const now = () => T(Date.now());
const USERS = {
  applicant: { uid: "alice", email: "alice@example.org" },
  member: { uid: "vik", email: "vik@example.org" },
  coord: { uid: "cora", email: "cora@example.org" },
  admin: { uid: "owner", email: "owner@example.org" },
  newbie: { uid: "nina", email: "nina@example.org" }
};
const store = {
  applications: {
    a1: { uid: "alice", email: "alice@example.org", kind: "claim", gid: "awbi-ka064-2014", name: "Amruthadhara Gaushala",
      state: "Karnataka", district: "Udupi", town: "Kundapura", address: "Alvegadde, Kundapura", role: "Founder",
      regType: "awbi", regNumber: "KA064/2014", awbiCode: "KA064/2014", phone: "", officialEmail: "", website: "",
      about: "Cows rescued from the highway.", voucherEmail: "vik@example.org", proofs: ["p1"], driveLink: "",
      declaration: true, status: "submitted", createdAt: T(Date.now() - 864e5 * 2), updatedAt: now() },
    a2: { uid: "zed", email: "zed@example.org", kind: "new", gid: "paws-of-mangaluru--dakshina-kannada--karnataka",
      name: "Paws of Mangaluru", state: "Karnataka", district: "Dakshina Kannada", town: "Mangaluru", address: "Kadri",
      role: "Trustee", regType: "trust", regNumber: "DK/123/2019", awbiCode: "", phone: "+91 90000 00000",
      officialEmail: "hello@paws.example", website: "", about: "Street dog rescue and sterilisation.",
      voucherEmail: "", proofs: [], driveLink: "https://drive.google.com/x", declaration: true, status: "docs_ok", docsOk: true,
      vouch: { ok: true, by: "cora", email: "cora@example.org", note: "Know them for years", at: now(), role: "coordinator" },
      createdAt: T(Date.now() - 864e5 * 5), updatedAt: now() }
  },
  proofs: { p1: { uid: "alice", name: "registration.jpg", type: "image/png", data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" } },
  profiles: {
    "awbi-ka004-1993": { name: "Compassion Unlimited Plus Action", state: "Karnataka", district: "Bengaluru Urban", about: "Rescue and rehab.",
      hours: "9 to 6", phones: ["+91 80 2294 7300"], emails: [], website: "", services: [], species: [], members: ["vik"],
      capacity: { intake: "limited", note: "Dogs only this week", updatedAt: now() }, verifiedAt: now(), updatedAt: now() }
  },
  needs: {
    n1: { gid: "awbi-ka004-1993", name: "Compassion Unlimited Plus Action", state: "Karnataka", district: "Bengaluru Urban",
      kind: "supplies", text: "Old bedsheets and towels for the monsoon", urgent: true, status: "open", by: "vik",
      createdAt: now(), expiresAt: T(Date.now() + 864e5 * 10) }
  },
  reports: { r1: { target: "awbi-ka064-2014", targetName: "Amruthadhara Gaushala", reason: "wrong", text: "Phone number is old", status: "open", email: "x@example.org", createdAt: now() } },
  coordinators: { "cora@example.org": { state: "Karnataka", district: "Udupi", name: "Cora" } },
  checks: { "awbi-ka004-1993_zed": { gid: "awbi-ka004-1993", uid: "zed", ok: true, why: "", at: T(Date.now() - 864e5) } },
  comments: {
    "awbi-ka004-1993_zed": { gid: "awbi-ka004-1993", gname: "Compassion Unlimited Plus Action", state: "Karnataka", district: "Bengaluru Urban",
      uid: "zed", name: "Zed", text: "Called the rescue line at 8 pm, they picked up and sent the ambulance.", contact: "", status: "approved", at: T(Date.now() - 864e5) },
    "awbi-ka064-2014_zed": { gid: "awbi-ka064-2014", gname: "Amruthadhara Gaushala", state: "Karnataka", district: "Udupi",
      uid: "zed", name: "Zed", text: "The number on the AWBI list is old.", contact: "+91 90000 11111", status: "pending", at: now() }
  },
  outreach: {
    o1: { gid: "awbi-ka004-1993", gname: "Compassion Unlimited Plus Action", state: "Karnataka", district: "Bengaluru Urban",
      person: "Front desk", method: "phone", when: "2026-10-10", response: "yes", phone: "+91 98454 25678", email: "", website: "",
      comments: "Confirmed the 24 hour rescue line.", rev: 0, createdBy: "owner", createdByEmail: "owner@example.org", createdAt: T(Date.now() - 864e5 * 2), updatedAt: T(Date.now() - 864e5 * 2) },
    o2: { gid: "awbi-ka064-2014", gname: "Amruthadhara Gaushala", state: "Karnataka", district: "Udupi",
      person: "", method: "email", when: "2026-10-11", response: "no", phone: "", email: "", website: "",
      comments: "Sent the claim invite, no reply yet.", rev: 0, createdBy: "owner", createdByEmail: "owner@example.org", createdAt: T(Date.now() - 864e5), updatedAt: T(Date.now() - 864e5) }
  },
  contacts: {},
  suggestions: { s1: { name: "Almighty Animal Sanctuary Trust", state: "Tamil Nadu", district: "Thiruvallur", town: "Sendrayanapalayam",
    phone: "+91 89393 20846", email: "", website: "https://www.almightyanimalsanctuary.org/", about: "500+ rescued animals",
    uid: "zed", byEmail: "zed@example.org", status: "new", createdAt: T(Date.now() - 36e5) } },
  extras: {},
  admins: ["admin2@example.org"],
  audit: [],
  public: { verified: { "awbi-ka004-1993": { n: "Compassion Unlimited Plus Action" } } }
};
let user = null, listeners = [];
const list = (o) => Object.keys(o).map((id) => Object.assign({ id }, o[id]));
const log = (action, target, note) => store.audit.unshift({ by: user.uid, email: user.email, action, target, note, at: now() });
const wait = () => new Promise((r) => setTimeout(r, 60));

export const mock = {
  onUser(cb) { listeners.push(cb); setTimeout(() => cb(user), 0); return () => {}; },
  user() { return user; },
  async signInGoogle() { user = USERS[who]; listeners.forEach((f) => f(user)); },
  async sendLink() { await wait(); },
  async finishLink() { return false; },
  async signOut() { user = null; listeners.forEach((f) => f(null)); },
  async roles() {
    return {
      admin: who === "admin",
      coordinator: who === "coord" ? { state: "Karnataka", district: "*" } : null,
      member: who === "member" ? { gid: "awbi-ka004-1993" } : null
    };
  },
  async apply(data) { await wait(); const id = "a" + Date.now(); store.applications[id] = Object.assign({}, data, { uid: user.uid, email: user.email, status: "submitted", createdAt: now(), updatedAt: now() }); return id; },
  async myApplications() { return list(store.applications).filter((a) => a.uid === user.uid); },
  async updateMine(app, patch) { Object.assign(store.applications[app.id], patch, { status: "submitted", docsOk: false, updatedAt: now() }); },
  async forCoordinator(c) { return list(store.applications).filter((a) => a.state === c.state && (c.district === "*" || a.district === c.district)); },
  async forVoucher() { return list(store.applications).filter((a) => a.voucherEmail === user.email); },
  async allApplications() { return list(store.applications); },
  async vouch(app, ok, note, role) { store.applications[app.id].vouch = { ok, by: user.uid, email: user.email, note, at: now(), role }; log("vouch", app.id, note); },
  async visit(app, ok, how, note) { store.applications[app.id].visit = { ok, by: user.uid, email: user.email, how, note, at: now() }; log("visit", app.id, note); },
  async decide(app, patch) { Object.assign(store.applications[app.id], patch, { updatedAt: now() }); log("decide", app.id, patch.status); },
  async verify(app) {
    const a = store.applications[app.id];
    if (!a.docsOk || !a.vouch || !a.vouch.ok || (a.vouch.role !== "coordinator" && !a.needsVisit) || (a.needsVisit && !(a.visit && a.visit.ok))) { const e = new Error("blocked"); e.code = "permission-denied"; throw e; }
    a.status = "verified";
    store.profiles[a.gid] = { name: a.name, state: a.state, district: a.district, about: a.about, hours: "", phones: [], emails: [], website: "", services: [], species: [], members: [a.uid], capacity: { intake: "open", note: "" }, verifiedAt: now(), updatedAt: now() };
    store.public.verified[a.gid] = { n: a.name };
    log("decide", app.id, "verified");
  },
  async suspend(app, reason) { const a = store.applications[app.id]; a.status = "suspended"; a.decision = reason; delete store.profiles[a.gid]; delete store.public.verified[a.gid]; log("decide", app.id, "suspended"); },
  async addProof(dataUrl, name) { const id = "p" + Date.now(); store.proofs[id] = { uid: user.uid, name, type: dataUrl.slice(5, dataUrl.indexOf(";")), data: dataUrl }; return id; },
  async proof(id) { return store.proofs[id] ? Object.assign({ id }, store.proofs[id]) : null; },
  async publicIndex() { return store.public; },
  async profile(gid) { return store.profiles[gid] ? Object.assign({ id: gid }, store.profiles[gid]) : null; },
  async saveProfile(gid, patch) { Object.assign(store.profiles[gid], patch, { updatedAt: now() }); },
  async needsFor(gid) { return list(store.needs).filter((n) => n.gid === gid); },
  async openNeeds(state, district) { return list(store.needs).filter((n) => n.status === "open" && (!state || n.state === state) && (!district || n.district === district)); },
  async postNeed(p, kind, text, urgent, days) { store.needs["n" + Date.now()] = { gid: p.id, name: p.name, state: p.state, district: p.district, kind, text, urgent, status: "open", by: user.uid, createdAt: now(), expiresAt: T(Date.now() + days * 864e5) }; },
  async setNeed(id, status) { store.needs[id].status = status; },
  async removeNeed(id) { store.needs[id].status = "removed"; },
  async report(target, targetName, reason, text) { store.reports["r" + Date.now()] = { target, targetName, reason, text, status: "open", email: user.email, createdAt: now() }; },
  async reports() { return list(store.reports).filter((r) => r.status === "open"); },
  async resolveReport(id, resolution) { Object.assign(store.reports[id], { status: "resolved", resolution }); },
  async coordinators() { return list(store.coordinators); },
  async setCoordinator(email, state, district, name) { store.coordinators[email] = { state, district, name }; log("coordinator", email, state); },
  async removeCoordinator(email) { delete store.coordinators[email]; log("coordinator removed", email, ""); },
  async checksFor(gid) { return list(store.checks).filter((c) => c.gid === gid); },
  async check(gid, ok, why) { store.checks[gid + "_" + user.uid] = { gid, uid: user.uid, ok, why: ok ? "" : why, at: now() }; },
  async commentsFor(gid) { return list(store.comments).filter((c) => c.gid === gid && c.status === "approved"); },
  async myComment(gid) { const id = gid + "_" + user.uid; return store.comments[id] ? Object.assign({ id }, store.comments[id]) : null; },
  async comment(o, text, contact) { store.comments[o.gid + "_" + user.uid] = { gid: o.gid, gname: o.name, state: o.state, district: o.district, uid: user.uid, name: "Alice", text, contact, status: "pending", at: now() }; },
  async pendingComments() { return list(store.comments).filter((c) => c.status === "pending"); },
  async moderate(c, status, note) { Object.assign(store.comments[c.id], { status, modBy: user.uid, modAt: now(), modNote: note }); },
  async outreachAll() { return list(store.outreach).sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis()); },
  async saveOutreach(rec, existing) {
    const id = existing ? existing.id : "o" + Date.now();
    const old = existing ? store.outreach[id] : null;
    store.outreach[id] = Object.assign({}, rec, old ? { createdBy: old.createdBy, createdByEmail: old.createdByEmail, createdAt: old.createdAt }
      : { createdBy: user.uid, createdByEmail: user.email, createdAt: now() }, { rev: old ? old.rev + 1 : 0, updatedBy: user.uid, updatedAt: now() });
    log(existing ? "outreach edited" : "outreach", id, rec.gname); return id;
  },
  async deleteOutreach(r) { delete store.outreach[r.id]; log("outreach deleted", r.id, r.gname); },
  async contactsFor(gid) { return store.contacts[gid] ? Object.assign({ id: gid }, store.contacts[gid]) : null; },
  async saveContacts(o, c, checkedOn) { store.contacts[o.gid] = { name: o.name, state: o.state, district: o.district, phones: c.phones, emails: c.emails, website: c.website, checkedOn, updatedAt: now() }; },
  async adminList() { return store.admins.slice(); },
  async setAdminList(emails) { store.admins = emails.slice(); },
  isOwner() { return who === "admin"; },
  async suggest(rec) { store.suggestions["s" + Date.now()] = Object.assign({}, rec, { uid: user.uid, byEmail: user.email, status: "new", createdAt: now() }); },
  async suggestions() { return list(store.suggestions).filter((s) => s.status === "new"); },
  async resolveSuggestion(id, status, resolution) { Object.assign(store.suggestions[id], { status, resolution }); log("suggestion " + status, id, resolution); },
  async publishExtra(gid, rec) { store.extras[gid] = Object.assign({}, rec, { addedAt: now() }); log("extra added", gid, rec.n); },
  async removeExtra(gid) { delete store.extras[gid]; },
  async extras() { return list(store.extras); },
  async auditLog() { return store.audit; }
};
