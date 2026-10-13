// Federation backend: Firebase Auth (Google or email link, no OTP) and Firestore.
// The security rules (firestore.rules) are the real gatekeeper; this file only
// shapes the calls. A local in-memory stand-in (mock.js) is used for testing
// on localhost with ?mock=1.
import { config } from "./config.js";

let fb = null, app = null, auth = null, db = null;
export const configured = !!(config && config.projectId);

async function load() {
  if (fb) return;
  fb = await import("../vendor/firebase.js");
  app = fb.initializeApp(config);
  auth = fb.getAuth(app);
  await fb.setPersistence(auth, fb.browserLocalPersistence);
  db = fb.getFirestore(app);
}

const isMock = () => /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && new URLSearchParams(location.search).has("mock");

export async function backend() {
  if (isMock()) return (await import("./mock.js")).mock;
  if (!configured) return null;
  await load();
  return api;
}

// Everything lives under ngo/dir/ in Rapid Response's Firebase project, apart
// from the app's own data (see firestore.rules).
const ROOT = "ngo/dir/";
const OWNER = "narenkumar19706@gmail.com";  // as in firestore.rules
function col(name) { return fb.collection(db, ROOT + name); }
function ref(p) { return fb.doc(db, ROOT + p); }
function now() { return fb.serverTimestamp(); }
// The name shown on a comment: a first name, never the email address.
function shortName(u) {
  const n = String((u && u.displayName) || "").trim().split(/\s+/)[0];
  return (n || "A visitor").slice(0, 40);
}
function snapList(s) { return s.docs.map((d) => Object.assign({ id: d.id }, d.data())); }

const api = {
  // ------------------------------------------------------------ auth
  onUser(cb) { return fb.onAuthStateChanged(auth, cb); },
  user() { return auth.currentUser; },
  signInGoogle() { return fb.signInWithPopup(auth, new fb.GoogleAuthProvider()); },
  async sendLink(email) {
    await fb.sendSignInLinkToEmail(auth, email, { url: location.origin + location.pathname + location.search, handleCodeInApp: true });
    try { localStorage.setItem("fedEmail", email); } catch (e) { /* private mode */ }
  },
  async finishLink() {
    if (!fb.isSignInWithEmailLink(auth, location.href)) return false;
    let email = "";
    try { email = localStorage.getItem("fedEmail") || ""; } catch (e) { /* ignore */ }
    if (!email) email = window.prompt("Confirm the email address you used") || "";
    if (!email) return false;
    await fb.signInWithEmailLink(auth, email, location.href);
    try { localStorage.removeItem("fedEmail"); } catch (e) { /* ignore */ }
    history.replaceState(null, "", location.pathname + location.search.replace(/[?&](apiKey|oobCode|mode|lang)=[^&]*/g, ""));
    return true;
  },
  signOut() { return fb.signOut(auth); },

  // What this person may do. Each check is a read the rules either allow or refuse.
  async roles() {
    const u = auth.currentUser;
    if (!u) return { admin: false, coordinator: null, member: null };
    const email = (u.email || "").toLowerCase();
    let admin = false, coordinator = null, member = null;
    try { await fb.getDoc(ref("config/admins")); admin = true; } catch (e) { admin = false; }
    try { const c = await fb.getDoc(ref("coordinators/" + email)); if (c.exists()) coordinator = c.data(); } catch (e) { /* none */ }
    try { const m = await fb.getDoc(ref("members/" + u.uid)); if (m.exists()) member = m.data(); } catch (e) { /* none */ }
    return { admin, coordinator, member };
  },

  // ------------------------------------------------------------ applications
  async apply(data) {
    const u = auth.currentUser;
    const rec = Object.assign({}, data, {
      uid: u.uid, email: (u.email || "").toLowerCase(), status: "submitted", rev: 0, createdAt: now(), updatedAt: now()
    });
    const added = await fb.addDoc(col("applications"), rec);
    return added.id;
  },
  async myApplications() {
    const u = auth.currentUser;
    return snapList(await fb.getDocs(fb.query(col("applications"), fb.where("uid", "==", u.uid))));
  },
  // Any change goes back to "submitted" and the documents get checked again.
  async updateMine(app, patch) {
    await fb.updateDoc(ref("applications/" + app.id), Object.assign({}, patch, {
      status: "submitted", docsOk: false, rev: (app.rev || 0) + 1, updatedAt: now()
    }));
  },
  async forCoordinator(c) {
    const q = c.district === "*"
      ? fb.query(col("applications"), fb.where("state", "==", c.state))
      : fb.query(col("applications"), fb.where("state", "==", c.state), fb.where("district", "==", c.district));
    return snapList(await fb.getDocs(q));
  },
  async forVoucher() {
    const email = (auth.currentUser.email || "").toLowerCase();
    return snapList(await fb.getDocs(fb.query(col("applications"), fb.where("voucherEmail", "==", email))));
  },
  async allApplications() {
    return snapList(await fb.getDocs(fb.query(col("applications"), fb.orderBy("createdAt", "desc"), fb.limit(500))));
  },

  // Each review step bumps the application's revision and writes its own audit
  // entry, named <step>_<application>_<revision>_<reviewer>, in the same batch.
  _step(b, app, action, patch, note) {
    const u = auth.currentUser, rev = (app.rev || 0) + 1;
    b.update(ref("applications/" + app.id), Object.assign({ updatedAt: now(), rev }, patch));
    b.set(ref("audit/" + action + "_" + app.id + "_" + rev + "_" + u.uid),
      { by: u.uid, email: (u.email || "").toLowerCase(), action, target: app.id, note: (note || "").slice(0, 1900), at: now() });
  },
  // role: "coordinator" (for that place) or "member" (of a verified group named by the applicant)
  async vouch(app, ok, note, role) {
    const u = auth.currentUser, b = fb.writeBatch(db);
    this._step(b, app, "vouch", { vouch: { ok: !!ok, by: u.uid, email: (u.email || "").toLowerCase(), note: note || "", at: now(), role } },
      (ok ? "vouched: " : "could not vouch: ") + (note || ""));
    await b.commit();
  },
  async visit(app, ok, how, note) {
    const u = auth.currentUser, b = fb.writeBatch(db);
    this._step(b, app, "visit", { visit: { ok: !!ok, by: u.uid, email: (u.email || "").toLowerCase(), note: note || "", how, at: now() } },
      how + (ok ? " passed: " : " not passed: ") + (note || ""));
    await b.commit();
  },
  // status: docs_ok | info_needed | visit_required | rejected | submitted
  async decide(app, patch) {
    const b = fb.writeBatch(db);
    this._step(b, app, "decide", Object.assign({ reviewedBy: auth.currentUser.uid }, patch), patch.status + ": " + (patch.decision || patch.docsNote || ""));
    await b.commit();
  },
  async verify(app) {
    const u = auth.currentUser, b = fb.writeBatch(db);
    this._step(b, app, "decide", { status: "verified", docsOk: true, needsVisit: !!app.needsVisit, reviewedBy: u.uid }, "verified");
    b.set(ref("profiles/" + app.gid), {
      appId: app.id, name: app.name, state: app.state, district: app.district, town: app.town || "",
      about: app.about || "", hours: "", phones: app.phone ? [app.phone] : [], emails: app.officialEmail ? [app.officialEmail] : [],
      website: app.website || "", members: [app.uid], regType: app.regType, regNumber: app.regNumber,
      capacity: { intake: "open", note: "" }, verifiedAt: now(), updatedAt: now()
    });
    b.set(ref("members/" + app.uid), { gid: app.gid, email: app.email, appId: app.id, at: now() });
    b.set(ref("public/index"), { verified: { [app.gid]: { n: app.name, st: app.state, d: app.district } }, last: app.gid }, { merge: true });
    await b.commit();
  },

  // Take a verified group off the public list (after a report, for example).
  async suspend(app, reason) {
    const u = auth.currentUser, b = fb.writeBatch(db);
    this._step(b, app, "decide", { status: "suspended", decision: reason, reviewedBy: u.uid }, "suspended: " + reason);
    b.delete(ref("profiles/" + app.gid));
    b.delete(ref("members/" + app.uid));
    b.update(ref("public/index"), { ["verified." + app.gid]: fb.deleteField(), last: app.gid });
    // Their open needs come down too.
    for (const n of await this.needsFor(app.gid)) {
      if (n.status === "open") b.update(ref("needs/" + n.id), { status: "removed" });
    }
    await b.commit();
  },

  // ------------------------------------------------------------ proofs
  // Proof ids are <uid>_0 to <uid>_29 (the rules allow no more per person).
  async addProof(dataUrl, name, state, district) {
    const u = auth.currentUser;
    const type = dataUrl.slice(5, dataUrl.indexOf(";"));
    const mine = await fb.getDocs(fb.query(col("proofs"), fb.where("uid", "==", u.uid)));
    const used = new Set(mine.docs.map((d) => d.id));
    let n = 0;
    while (used.has(u.uid + "_" + n)) n++;
    if (n >= 30) throw new Error("You have sent the maximum number of documents. Share a Drive folder instead.");
    const id = u.uid + "_" + n;
    await fb.setDoc(ref("proofs/" + id), { uid: u.uid, name, type, data: dataUrl, state, district, createdAt: now() });
    return id;
  },
  async proof(id) {
    const s = await fb.getDoc(ref("proofs/" + id));
    return s.exists() ? Object.assign({ id }, s.data()) : null;
  },

  // ------------------------------------------------------------ profiles, needs
  async publicIndex() {
    const s = await fb.getDoc(ref("public/index"));
    return s.exists() ? s.data() : { verified: {} };
  },
  async profile(gid) {
    const s = await fb.getDoc(ref("profiles/" + gid));
    return s.exists() ? Object.assign({ id: gid }, s.data()) : null;
  },
  async saveProfile(gid, patch) {
    await fb.updateDoc(ref("profiles/" + gid), Object.assign({}, patch, { updatedAt: now() }));
  },
  async needsFor(gid) {
    return snapList(await fb.getDocs(fb.query(col("needs"), fb.where("gid", "==", gid))));
  },
  async openNeeds(state, district) {
    let q = fb.query(col("needs"), fb.where("status", "==", "open"));
    if (state) q = fb.query(q, fb.where("state", "==", state));
    if (district) q = fb.query(q, fb.where("district", "==", district));
    const t = Date.now();
    return snapList(await fb.getDocs(fb.query(q, fb.limit(300)))).filter((n) => n.expiresAt && n.expiresAt.toMillis() > t);
  },
  async postNeed(profile, kind, text, urgent, days) {
    const u = auth.currentUser;
    await fb.addDoc(col("needs"), {
      gid: profile.id, name: profile.name, state: profile.state, district: profile.district, kind, text, urgent: !!urgent,
      status: "open", by: u.uid, createdAt: now(), expiresAt: fb.Timestamp.fromMillis(Date.now() + Math.min(30, Math.max(1, days)) * 864e5)
    });
  },
  async setNeed(id, status) { await fb.updateDoc(ref("needs/" + id), { status }); },
  async removeNeed(id) { await fb.updateDoc(ref("needs/" + id), { status: "removed" }); },

  // ------------------------------------------------------------ reports, coordinators, audit
  async report(target, targetName, reason, text) {
    const u = auth.currentUser;
    await fb.addDoc(col("reports"), {
      target, targetName, reason, text, uid: u.uid, email: (u.email || "").toLowerCase(), status: "open", createdAt: now()
    });
  },
  async reports() {
    return snapList(await fb.getDocs(fb.query(col("reports"), fb.where("status", "==", "open"))));
  },
  async resolveReport(id, resolution) {
    await fb.updateDoc(ref("reports/" + id), { status: "resolved", resolution, resolvedBy: auth.currentUser.uid, resolvedAt: now() });
  },
  async coordinators() { return snapList(await fb.getDocs(col("coordinators"))); },
  async setCoordinator(email, state, district, name) {
    const b = fb.writeBatch(db), u = auth.currentUser;
    b.set(ref("coordinators/" + email.toLowerCase()), { state, district, name: name || "", by: u.uid, at: now() });
    b.set(ref("audit/coordinator_" + Date.now() + "_" + u.uid), { by: u.uid, email: (u.email || "").toLowerCase(), action: "coordinator", target: email, note: state + " / " + district, at: now() });
    await b.commit();
  },
  async removeCoordinator(email) {
    const b = fb.writeBatch(db), u = auth.currentUser;
    b.delete(ref("coordinators/" + email));
    b.set(ref("audit/coordinator_" + Date.now() + "_" + u.uid), { by: u.uid, email: (u.email || "").toLowerCase(), action: "coordinator removed", target: email, note: "", at: now() });
    await b.commit();
  },
  // ------------------------------------------------------------ did you reach them? and comments
  async checksFor(gid) {
    return snapList(await fb.getDocs(fb.query(col("checks"), fb.where("gid", "==", gid))));
  },
  async check(gid, ok, why) {
    const u = auth.currentUser;
    await fb.setDoc(ref("checks/" + gid + "_" + u.uid), { gid, uid: u.uid, ok: !!ok, why: ok ? "" : (why || "other"), at: now() });
  },
  async commentsFor(gid) {
    return snapList(await fb.getDocs(fb.query(col("comments"), fb.where("gid", "==", gid), fb.where("status", "==", "approved"))));
  },
  async myComment(gid) {
    const s = await fb.getDoc(ref("comments/" + gid + "_" + auth.currentUser.uid));
    return s.exists() ? Object.assign({ id: s.id }, s.data()) : null;
  },
  async comment(o, text, contact) {
    const u = auth.currentUser;
    await fb.setDoc(ref("comments/" + o.gid + "_" + u.uid), {
      gid: o.gid, gname: o.name, state: o.state, district: o.district, uid: u.uid, name: shortName(u),
      text, contact: contact || "", status: "pending", at: now()
    });
  },
  async pendingComments() {
    return snapList(await fb.getDocs(fb.query(col("comments"), fb.where("status", "==", "pending"), fb.limit(200))));
  },
  async moderate(c, status, note) {
    await fb.updateDoc(ref("comments/" + c.id), { status, modBy: auth.currentUser.uid, modAt: now(), modNote: note || "" });
  },

  // ------------------------------------------------------------ outreach log (admins only)
  async outreachAll() {
    return snapList(await fb.getDocs(fb.query(col("outreach"), fb.orderBy("createdAt", "desc"), fb.limit(5000))));
  },
  // rec: gid, gname, state, district, person, method, when, response, phone, email, website, comments.
  // Each save bumps the revision and writes its own audit entry in the same batch.
  async saveOutreach(rec, existing) {
    const u = auth.currentUser, b = fb.writeBatch(db), mail = (u.email || "").toLowerCase();
    const id = existing ? existing.id : fb.doc(col("outreach")).id;
    const rev = existing ? (existing.rev || 0) + 1 : 0;
    const who = existing ? { createdBy: existing.createdBy, createdByEmail: existing.createdByEmail, createdAt: existing.createdAt }
      : { createdBy: u.uid, createdByEmail: mail, createdAt: now() };
    b.set(ref("outreach/" + id), Object.assign({}, rec, who, { rev, updatedBy: u.uid, updatedAt: now() }));
    b.set(ref("audit/outreach_" + id + "_" + rev + "_" + u.uid), { by: u.uid, email: mail, action: existing ? "outreach edited" : "outreach",
      target: id, note: (rec.gname + ": " + rec.method + ", " + rec.response).slice(0, 1900), at: now() });
    await b.commit();
    return id;
  },
  async deleteOutreach(r) {
    const u = auth.currentUser, b = fb.writeBatch(db);
    b.delete(ref("outreach/" + r.id));
    b.set(ref("audit/outreach_" + r.id + "_" + ((r.rev || 0) + 1) + "_" + u.uid), { by: u.uid, email: (u.email || "").toLowerCase(),
      action: "outreach deleted", target: r.id, note: (r.gname + " on " + r.when).slice(0, 1900), at: now() });
    await b.commit();
  },
  // Contact details an admin confirmed: public, shown in the directory.
  async contactsFor(gid) {
    const s = await fb.getDoc(ref("contacts/" + gid));
    return s.exists() ? Object.assign({ id: gid }, s.data()) : null;
  },
  async saveContacts(o, c, checkedOn) {
    await fb.setDoc(ref("contacts/" + o.gid), { name: o.name, state: o.state, district: o.district,
      phones: c.phones.slice(0, 3), emails: c.emails.slice(0, 3), website: c.website || "", checkedOn,
      updatedBy: auth.currentUser.uid, updatedAt: now() });
  },
  // The admin list (the owner manages it).
  async adminList() {
    const s = await fb.getDoc(ref("config/admins"));
    return s.exists() ? (s.data().emails || []) : [];
  },
  async setAdminList(emails) {
    await fb.setDoc(ref("config/admins"), { emails, updatedAt: now() });
  },
  isOwner() { return ((auth.currentUser && auth.currentUser.email) || "").toLowerCase() === OWNER; },

  // ------------------------------------------------------------ suggested groups and extra listings
  async suggest(rec) {
    const u = auth.currentUser;
    await fb.addDoc(col("suggestions"), Object.assign({}, rec, {
      uid: u.uid, byEmail: (u.email || "").toLowerCase(), status: "new", createdAt: now()
    }));
  },
  async suggestions() {
    return snapList(await fb.getDocs(fb.query(col("suggestions"), fb.where("status", "==", "new"), fb.limit(300))));
  },
  async resolveSuggestion(id, status, resolution) {
    await fb.updateDoc(ref("suggestions/" + id), { status, resolution: resolution || "",
      resolvedBy: auth.currentUser.uid, resolvedAt: now() });
  },
  // An extra public listing, checked by an admin (shown merged into the directory).
  async publishExtra(gid, rec) {
    await fb.setDoc(ref("extras/" + gid), Object.assign({}, rec, { addedBy: auth.currentUser.uid, addedAt: now() }));
  },
  async removeExtra(gid) { await fb.deleteDoc(ref("extras/" + gid)); },
  async extras() {
    return snapList(await fb.getDocs(fb.query(col("extras"), fb.limit(2000))));
  },

  async auditLog() {
    return snapList(await fb.getDocs(fb.query(col("audit"), fb.orderBy("at", "desc"), fb.limit(200))));
  }
};
