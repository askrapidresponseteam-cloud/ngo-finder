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
      vouch: { ok: true, by: "cora", email: "cora@example.org", note: "Know them for years", at: now() },
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
  async updateMine(id, patch) { Object.assign(store.applications[id], patch, { status: "submitted", updatedAt: now() }); },
  async forCoordinator(c) { return list(store.applications).filter((a) => a.state === c.state && (c.district === "*" || a.district === c.district)); },
  async forVoucher() { return list(store.applications).filter((a) => a.voucherEmail === user.email); },
  async allApplications() { return list(store.applications); },
  async vouch(app, ok, note) { store.applications[app.id].vouch = { ok, by: user.uid, email: user.email, note, at: now() }; log("vouch", app.id, note); },
  async visit(app, ok, how, note) { store.applications[app.id].visit = { ok, by: user.uid, email: user.email, how, note, at: now() }; log("visit", app.id, note); },
  async decide(app, patch) { Object.assign(store.applications[app.id], patch, { updatedAt: now() }); log("decide", app.id, patch.status); },
  async verify(app) {
    const a = store.applications[app.id];
    if (!a.docsOk || !a.vouch || !a.vouch.ok || (a.needsVisit && !(a.visit && a.visit.ok))) { const e = new Error("blocked"); e.code = "permission-denied"; throw e; }
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
  async auditLog() { return store.audit; }
};
