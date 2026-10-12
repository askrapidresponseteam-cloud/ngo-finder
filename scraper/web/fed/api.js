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

function now() { return fb.serverTimestamp(); }
function snapList(s) { return s.docs.map((d) => Object.assign({ id: d.id }, d.data())); }
async function exists(path) {
  try { return (await fb.getDoc(fb.doc(db, path))).exists(); } catch (e) { return false; }
}

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
    try { await fb.getDoc(fb.doc(db, "config/admins")); admin = true; } catch (e) { admin = false; }
    try { const c = await fb.getDoc(fb.doc(db, "coordinators/" + email)); if (c.exists()) coordinator = c.data(); } catch (e) { /* none */ }
    try { const m = await fb.getDoc(fb.doc(db, "members/" + u.uid)); if (m.exists()) member = m.data(); } catch (e) { /* none */ }
    return { admin, coordinator, member };
  },

  // ------------------------------------------------------------ applications
  async apply(data) {
    const u = auth.currentUser;
    const rec = Object.assign({}, data, {
      uid: u.uid, email: (u.email || "").toLowerCase(), status: "submitted", createdAt: now(), updatedAt: now()
    });
    const ref = await fb.addDoc(fb.collection(db, "applications"), rec);
    return ref.id;
  },
  async myApplications() {
    const u = auth.currentUser;
    return snapList(await fb.getDocs(fb.query(fb.collection(db, "applications"), fb.where("uid", "==", u.uid))));
  },
  async updateMine(id, patch) {
    await fb.updateDoc(fb.doc(db, "applications/" + id), Object.assign({}, patch, { status: "submitted", updatedAt: now() }));
  },
  async forCoordinator(c) {
    const q = c.district === "*"
      ? fb.query(fb.collection(db, "applications"), fb.where("state", "==", c.state))
      : fb.query(fb.collection(db, "applications"), fb.where("state", "==", c.state), fb.where("district", "==", c.district));
    return snapList(await fb.getDocs(q));
  },
  async forVoucher() {
    const email = (auth.currentUser.email || "").toLowerCase();
    return snapList(await fb.getDocs(fb.query(fb.collection(db, "applications"), fb.where("voucherEmail", "==", email))));
  },
  async allApplications() {
    return snapList(await fb.getDocs(fb.query(fb.collection(db, "applications"), fb.orderBy("createdAt", "desc"), fb.limit(500))));
  },

  // Each review step writes its audit entry in the same batch (the rules check it).
  async _audit(batch, id, action, target, note) {
    if (await exists("audit/" + id)) return;
    const u = auth.currentUser;
    batch.set(fb.doc(db, "audit/" + id), { by: u.uid, email: (u.email || "").toLowerCase(), action, target, note: note || "", at: now() });
  },
  async vouch(app, ok, note) {
    const u = auth.currentUser, b = fb.writeBatch(db);
    b.update(fb.doc(db, "applications/" + app.id), {
      vouch: { ok: !!ok, by: u.uid, email: (u.email || "").toLowerCase(), note: note || "", at: now() }, updatedAt: now()
    });
    await this._audit(b, "vouch_" + app.id + "_" + u.uid, "vouch", app.id, (ok ? "vouched: " : "could not vouch: ") + (note || ""));
    await b.commit();
  },
  async visit(app, ok, how, note) {
    const u = auth.currentUser, b = fb.writeBatch(db);
    b.update(fb.doc(db, "applications/" + app.id), {
      visit: { ok: !!ok, by: u.uid, email: (u.email || "").toLowerCase(), note: note || "", how, at: now() }, updatedAt: now()
    });
    await this._audit(b, "visit_" + app.id + "_" + u.uid, "visit", app.id, how + (ok ? " ok: " : " not ok: ") + (note || ""));
    await b.commit();
  },
  // status: docs_ok | info_needed | visit_required | rejected | submitted
  async decide(app, patch) {
    const u = auth.currentUser, b = fb.writeBatch(db);
    b.update(fb.doc(db, "applications/" + app.id), Object.assign({ updatedAt: now(), reviewedBy: u.uid }, patch));
    await this._audit(b, "decide_" + app.id + "_" + patch.status + "_" + u.uid, "decide", app.id, patch.status + ": " + (patch.decision || patch.docsNote || ""));
    await b.commit();
  },
  async verify(app) {
    const u = auth.currentUser, b = fb.writeBatch(db);
    b.update(fb.doc(db, "applications/" + app.id), {
      status: "verified", docsOk: true, needsVisit: !!app.needsVisit, updatedAt: now(), reviewedBy: u.uid
    });
    await this._audit(b, "decide_" + app.id + "_verified_" + u.uid, "decide", app.id, "verified");
    b.set(fb.doc(db, "profiles/" + app.gid), {
      appId: app.id, name: app.name, state: app.state, district: app.district, town: app.town || "",
      about: app.about || "", hours: "", phones: app.phone ? [app.phone] : [], emails: app.officialEmail ? [app.officialEmail] : [],
      website: app.website || "", services: [], species: [], members: [app.uid], regType: app.regType, regNumber: app.regNumber,
      capacity: { intake: "open", note: "" }, verifiedAt: now(), updatedAt: now()
    });
    b.set(fb.doc(db, "members/" + app.uid), { gid: app.gid, email: app.email, appId: app.id, at: now() });
    b.set(fb.doc(db, "public/index"), { verified: { [app.gid]: { n: app.name, st: app.state, d: app.district } } }, { merge: true });
    await b.commit();
  },

  // Take a verified group off the public list (after a report, for example).
  async suspend(app, reason) {
    const u = auth.currentUser, b = fb.writeBatch(db);
    b.update(fb.doc(db, "applications/" + app.id), { status: "suspended", decision: reason, updatedAt: now(), reviewedBy: u.uid });
    await this._audit(b, "decide_" + app.id + "_suspended_" + u.uid, "decide", app.id, "suspended: " + reason);
    b.delete(fb.doc(db, "profiles/" + app.gid));
    b.delete(fb.doc(db, "members/" + app.uid));
    b.update(fb.doc(db, "public/index"), { ["verified." + app.gid]: fb.deleteField() });
    await b.commit();
  },

  // ------------------------------------------------------------ proofs
  async addProof(dataUrl, name, state, district) {
    const u = auth.currentUser;
    const type = dataUrl.slice(5, dataUrl.indexOf(";"));
    const ref = await fb.addDoc(fb.collection(db, "proofs"), { uid: u.uid, name, type, data: dataUrl, state, district, createdAt: now() });
    return ref.id;
  },
  async proof(id) {
    const s = await fb.getDoc(fb.doc(db, "proofs/" + id));
    return s.exists() ? Object.assign({ id }, s.data()) : null;
  },

  // ------------------------------------------------------------ profiles, needs
  async publicIndex() {
    const s = await fb.getDoc(fb.doc(db, "public/index"));
    return s.exists() ? s.data() : { verified: {} };
  },
  async profile(gid) {
    const s = await fb.getDoc(fb.doc(db, "profiles/" + gid));
    return s.exists() ? Object.assign({ id: gid }, s.data()) : null;
  },
  async saveProfile(gid, patch) {
    await fb.updateDoc(fb.doc(db, "profiles/" + gid), Object.assign({}, patch, { updatedAt: now() }));
  },
  async needsFor(gid) {
    return snapList(await fb.getDocs(fb.query(fb.collection(db, "needs"), fb.where("gid", "==", gid))));
  },
  async openNeeds(state, district) {
    let q = fb.query(fb.collection(db, "needs"), fb.where("status", "==", "open"));
    if (state) q = fb.query(q, fb.where("state", "==", state));
    if (district) q = fb.query(q, fb.where("district", "==", district));
    const t = Date.now();
    return snapList(await fb.getDocs(fb.query(q, fb.limit(300)))).filter((n) => n.expiresAt && n.expiresAt.toMillis() > t);
  },
  async postNeed(profile, kind, text, urgent, days) {
    const u = auth.currentUser;
    await fb.addDoc(fb.collection(db, "needs"), {
      gid: profile.id, name: profile.name, state: profile.state, district: profile.district, kind, text, urgent: !!urgent,
      status: "open", by: u.uid, createdAt: now(), expiresAt: fb.Timestamp.fromMillis(Date.now() + Math.min(30, Math.max(1, days)) * 864e5)
    });
  },
  async setNeed(id, status) { await fb.updateDoc(fb.doc(db, "needs/" + id), { status }); },
  async removeNeed(id) { await fb.updateDoc(fb.doc(db, "needs/" + id), { status: "removed" }); },

  // ------------------------------------------------------------ reports, coordinators, audit
  async report(target, targetName, reason, text) {
    const u = auth.currentUser;
    await fb.addDoc(fb.collection(db, "reports"), {
      target, targetName, reason, text, uid: u.uid, email: (u.email || "").toLowerCase(), status: "open", createdAt: now()
    });
  },
  async reports() {
    return snapList(await fb.getDocs(fb.query(fb.collection(db, "reports"), fb.where("status", "==", "open"))));
  },
  async resolveReport(id, resolution) {
    await fb.updateDoc(fb.doc(db, "reports/" + id), { status: "resolved", resolution, resolvedBy: auth.currentUser.uid, resolvedAt: now() });
  },
  async coordinators() { return snapList(await fb.getDocs(fb.collection(db, "coordinators"))); },
  async setCoordinator(email, state, district, name) {
    const b = fb.writeBatch(db), u = auth.currentUser;
    b.set(fb.doc(db, "coordinators/" + email.toLowerCase()), { state, district, name: name || "", by: u.uid, at: now() });
    b.set(fb.doc(fb.collection(db, "audit")), { by: u.uid, email: (u.email || "").toLowerCase(), action: "coordinator", target: email, note: state + " / " + district, at: now() });
    await b.commit();
  },
  async removeCoordinator(email) {
    const b = fb.writeBatch(db), u = auth.currentUser;
    b.delete(fb.doc(db, "coordinators/" + email));
    b.set(fb.doc(fb.collection(db, "audit")), { by: u.uid, email: (u.email || "").toLowerCase(), action: "coordinator removed", target: email, note: "", at: now() });
    await b.commit();
  },
  async auditLog() {
    return snapList(await fb.getDocs(fb.query(fb.collection(db, "audit"), fb.orderBy("at", "desc"), fb.limit(200))));
  }
};
