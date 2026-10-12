// The block inside a copy of Rapid Response's rules (rrt-base.rules, from
// rrtplatform/rrt-platform/backend/functions/firestore-security-rules.rules):
// it must compile there, work the same, and leave RRT's own rules alone.
import { test, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, getDocs, collection, query, where, serverTimestamp } from "firebase/firestore";
import { merge } from "./merge.mjs";

let env;
before(async () => {
  const rrt = readFileSync(new URL("./rrt-base.rules", import.meta.url), "utf8");
  env = await initializeTestEnvironment({ projectId: "demo-rrt", firestore: { rules: merge(rrt) } });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const as = (uid, email) => env.authenticatedContext(uid, { email, email_verified: true }).firestore();
const anon = () => env.unauthenticatedContext().firestore();

test("inside RRT's rules: the directory works", async () => {
  const db = as("eve", "eve@example.org");
  await assertSucceeds(setDoc(doc(db, "ngo/dir/checks/awbi-ka004-1993_eve"), { gid: "awbi-ka004-1993", uid: "eve", ok: true, why: "", at: serverTimestamp() }));
  await assertSucceeds(getDocs(query(collection(anon(), "ngo/dir/checks"), where("gid", "==", "awbi-ka004-1993"))));
  await assertSucceeds(getDoc(doc(anon(), "ngo/dir/public/index")));
  await assertFails(setDoc(doc(db, "ngo/dir/comments/awbi-ka004-1993_eve"), { gid: "awbi-ka004-1993", gname: "x", state: "", district: "",
    uid: "eve", name: "Eve", text: "Approved by me", contact: "", status: "approved", at: serverTimestamp() }));
});

test("inside RRT's rules: RRT's own data is untouched by the block", async () => {
  const db = as("eve", "eve@example.org");
  await assertFails(setDoc(doc(db, "sos_alerts/a1"), { active: true }));
  await assertFails(getDoc(doc(db, "subscribed_users/f1")));
  await assertFails(setDoc(doc(db, "reports/r1"), { target: "x" }));
  await assertFails(getDoc(doc(db, "admins/sam@example.org")));
  await assertFails(setDoc(doc(db, "ngo/other/checks/x_eve"), { gid: "x", uid: "eve", ok: true, why: "", at: serverTimestamp() }));
  await assertFails(setDoc(doc(db, "ngo/dir"), { hello: 1 }));
});
