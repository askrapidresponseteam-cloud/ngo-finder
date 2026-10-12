// Security rules tests. Run on the Firestore emulator:
//   cd tests/rules && npm ci && npx firebase emulators:exec --project demo-ngo --config ../../firebase.json "node --test"
import { test, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, getDocs, collection, query, where, writeBatch,
  serverTimestamp, Timestamp
} from "firebase/firestore";

const OWNER = "narenkumar19706@gmail.com";
let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-ngo",
    firestore: { rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8") }
  });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

function as(uid, email, verified = true) {
  return env.authenticatedContext(uid, { email, email_verified: verified }).firestore();
}
const owner = () => as("owner", OWNER);
const admin2 = () => as("admin2", "admin2@example.org");
const applicant = () => as("alice", "alice@example.org");
const stranger = () => as("eve", "eve@example.org");
const coordUdupi = () => as("cora", "cora@example.org");
const verifiedMember = () => as("vik", "vik@example.org");
const anon = () => env.unauthenticatedContext().firestore();

async function seed(fn) {
  await env.withSecurityRulesDisabled(async (ctx) => { await fn(ctx.firestore()); });
}

function application(over = {}) {
  return Object.assign({
    uid: "alice", email: "alice@example.org", kind: "claim", gid: "awbi-ka064-2014",
    name: "Amruthadhara Gaushala", state: "Karnataka", district: "Udupi", town: "Kundapura",
    address: "Alvegadde, Kundapura", role: "Founder", regType: "awbi", regNumber: "KA064/2014",
    awbiCode: "KA064/2014", phone: "", officialEmail: "", website: "", about: "Cows rescued from the highway.",
    voucherEmail: "", proofs: [], driveLink: "", declaration: true, status: "submitted", rev: 0,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  }, over);
}

async function seedPeople() {
  await seed(async (db) => {
    await setDoc(doc(db, "coordinators/cora@example.org"), { state: "Karnataka", district: "Udupi", name: "Cora", by: "owner", at: Timestamp.now() });
    await setDoc(doc(db, "config/admins"), { emails: ["admin2@example.org"] });
    await setDoc(doc(db, "members/vik"), { gid: "awbi-ka004-1993", email: "vik@example.org", appId: "old", at: Timestamp.now() });
  });
}

async function seedApp(over = {}) {
  await seed(async (db) => {
    const a = application(over);
    a.createdAt = Timestamp.now(); a.updatedAt = Timestamp.now();
    await setDoc(doc(db, "applications/app1"), a);
  });
}

async function rev() {
  let r = 0;
  await env.withSecurityRulesDisabled(async (ctx) => { const d = await getDoc(doc(ctx.firestore(), "applications/app1")); r = (d.data() || {}).rev || 0; });
  return r + 1;
}

async function vouchBatch(db, uid, mail, ok = true, role = "coordinator") {
  const r = await rev(), b = writeBatch(db);
  b.update(doc(db, "applications/app1"), {
    vouch: { ok, by: uid, email: mail, note: "Visited them last year", at: serverTimestamp(), role },
    updatedAt: serverTimestamp(), rev: r
  });
  b.set(doc(db, "audit/vouch_app1_" + r + "_" + uid), { by: uid, email: mail, action: "vouch", target: "app1", note: "", at: serverTimestamp() });
  return b;
}

async function visitBatch(db, uid, mail, ok = true) {
  const r = await rev(), b = writeBatch(db);
  b.update(doc(db, "applications/app1"), { visit: { ok, by: uid, email: mail, note: "Saw 40 cows, clean shed", at: serverTimestamp(), how: "site" }, updatedAt: serverTimestamp(), rev: r });
  b.set(doc(db, "audit/visit_app1_" + r + "_" + uid), { by: uid, email: mail, action: "visit", target: "app1", note: "", at: serverTimestamp() });
  return b;
}

async function decideBatch(db, uid, mail, patch) {
  const r = await rev(), b = writeBatch(db);
  b.update(doc(db, "applications/app1"), Object.assign({ updatedAt: serverTimestamp(), reviewedBy: uid, rev: r }, patch));
  b.set(doc(db, "audit/decide_app1_" + r + "_" + uid), { by: uid, email: mail, action: "decide", target: "app1", note: patch.status, at: serverTimestamp() });
  return b;
}

function profileData(over = {}) {
  return Object.assign({
    appId: "app1", name: "Amruthadhara Gaushala", state: "Karnataka", district: "Udupi", town: "", about: "", hours: "",
    phones: [], emails: [], website: "", members: ["alice"], regType: "awbi", regNumber: "KA064/2014",
    capacity: { intake: "open", note: "" }, verifiedAt: serverTimestamp(), updatedAt: serverTimestamp()
  }, over);
}

async function verifyBatch(db, uid, mail, extra = {}) {
  const b = await decideBatch(db, uid, mail, Object.assign({ status: "verified", docsOk: true }, extra));
  b.set(doc(db, "profiles/awbi-ka064-2014"), profileData());
  b.set(doc(db, "members/alice"), { gid: "awbi-ka064-2014", email: "alice@example.org", appId: "app1", at: serverTimestamp() });
  b.set(doc(db, "public/index"), { verified: { "awbi-ka064-2014": { n: "Amruthadhara Gaushala", st: "Karnataka", d: "Udupi" } }, last: "awbi-ka064-2014" }, { merge: true });
  return b;
}

// ------------------------------------------------------------- applications
test("an applicant can apply, and only with a verified email", async () => {
  await assertSucceeds(setDoc(doc(applicant(), "applications/a1"), application()));
  await assertFails(setDoc(doc(as("bob", "bob@example.org", false), "applications/a2"), application({ uid: "bob", email: "bob@example.org" })));
  await assertFails(setDoc(doc(anon(), "applications/a3"), application()));
});

test("an applicant cannot apply as someone else, or start already verified", async () => {
  await assertFails(setDoc(doc(applicant(), "applications/a1"), application({ uid: "mallory" })));
  await assertFails(setDoc(doc(applicant(), "applications/a1"), application({ status: "verified" })));
  await assertFails(setDoc(doc(applicant(), "applications/a1"), application({ docsOk: true })));
  await assertFails(setDoc(doc(applicant(), "applications/a1"), application({ declaration: false })));
});

test("no money: payment details or fundraising in any text are refused", async () => {
  for (const bad of ["Please send donations to UPI gau@okaxis", "Bank account no 1234", "IFSC SBIN0001",
                     "Need Rs 5000 for surgery", "Need ₹500", "Scan the QR code", "Fundraising for a new shed",
                     "GPay 9876543210", "Donations in cash welcome"]) {
    await assertFails(setDoc(doc(applicant(), "applications/m"), application({ about: bad })), bad);
  }
  await assertSucceeds(setDoc(doc(applicant(), "applications/ok"), application({ about: "We need blankets and volunteers, please donate old bedsheets." })));
});

test("applications are private to the applicant, admins, the local coordinator and the named voucher", async () => {
  await seedPeople();
  await seedApp({ voucherEmail: "vik@example.org" });
  await assertSucceeds(getDoc(doc(applicant(), "applications/app1")));
  await assertSucceeds(getDoc(doc(owner(), "applications/app1")));
  await assertSucceeds(getDoc(doc(admin2(), "applications/app1")));
  await assertSucceeds(getDoc(doc(coordUdupi(), "applications/app1")));
  await assertSucceeds(getDoc(doc(verifiedMember(), "applications/app1")));
  await assertFails(getDoc(doc(stranger(), "applications/app1")));
  await assertFails(getDoc(doc(anon(), "applications/app1")));
});

test("queries are allowed only within each role's reach", async () => {
  await seedPeople();
  await seedApp();
  await assertSucceeds(getDocs(query(collection(applicant(), "applications"), where("uid", "==", "alice"))));
  await assertSucceeds(getDocs(query(collection(coordUdupi(), "applications"), where("state", "==", "Karnataka"), where("district", "==", "Udupi"))));
  await assertFails(getDocs(query(collection(coordUdupi(), "applications"), where("state", "==", "Kerala"), where("district", "==", "Wayanad"))));
  await assertSucceeds(getDocs(collection(owner(), "applications")));
  await assertFails(getDocs(collection(stranger(), "applications")));
});

test("the applicant can fix details while waiting, but not decide anything", async () => {
  await seedApp();
  await assertSucceeds(updateDoc(doc(applicant(), "applications/app1"), { regNumber: "KA064/2014-15", status: "submitted", docsOk: false, rev: 1, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(applicant(), "applications/app1"), { docsOk: true, rev: 2, status: "submitted", updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(applicant(), "applications/app1"), { status: "verified", rev: 2, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(applicant(), "applications/app1"), { vouch: { ok: true }, rev: 2, status: "submitted", updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(applicant(), "applications/app1"), { regType: "anything", rev: 2, status: "submitted", updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(applicant(), "applications/app1"), { website: "Pay by PhonePe", rev: 2, status: "submitted", updatedAt: serverTimestamp() }));
});

// ------------------------------------------------------------- vouching
test("only a local coordinator or the named verified member can vouch, never the applicant", async () => {
  await seedPeople();
  await seedApp({ voucherEmail: "vik@example.org" });
  await assertFails((await vouchBatch(applicant(), "alice", "alice@example.org")).commit());
  await assertFails((await vouchBatch(stranger(), "eve", "eve@example.org")).commit());
  await assertFails((await vouchBatch(verifiedMember(), "vik", "vik@example.org")).commit());  // not a coordinator
  await assertSucceeds((await vouchBatch(verifiedMember(), "vik", "vik@example.org", true, "member")).commit());
  await assertSucceeds((await vouchBatch(coordUdupi(), "cora", "cora@example.org")).commit());
});

test("a vouch must leave its audit entry", async () => {
  await seedPeople();
  await seedApp();
  const db = coordUdupi();
  await assertFails(updateDoc(doc(db, "applications/app1"), {
    vouch: { ok: true, by: "cora", email: "cora@example.org", note: "", at: serverTimestamp(), role: "coordinator" }, updatedAt: serverTimestamp(), rev: 1
  }));
});

test("a coordinator from another district cannot vouch", async () => {
  await seedPeople();
  await seed(async (db) => setDoc(doc(db, "coordinators/kai@example.org"), { state: "Kerala", district: "*", name: "Kai", by: "owner", at: Timestamp.now() }));
  await seedApp();
  await assertFails((await vouchBatch(as("kai", "kai@example.org"), "kai", "kai@example.org")).commit());
});

// ------------------------------------------------------------- verification gates
test("an admin cannot verify without checked documents and a vouch", async () => {
  await seedPeople();
  await seedApp();
  await assertFails((await verifyBatch(owner(), "owner", OWNER)).commit());
  await assertSucceeds((await decideBatch(owner(), "owner", OWNER, { status: "docs_ok", docsOk: true })).commit());
  await assertFails((await verifyBatch(owner(), "owner", OWNER)).commit());  // still no vouch
  await assertSucceeds((await vouchBatch(coordUdupi(), "cora", "cora@example.org")).commit());
  await assertSucceeds((await verifyBatch(owner(), "owner", OWNER)).commit());
  const p = await getDoc(doc(anon(), "profiles/awbi-ka064-2014"));
  if (!p.exists()) throw new Error("profile should be public after verification");
});

test("a negative vouch blocks verification", async () => {
  await seedPeople();
  await seedApp();
  await assertSucceeds((await decideBatch(owner(), "owner", OWNER, { status: "docs_ok", docsOk: true })).commit());
  await assertSucceeds((await vouchBatch(coordUdupi(), "cora", "cora@example.org", false)).commit());
  await assertFails((await verifyBatch(owner(), "owner", OWNER)).commit());
});

test("an admin cannot verify a group they vouched for themselves", async () => {
  await seedPeople();
  await seed(async (db) => setDoc(doc(db, "coordinators/" + OWNER), { state: "Karnataka", district: "*", name: "Owner", by: "owner", at: Timestamp.now() }));
  await seedApp();
  await assertSucceeds((await decideBatch(owner(), "owner", OWNER, { status: "docs_ok", docsOk: true })).commit());
  await assertSucceeds((await vouchBatch(owner(), "owner", OWNER)).commit());
  await assertFails((await verifyBatch(owner(), "owner", OWNER)).commit());
  await assertSucceeds((await verifyBatch(admin2(), "admin2", "admin2@example.org")).commit());
});

test("when a visit is required, verification waits for a coordinator's visit", async () => {
  await seedPeople();
  await seedApp();
  await assertSucceeds((await decideBatch(owner(), "owner", OWNER, { status: "visit_required", docsOk: true, needsVisit: true })).commit());
  await assertSucceeds((await vouchBatch(coordUdupi(), "cora", "cora@example.org")).commit());
  await assertFails((await verifyBatch(owner(), "owner", OWNER, { needsVisit: true })).commit());
  await assertSucceeds((await visitBatch(coordUdupi(), "cora", "cora@example.org")).commit());
  await assertSucceeds((await verifyBatch(owner(), "owner", OWNER, { needsVisit: true })).commit());
});

test("an admin cannot quietly drop a required visit", async () => {
  await seedPeople();
  await seedApp();
  await assertSucceeds((await decideBatch(owner(), "owner", OWNER, { status: "visit_required", docsOk: true, needsVisit: true })).commit());
  await assertSucceeds((await vouchBatch(coordUdupi(), "cora", "cora@example.org")).commit());
  await assertFails((await verifyBatch(owner(), "owner", OWNER, { needsVisit: false })).commit());
});

test("strangers and coordinators cannot make admin decisions", async () => {
  await seedPeople();
  await seedApp();
  await assertFails((await decideBatch(stranger(), "eve", "eve@example.org", { status: "docs_ok", docsOk: true })).commit());
  await assertFails((await decideBatch(coordUdupi(), "cora", "cora@example.org", { status: "docs_ok", docsOk: true })).commit());
});

test("nobody can create a profile or membership without a verified application", async () => {
  await seedPeople();
  await seedApp();
  await assertFails(setDoc(doc(owner(), "profiles/awbi-ka064-2014"), { appId: "app1", name: "X", state: "Karnataka", district: "Udupi" }));
  await assertFails(setDoc(doc(owner(), "members/alice"), { gid: "awbi-ka064-2014", email: "a", appId: "app1", at: serverTimestamp() }));
  await assertFails(setDoc(doc(stranger(), "public/index"), { verified: { fake: { n: "Fake" } } }));
});

// ------------------------------------------------------------- profiles and needs
async function seedVerified() {
  await seedPeople();
  await seed(async (db) => {
    await setDoc(doc(db, "profiles/awbi-ka064-2014"), {
      appId: "app1", name: "Amruthadhara Gaushala", state: "Karnataka", district: "Udupi", about: "", hours: "",
      phones: [], emails: [], website: "", services: [], species: [], members: ["alice"],
      capacity: { intake: "open", note: "" }, verifiedAt: Timestamp.now(), updatedAt: Timestamp.now()
    });
    await setDoc(doc(db, "members/alice"), { gid: "awbi-ka064-2014", email: "alice@example.org", appId: "app1", at: Timestamp.now() });
  });
}

test("members keep their own profile current, without money text", async () => {
  await seedVerified();
  await assertSucceeds(updateDoc(doc(applicant(), "profiles/awbi-ka064-2014"), { about: "120 cows, open 7am to 6pm", capacity: { intake: "limited", note: "Space for 5 more" }, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(applicant(), "profiles/awbi-ka064-2014"), { about: "Donate via UPI cows@ybl", updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(applicant(), "profiles/awbi-ka064-2014"), { name: "Renamed", updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(stranger(), "profiles/awbi-ka064-2014"), { about: "hijack", updatedAt: serverTimestamp() }));
  await assertSucceeds(getDoc(doc(anon(), "profiles/awbi-ka064-2014")));
});

function need(over = {}) {
  return Object.assign({
    gid: "awbi-ka064-2014", name: "Amruthadhara Gaushala", state: "Karnataka", district: "Udupi",
    kind: "supplies", text: "Dry fodder for the monsoon, about 2 tonnes", urgent: false, status: "open", by: "alice",
    createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 14 * 864e5)
  }, over);
}

test("verified members post in-kind needs; nobody can ask for money", async () => {
  await seedVerified();
  await assertSucceeds(setDoc(doc(applicant(), "needs/n1"), need()));
  await assertFails(setDoc(doc(applicant(), "needs/n2"), need({ text: "Need Rs 20000, GPay 9876543210" })));
  await assertFails(setDoc(doc(applicant(), "needs/n3"), need({ kind: "money" })));
  await assertFails(setDoc(doc(applicant(), "needs/n4"), need({ expiresAt: Timestamp.fromMillis(Date.now() + 60 * 864e5) })));
  await assertFails(setDoc(doc(applicant(), "needs/n5"), need({ district: "Mysuru" })));
  await assertFails(setDoc(doc(stranger(), "needs/n6"), need({ by: "eve" })));
  await assertSucceeds(getDoc(doc(anon(), "needs/n1")));
  await assertSucceeds(updateDoc(doc(applicant(), "needs/n1"), { status: "met" }));
});

// ------------------------------------------------------------- proofs, reports, audit
test("proof documents are small, typed and private", async () => {
  await seedPeople();
  const ok = { uid: "alice", name: "reg.jpg", type: "image/jpeg", data: "data:image/jpeg;base64,AAAA", state: "Karnataka", district: "Udupi", createdAt: serverTimestamp() };
  await assertSucceeds(setDoc(doc(applicant(), "proofs/alice_0"), ok));
  await assertFails(setDoc(doc(applicant(), "proofs/alice_1"), Object.assign({}, ok, { type: "text/html", data: "data:text/html;base64,AAAA" })));
  await assertFails(setDoc(doc(applicant(), "proofs/alice_2"), Object.assign({}, ok, { data: "data:application/pdf;base64,AAAA" })));
  await assertFails(setDoc(doc(applicant(), "proofs/alice_3"), Object.assign({}, ok, { uid: "eve" })));
  await assertFails(setDoc(doc(applicant(), "proofs/alice_30"), ok));
  await assertFails(setDoc(doc(applicant(), "proofs/random"), ok));
  await assertSucceeds(getDoc(doc(owner(), "proofs/alice_0")));
  await assertSucceeds(getDoc(doc(coordUdupi(), "proofs/alice_0")));
  await assertFails(getDoc(doc(stranger(), "proofs/alice_0")));
  await assertFails(updateDoc(doc(applicant(), "proofs/alice_0"), { name: "x" }));
});

test("anyone signed in can report; only admins read reports", async () => {
  await seedPeople();
  const r = { target: "awbi-ka064-2014", targetName: "Amruthadhara Gaushala", reason: "fake", text: "No such place at this address", uid: "eve", email: "eve@example.org", status: "open", createdAt: serverTimestamp() };
  await assertSucceeds(setDoc(doc(stranger(), "reports/r1"), r));
  await assertFails(setDoc(doc(anon(), "reports/r2"), r));
  await assertFails(getDoc(doc(stranger(), "reports/r1")));
  await assertSucceeds(getDoc(doc(owner(), "reports/r1")));
});

test("the audit log can only grow", async () => {
  await seedPeople();
  await assertSucceeds(setDoc(doc(owner(), "audit/x1_owner"), { by: "owner", email: OWNER, action: "note", target: "t", note: "n", at: serverTimestamp() }));
  await assertFails(updateDoc(doc(owner(), "audit/x1_owner"), { note: "changed" }));
  await assertFails(deleteDoc(doc(owner(), "audit/x1_owner")));
  await assertFails(setDoc(doc(stranger(), "audit/x2_eve"), { by: "eve", email: "eve@example.org", action: "note", target: "t", note: "n", at: serverTimestamp() }));
  await assertFails(getDoc(doc(coordUdupi(), "audit/x1_owner")));
  await assertSucceeds(getDoc(doc(coordUdupi(), "audit/not-there")));
});

test("admin lists and coordinator lists are not public", async () => {
  await seedPeople();
  await assertFails(getDoc(doc(stranger(), "config/admins")));
  await assertSucceeds(getDoc(doc(owner(), "config/admins")));
  await assertFails(setDoc(doc(owner(), "config/admins"), { emails: ["eve@example.org"] }));
  await assertFails(getDoc(doc(stranger(), "coordinators/cora@example.org")));
  await assertSucceeds(getDoc(doc(coordUdupi(), "coordinators/cora@example.org")));
  await assertFails(setDoc(doc(coordUdupi(), "coordinators/eve@example.org"), { state: "Karnataka", district: "*", name: "", by: "cora", at: serverTimestamp() }));
});


// ------------------------------------------------------------- loopholes found in review
test("nobody can take an audit id meant for someone else", async () => {
  await seedPeople();
  await assertFails(setDoc(doc(verifiedMember(), "audit/decide_app1_1_owner"), { by: "vik", email: "vik@example.org", action: "decide", target: "app1", note: "", at: serverTimestamp() }));
  await assertSucceeds(setDoc(doc(verifiedMember(), "audit/note_1_vik"), { by: "vik", email: "vik@example.org", action: "note", target: "app1", note: "", at: serverTimestamp() }));
});

test("a vouch from a verified group alone is not enough: a coordinator must visit", async () => {
  await seedPeople();
  await seedApp({ voucherEmail: "vik@example.org" });
  await assertSucceeds((await decideBatch(owner(), "owner", OWNER, { status: "docs_ok", docsOk: true })).commit());
  await assertSucceeds((await vouchBatch(verifiedMember(), "vik", "vik@example.org", true, "member")).commit());
  await assertFails((await verifyBatch(owner(), "owner", OWNER)).commit());
  await assertSucceeds((await decideBatch(owner(), "owner", OWNER, { status: "visit_required", docsOk: true, needsVisit: true })).commit());
  await assertSucceeds((await visitBatch(coordUdupi(), "cora", "cora@example.org")).commit());
  await assertSucceeds((await verifyBatch(owner(), "owner", OWNER, { needsVisit: true })).commit());
});

test("changes by the applicant after the documents were checked send them back for checking", async () => {
  await seedPeople();
  await seedApp();
  await assertSucceeds((await decideBatch(owner(), "owner", OWNER, { status: "info_needed", docsOk: true })).commit());
  await assertSucceeds((await vouchBatch(coordUdupi(), "cora", "cora@example.org")).commit());
  // keeping docsOk true while swapping documents is refused
  await assertFails(updateDoc(doc(applicant(), "applications/app1"), { regNumber: "FAKE/1", status: "submitted", rev: await rev(), updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(applicant(), "applications/app1"), { regNumber: "FAKE/1", status: "submitted", docsOk: false, rev: await rev(), updatedAt: serverTimestamp() }));
  await assertFails((await verifyBatch(owner(), "owner", OWNER)).commit());   // docs must be checked again first
  await assertSucceeds((await decideBatch(owner(), "owner", OWNER, { status: "docs_ok", docsOk: true })).commit());
  await assertSucceeds((await verifyBatch(owner(), "owner", OWNER)).commit());
});

test("the verify step cannot also tick the documents box", async () => {
  await seedPeople();
  await seedApp();
  await assertSucceeds((await vouchBatch(coordUdupi(), "cora", "cora@example.org")).commit());
  await assertFails((await verifyBatch(owner(), "owner", OWNER)).commit());
});

test("a refused vouch can only be changed by whoever refused", async () => {
  await seedPeople();
  await seedApp({ voucherEmail: "vik@example.org" });
  await assertSucceeds((await vouchBatch(coordUdupi(), "cora", "cora@example.org", false)).commit());
  await assertFails((await vouchBatch(verifiedMember(), "vik", "vik@example.org", true, "member")).commit());
  await assertSucceeds((await vouchBatch(coordUdupi(), "cora", "cora@example.org", true)).commit());
});

test("verified profiles: no money in any field, no extra keys, no renaming, even by admins", async () => {
  await seedVerified();
  const t = serverTimestamp();
  await assertFails(updateDoc(doc(applicant(), "profiles/awbi-ka064-2014"), { phones: ["GPay 9876543210"], updatedAt: t }));
  await assertFails(updateDoc(doc(applicant(), "profiles/awbi-ka064-2014"), { website: "upi://pay?pa=cows@ybl", updatedAt: t }));
  await assertFails(updateDoc(doc(applicant(), "profiles/awbi-ka064-2014"), { capacity: { intake: "open", note: "", upi: "cows@ybl" }, updatedAt: t }));
  await assertFails(updateDoc(doc(applicant(), "profiles/awbi-ka064-2014"), { services: ["Sponsor a cow"], updatedAt: t }));
  await assertFails(updateDoc(doc(owner(), "profiles/awbi-ka064-2014"), { name: "Someone Else", updatedAt: t }));
  await assertSucceeds(updateDoc(doc(applicant(), "profiles/awbi-ka064-2014"), { phones: ["+91 98450 00000"], updatedAt: t }));
});

test("a second application for the same group cannot take over its profile", async () => {
  await seedVerified();
  await seed(async (db) => updateDoc(doc(db, "profiles/awbi-ka064-2014"), { appId: "original" }));
  await seedApp({ uid: "mallory", email: "mallory@example.org" });
  await assertSucceeds((await decideBatch(owner(), "owner", OWNER, { status: "docs_ok", docsOk: true })).commit());
  await assertSucceeds((await vouchBatch(coordUdupi(), "cora", "cora@example.org")).commit());
  const r = await rev(), db = owner(), b = writeBatch(db);
  b.update(doc(db, "applications/app1"), { status: "verified", docsOk: true, reviewedBy: "owner", updatedAt: serverTimestamp(), rev: r });
  b.set(doc(db, "audit/decide_app1_" + r + "_owner"), { by: "owner", email: OWNER, action: "decide", target: "app1", note: "", at: serverTimestamp() });
  await assertFails(b.commit());   // the profile belongs to another application
});

test("the public index only changes one group at a time, matching its profile", async () => {
  await seedVerified();
  await assertFails(setDoc(doc(owner(), "public/index"), { verified: { "fake-group": { n: "Fake", st: "Goa", d: "North Goa" } }, last: "fake-group" }, { merge: true }));
  await assertFails(setDoc(doc(owner(), "public/index"), { verified: { "awbi-ka064-2014": { n: "Renamed", st: "Karnataka", d: "Udupi" } }, last: "awbi-ka064-2014" }, { merge: true }));
  await assertSucceeds(setDoc(doc(owner(), "public/index"), { verified: { "awbi-ka064-2014": { n: "Amruthadhara Gaushala", st: "Karnataka", d: "Udupi" } }, last: "awbi-ka064-2014" }, { merge: true }));
});

test("a removed need stays removed", async () => {
  await seedVerified();
  await seed(async (db) => setDoc(doc(db, "needs/n1"), Object.assign(need(), { status: "removed", createdAt: Timestamp.now() })));
  await assertFails(updateDoc(doc(applicant(), "needs/n1"), { status: "open" }));
});
