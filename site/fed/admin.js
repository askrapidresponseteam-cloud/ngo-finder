// Admin console: log outreach to NGOs, review applications (documents, vouch, visit),
// approve comments, handle reports, appoint coordinators and admins, read the audit log.
// The rules refuse anything that skips a step.
import { backend } from "./api.js";
import { outreachTab } from "./outreach.js";
import { $, el, clear, toast, errText, expander, field, select, STATUS_LABEL, REPORT_REASONS, fmtDate, directory, fold } from "./common.js";
import { appSummary, proofList } from "./shared.js";

const view = $("view");
let B = null, user = null, DIR = null;

function card(kids, cls) { return el("section", { cls: "card " + (cls || "") }, kids); }
function setSub(t) { $("sub").textContent = t; }

async function start() {
  try { B = await backend(); } catch (e) { B = null; }
  if (!B) { clear(view).appendChild(card([el("p", { text: "The admin page is not set up yet." })])); return; }
  try { await B.finishLink(); } catch (e) { /* not a sign-in link */ }
  B.onUser(async (u) => {
    user = u;
    const w = clear($("who"));
    if (!u) return signIn();
    w.appendChild(el("span", { cls: "muted", text: "Signed in as " + (u.email || "") }));
    w.appendChild(el("button", { cls: "obig", type: "button", text: "Sign out", on: { click: () => B.signOut() } }));
    clear(view).appendChild(el("p", { cls: "ohint", text: "Checking your access..." }));
    const r = await B.roles().catch(() => ({}));
    if (!r.admin) {
      clear(view).appendChild(card([el("h2", { cls: "otitle", text: "This account is not an admin" }),
        el("p", { text: (u.email || "This account") + " cannot open the admin page. Ask the owner to add this email in the Admins tab, then sign in again." })]));
      return;
    }
    DIR = await directory().catch(() => null);
    tabs();
  });
}

// Sign in once: Google, or a link sent by email (no passwords, no codes).
function signIn() {
  $("sub").textContent = "Sign in to log outreach and look after the directory.";
  const google = el("button", { cls: "obig primary", type: "button", text: "Sign in with Google",
    on: { click: () => B.signInGoogle().catch((e) => toast(errText(e))) } });
  const mail = el("input", { type: "email", id: "amail", autocomplete: "email", placeholder: "name@example.org" });
  const send = el("button", { cls: "obig", type: "button", text: "Email me a sign-in link", on: { click: async () => {
    const v = mail.value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { toast("Enter your email address."); mail.focus(); return; }
    try { await B.sendLink(v); clear(box).appendChild(el("p", { cls: "obigtext", text: "Done. Open the email we sent to " + v + " and tap the link in it. You can close this page." })); }
    catch (e) { toast(errText(e)); }
  } } });
  const box = card([el("h2", { cls: "otitle", text: "Admin sign in" }), el("div", { cls: "oactions" }, [google]),
    el("p", { cls: "or", text: "or, without Google:" }),
    el("div", { cls: "ofield" }, [el("label", { cls: "olabel", for: "amail", text: "Your email" }), mail]),
    el("div", { cls: "oactions" }, [send])], "ostep");
  clear(view).appendChild(box);
}

function tabs() {
  const parts = [["outreach", "Outreach", (b) => outreachTab(b, { B, DIR, setSub })], ["suggest", "Suggestions", suggestions],
    ["queue", "Applications", queue], ["comments", "Comments", comments], ["reports", "Reports", reports], ["coord", "Coordinators", coordinators]];
  if (B.isOwner()) parts.push(["admins", "Admins", admins]);
  parts.push(["audit", "Audit log", audit]);
  const bar = el("nav", { cls: "otabs", "aria-label": "Admin sections" }), body = el("div");
  const show = (k) => {
    Array.from(bar.children).forEach((b) => b.setAttribute("aria-current", b.dataset.k === k ? "page" : "false"));
    clear(body);
    Promise.resolve(parts.find((p) => p[0] === k)[2](body)).catch((e) => body.appendChild(el("p", { cls: "oerrors", text: errText(e) })));
  };
  parts.forEach(([k, l]) => bar.appendChild(el("button", { cls: "otab", type: "button", "data-k": k, text: l, on: { click: () => show(k) } })));
  clear(view); view.appendChild(bar); view.appendChild(body); show("outreach");
}

// ------------------------------------------------------------------ suggested groups
// "Know a group that's missing?" answers. Check each one (its website or page, or a
// call), then publish it to the directory or turn it down. Publishing shows it on the
// site within a minute, as "Suggested and checked by the Rapid Response team".
const slug = (x) => String(x || "").toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
async function suggestions(body) {
  const list = await B.suggestions();
  list.sort((a, b) => ((a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0) - (b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0)));
  setSub(list.length + " suggestion(s) waiting.");
  if (!list.length) return body.appendChild(card([el("p", { cls: "ohint", text: "Nothing waiting. Suggestions people send from the directory arrive here." })]));
  const ul = el("ul", { cls: "olist osugs" });
  list.forEach((sg) => {
    const dupes = DIR ? DIR.orgs.filter((o) => {
      const f = fold([o.n].concat(o.k || []).join(" "));
      const words = fold(sg.name).split(/[^a-z0-9]+/).filter((w) => w.length > 3);
      return words.length && words.every((w) => f.includes(w));
    }).slice(0, 3) : [];
    const cat = el("select", null, [["animal", "Animal welfare"], ["cattle", "Gaushala"], ["wildlife", "Wildlife"]]
      .map(([v, l]) => el("option", { value: v, text: l })));
    const note = el("input", { maxlength: "500", placeholder: "Note (what you checked, or why not)" });
    const act = el("div", { cls: "row-actions" });
    const li = el("li", null, [el("div", { cls: "sgbody" }, [
      el("div", { cls: "oname", text: sg.name }),
      el("div", { cls: "oplace", text: [sg.town, sg.district, sg.state].filter(Boolean).join(", ") + " . from " + (sg.byEmail || "") + ", " + fmtDate(sg.createdAt) }),
      [sg.phone, sg.website].filter(Boolean).length ? el("div", { cls: "ohint", text: [sg.phone, sg.website].filter(Boolean).join(" . ") }) : null,
      sg.about ? el("p", { cls: "ohint", text: sg.about }) : null,
      dupes.length ? el("div", { cls: "oerrors", text: "Maybe already listed: " + dupes.map((o) => o.n + " (" + o.d + ", " + o.st + ")").join("; ") }) : null,
      el("div", { cls: "row-actions" }, [cat, note]), act
    ])]);
    const resolve = async (status, fn) => {
      try { if (fn) await fn(); await B.resolveSuggestion(sg.id, status, note.value.trim()); toast(status === "added" ? "Published to the directory." : "Turned down."); suggestions(clear(body)); }
      catch (e) { toast(errText(e)); }
    };
    act.append(
      el("button", { cls: "obig primary", type: "button", text: "Checked, add to the directory", on: { click: () => {
        if (!confirm("Publish " + sg.name + " to the public directory?")) return;
        const gid = slug(sg.name) + "--" + slug(sg.district || sg.town) + "--" + slug(sg.state);
        resolve("added", () => B.publishExtra(gid, {
          n: sg.name, k: [], c: [cat.value], st: sg.state, d: sg.district || "Unknown", a: sg.town || "",
          ad: [sg.town, sg.district, sg.state].filter(Boolean).join(", "),
          p: sg.phone ? [sg.phone] : [], e: [], w: /^https?:\/\//.test(sg.website || "") ? sg.website : "",
          s: [], nt: sg.about ? [sg.about.slice(0, 300)] : [],
          sr: /^https?:\/\//.test(sg.website || "") ? [sg.website] : []
        }));
      } } }),
      el("button", { cls: "osmall danger", type: "button", text: "Turn down", on: { click: () => {
        if (!note.value.trim()) return toast("Write why, for the audit trail.");
        resolve("rejected");
      } } }));
    ul.appendChild(li);
  });
  body.appendChild(card([el("h2", { cls: "otitle", text: "Suggested groups" }),
    el("p", { cls: "ohint", text: "Check each one before publishing: open its website or page, or call. Published groups show in the directory within a minute." }), ul], "ostep"));
}

// ------------------------------------------------------------------ admins (owner only)
async function admins(body) {
  let list = await B.adminList();
  setSub("People who can open this page.");
  const ul = el("ul", { cls: "olist" });
  const mail = el("input", { type: "email", id: "newadmin", placeholder: "name@example.org" });
  const draw = () => {
    clear(ul);
    ul.appendChild(el("li", null, [el("span", { text: "You (the owner)" })]));
    list.forEach((m) => ul.appendChild(el("li", null, [el("span", { text: m }),
      el("button", { cls: "osmall danger", type: "button", text: "Remove", on: { click: async () => {
        if (!confirm("Remove " + m + " as an admin?")) return;
        const next = list.filter((x) => x !== m);
        try { await B.setAdminList(next); list = next; toast("Removed."); draw(); } catch (e) { toast(errText(e)); }
      } } })])));
  };
  const add = el("button", { cls: "obig primary", type: "button", text: "Add admin", on: { click: async () => {
    const v = mail.value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { toast("Enter an email address."); return; }
    if (list.includes(v)) { toast("Already an admin."); return; }
    const next = list.concat([v]);
    try { await B.setAdminList(next); list = next; mail.value = ""; toast("Added. They can sign in now."); draw(); } catch (e) { toast(errText(e)); }
  } } });
  body.appendChild(card([el("h2", { cls: "otitle", text: "Admins" }),
    el("p", { cls: "ohint", text: "Rapid Response super admins can always sign in here too." }), ul,
    el("div", { cls: "ofield" }, [el("label", { cls: "olabel", for: "newadmin", text: "Add an admin by email" }), mail]),
    el("div", { cls: "oactions" }, [add])], "ostep"));
  draw();
}

// ------------------------------------------------------------------ applications
const FILTERS = [["review", "To review", ["submitted"]], ["docs_ok", "Documents ok", ["docs_ok"]], ["visit", "Visit", ["visit_required"]],
  ["info", "Info needed", ["info_needed"]], ["verified", "Verified", ["verified"]], ["rejected", "Rejected", ["rejected", "suspended"]], ["all", "All", null]];

async function queue(body) {
  const [apps, index] = await Promise.all([B.allApplications(), B.publicIndex()]);
  let filter = "review", q = "";
  const bar = el("nav", { cls: "types sub" }), list = el("ul", { cls: "list" });
  const search = el("input", { type: "search", placeholder: "Name, email, district or registration", "aria-label": "Search applications" });
  const counts = {};
  FILTERS.forEach(([k, , st]) => { counts[k] = apps.filter((a) => !st || st.includes(a.status)).length; });
  const draw = () => {
    Array.from(bar.children).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.k === filter)));
    const st = FILTERS.find((f) => f[0] === filter)[2];
    const terms = fold(q).split(/\s+/).filter(Boolean);
    clear(list);
    const shown = apps.filter((a) => (!st || st.includes(a.status)) &&
      terms.every((t) => fold([a.name, a.email, a.district, a.state, a.regNumber, a.town].join(" ")).includes(t)));
    shown.forEach((a) => list.appendChild(appItem(a, apps, index, () => queue(clear(body)))));
    if (!shown.length) list.appendChild(el("li", { cls: "muted", text: "Nothing here." }));
  };
  FILTERS.forEach(([k, l]) => bar.appendChild(el("button", { cls: "pill", type: "button", "data-k": k, on: { click: () => { filter = k; draw(); } } },
    [l, el("span", { cls: "n", text: " " + counts[k] })])));
  search.addEventListener("input", () => { q = search.value; draw(); });
  setSub(counts.review + " waiting for review, " + counts.verified + " verified.");
  body.appendChild(bar); body.appendChild(search); body.appendChild(list);
  draw();
}

function checks(a, apps, index) {
  const out = [];
  const ok = (t) => out.push(el("li", { cls: "ok", text: t }));
  const warn = (t) => out.push(el("li", { cls: "warn", text: t }));
  const code = (a.awbiCode || (a.regType === "awbi" ? a.regNumber : "") || "").trim().toUpperCase();
  if (DIR && code) {
    const hit = DIR.orgs.find((o) => (o.ac || "").toUpperCase() === code);
    if (hit) {
      const same = fold(hit.n).split(/\W+/).filter((w) => w.length > 3).some((w) => fold(a.name).includes(w));
      (same ? ok : warn)("AWBI list has " + code + " as " + hit.n + ", " + [hit.d, hit.st].join(", ") + (same ? "" : ". Name differs: check carefully."));
    } else warn("AWBI code " + code + " is not on the AWBI list we hold (" + (DIR.meta.awbi_date || "") + ").");
  }
  if (DIR && a.kind === "claim") {
    const g = DIR.orgs.find((o) => o._id === a.gid);
    if (g) ok("Claims the listing " + g.n + " (" + [g.a, g.d, g.st].filter(Boolean).join(", ") + ")");
    else warn("The claimed listing is no longer in the directory.");
  }
  const others = apps.filter((x) => x.gid === a.gid && x.id !== a.id && x.status !== "rejected");
  if (others.length) warn(others.length + " other application(s) for the same group: " + others.map((x) => x.email).join(", "));
  if (index.verified && index.verified[a.gid] && a.status !== "verified") warn("This group is already verified by someone else.");
  if (a.voucherEmail && a.voucherEmail.split("@")[1] === (a.email || "").split("@")[1] && !/gmail|yahoo|outlook|hotmail|rediff/.test(a.voucherEmail)) warn("Voucher uses the applicant's own email domain.");
  if (a.vouch && a.vouch.by === user.uid) warn("You vouched for this group, so another admin must verify it.");
  if (!a.proofs || !a.proofs.length) warn("No document photos; check the Drive folder.");
  return out.length ? el("ul", { cls: "checks" }, out) : null;
}

function appItem(a, apps, index, refresh) {
  const li = el("li", { cls: "item" });
  const flags = [el("span", { cls: "chip", text: STATUS_LABEL[a.status] || a.status }),
    a.kind === "claim" ? el("span", { cls: "chip", text: "Claim" }) : el("span", { cls: "chip", text: "New" }),
    a.vouch ? el("span", { cls: "chip" + (a.vouch.ok ? " awbi" : " flag"), text: a.vouch.ok ? "Vouched" : "Vouch refused" }) : null,
    a.needsVisit ? el("span", { cls: "chip" + (a.visit && a.visit.ok ? " awbi" : " flag"), text: a.visit ? (a.visit.ok ? "Visit passed" : "Visit failed") : "Visit pending" }) : null,
    el("span", { text: [a.district, a.state].join(", ") + "  |  " + fmtDate(a.createdAt) })];
  const head = el("button", { cls: "head", type: "button", "aria-expanded": "false" }, [
    el("div", { cls: "body" }, [el("div", { cls: "nm", text: a.name }), el("div", { cls: "meta" }, flags)]),
    el("span", { cls: "plus", "aria-hidden": "true", text: "+" })
  ]);
  const detail = el("div", { cls: "detail" });
  let built = false;
  head.addEventListener("click", () => {
    const open = !li.classList.contains("open");
    if (open && !built) { built = true; fill(); }
    li.classList.toggle("open", open); head.setAttribute("aria-expanded", String(open));
  });
  function fill() {
    detail.appendChild(appSummary(a));
    const c = checks(a, apps, index); if (c) detail.appendChild(c);
    detail.appendChild(proofList(B, a));
    if (a.status === "verified") {
      const why = el("input", { maxlength: "500", placeholder: "Reason (shown in the audit log)" });
      detail.appendChild(expander("Suspend verification", el("div", { cls: "row-actions" }, [why,
        el("button", { cls: "pill danger", type: "button", text: "Suspend", on: { click: async () => {
          if (!why.value.trim()) return toast("Give a reason.");
          if (!confirm("Take " + a.name + " off the verified list?")) return;
          try { await B.suspend(a, why.value.trim()); toast("Suspended."); refresh(); } catch (e) { toast(errText(e)); } } } })])));
      return;
    }
    if (["rejected", "suspended"].includes(a.status)) return;
    const note = el("textarea", { rows: "2", maxlength: "1000", placeholder: "Note to the applicant (needed to ask for info or reject)" });
    const act = async (patch, needNote) => {
      if (needNote && !note.value.trim()) return toast("Write a note first.");
      try { await B.decide(a, Object.assign({ decision: note.value.trim() }, patch)); toast("Saved."); refresh(); } catch (e) { toast(errText(e)); }
    };
    const coordInvolved = a.vouch && (a.vouch.role === "coordinator" || a.needsVisit);
    const canVerify = a.docsOk && a.vouch && a.vouch.ok && a.vouch.by !== user.uid && a.vouch.by !== a.uid && coordInvolved &&
      (!a.needsVisit || (a.visit && a.visit.ok));
    const why = !a.docsOk ? "Check the documents first (mark Documents OK)." : !(a.vouch && a.vouch.ok) ? "Waiting for a vouch." :
      a.vouch.by === user.uid ? "You vouched; another admin must verify." :
      !coordInvolved ? "Vouched by a verified group, not a coordinator: require a visit by a coordinator." :
      a.needsVisit && !(a.visit && a.visit.ok) ? "Waiting for the visit." : "";
    const verify = el("button", { cls: "pill blue", type: "button", text: "Verify", disabled: !canVerify, title: why || "All checks done" });
    verify.addEventListener("click", async () => {
      if (!confirm("Verify " + a.name + "? Their profile becomes public with a Verified badge.")) return;
      try { await B.verify(a); toast("Verified."); refresh(); } catch (e) { toast(errText(e)); }
    });
    detail.appendChild(field("Note", note));
    detail.appendChild(el("div", { cls: "row-actions" }, [
      a.docsOk ? null : el("button", { cls: "pill", type: "button", text: "Documents OK", on: { click: () => act({ status: "docs_ok", docsOk: true, docsNote: note.value.trim() }) } }),
      el("button", { cls: "pill", type: "button", text: "Ask for more info", on: { click: () => act({ status: "info_needed" }, true) } }),
      a.needsVisit ? null : el("button", { cls: "pill", type: "button", text: "Require a visit", on: { click: () => act({ status: "visit_required", needsVisit: true, docsOk: !!a.docsOk }) } }),
      verify,
      el("button", { cls: "pill danger", type: "button", text: "Reject", on: { click: () => act({ status: "rejected" }, true) } })
    ]));
    if (why) detail.appendChild(el("p", { cls: "fhint", text: why }));
  }
  li.appendChild(head); li.appendChild(detail);
  return li;
}

// ------------------------------------------------------------------ comments
// Comments and shared contacts wait here; only approved ones show in the directory.
async function comments(body) {
  const list = await B.pendingComments();
  list.sort((a, b) => ((a.at && a.at.toMillis ? a.at.toMillis() : 0) - (b.at && b.at.toMillis ? b.at.toMillis() : 0)));
  setSub(list.length + " comment(s) waiting.");
  if (!list.length) return body.appendChild(card([el("p", { cls: "muted", text: "Nothing waiting." })]));
  body.appendChild(el("p", { cls: "note", text: "Approve only what helps someone reach or help the group. Reject accusations, personal attacks, money requests and anything you cannot stand behind." }));
  const ul = el("ul", { cls: "list" });
  list.forEach((c) => {
    const note = el("input", { maxlength: "300", placeholder: "Reason (shown only here)" });
    const act = (status) => async () => {
      try { await B.moderate(c, status, note.value.trim()); toast(status === "approved" ? "Approved." : "Rejected."); comments(clear(body)); } catch (e) { toast(errText(e)); }
    };
    ul.appendChild(el("li", { cls: "item open" }, [el("div", { cls: "detail" }, [
      el("div", { cls: "nm", text: c.gname || c.gid }),
      el("p", { cls: "fhint", text: [c.district, c.state].filter(Boolean).join(", ") + ". From " + (c.name || "A visitor") + ", " + fmtDate(c.at) }),
      el("p", { text: c.text || "" }),
      c.contact ? el("p", null, [el("b", { text: "Shared contact: " }), c.contact]) : null,
      el("div", { cls: "row-actions" }, [
        el("a", { cls: "pill", href: "./#q=" + encodeURIComponent(c.gname || ""), target: "_blank", rel: "noopener", text: "Open in directory" }),
        note,
        el("button", { cls: "pill blue", type: "button", text: "Approve", on: { click: act("approved") } }),
        el("button", { cls: "pill danger", type: "button", text: "Reject", on: { click: act("rejected") } })
      ])
    ])]));
  });
  body.appendChild(ul);
}

// ------------------------------------------------------------------ reports
async function reports(body) {
  const list = await B.reports();
  setSub(list.length + " open report(s).");
  if (!list.length) return body.appendChild(card([el("p", { cls: "muted", text: "No open reports." })]));
  const ul = el("ul", { cls: "list" });
  list.forEach((r) => {
    const note = el("input", { maxlength: "500", placeholder: "What you did" });
    const reason = (REPORT_REASONS.find((x) => x[0] === r.reason) || [0, r.reason])[1];
    ul.appendChild(el("li", { cls: "item open" }, [el("div", { cls: "detail" }, [
      el("div", { cls: "nm", text: (r.targetName || r.target) + ": " + reason }),
      el("p", { text: r.text || "" }), el("p", { cls: "fhint", text: "From " + (r.email || "") + ", " + fmtDate(r.createdAt) }),
      el("div", { cls: "row-actions" }, [
        el("a", { cls: "pill", href: "./#q=" + encodeURIComponent(r.targetName || ""), target: "_blank", rel: "noopener", text: "Open in directory" }),
        note,
        el("button", { cls: "pill blue", type: "button", text: "Resolve", on: { click: async () => {
          if (!note.value.trim()) return toast("Write what you did.");
          try { await B.resolveReport(r.id, note.value.trim()); toast("Resolved."); reports(clear(body)); } catch (e) { toast(errText(e)); } } } })
      ])
    ])]));
  });
  body.appendChild(ul);
}

// ------------------------------------------------------------------ coordinators
async function coordinators(body) {
  const list = (await B.coordinators()).sort((a, b) => (a.state + a.district).localeCompare(b.state + b.district));
  setSub(list.length + " coordinator(s). They vouch for groups and do visits in their area.");
  const states = DIR ? Object.keys(DIR.meta.states).sort() : [];
  const mail = el("input", { type: "email", placeholder: "coordinator@email", maxlength: "200" });
  const name = el("input", { placeholder: "Name", maxlength: "100" });
  const st = select([["", "State"]].concat(states.map((s) => [s, s])), "");
  const di = select([["*", "All districts"]], "*");
  st.addEventListener("change", () => {
    clear(di); di.appendChild(el("option", { value: "*", text: "All districts" }));
    ((DIR && DIR.meta.states[st.value]) || []).map((d) => d[0]).sort().forEach((d) => di.appendChild(el("option", { value: d, text: d })));
  });
  const add = el("button", { cls: "pill blue", type: "button", text: "Appoint", on: { click: async () => {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail.value.trim()) || !st.value) return toast("Email and state are needed.");
    try { await B.setCoordinator(mail.value.trim(), st.value, di.value, name.value.trim()); toast("Appointed."); coordinators(clear(body)); } catch (e) { toast(errText(e)); }
  } } });
  body.appendChild(card([expander("Appoint a coordinator", el("div", null, [
    el("div", { cls: "grid2" }, [field("Email", mail), field("Name", name), field("State", st), field("District", di)]),
    el("div", { cls: "row-actions" }, [add])]), !list.length)]));
  const ul = el("ul", { cls: "list" });
  list.forEach((c) => ul.appendChild(el("li", { cls: "item" }, [el("div", { cls: "head static" }, [
    el("div", { cls: "body" }, [el("div", { cls: "nm", text: (c.name ? c.name + "  |  " : "") + c.id }),
      el("div", { cls: "meta", text: c.state + (c.district === "*" ? ", all districts" : ", " + c.district) })]),
    el("button", { cls: "pill", type: "button", text: "Remove", on: { click: async () => {
      if (!confirm("Remove " + c.id + " as coordinator?")) return;
      try { await B.removeCoordinator(c.id); coordinators(clear(body)); } catch (e) { toast(errText(e)); } } } })
  ])])));
  body.appendChild(ul);
}

// ------------------------------------------------------------------ audit
async function audit(body) {
  const list = await B.auditLog();
  setSub("Every review step, newest first. Entries cannot be edited or deleted.");
  const ul = el("ul", { cls: "audit" });
  list.forEach((x) => ul.appendChild(el("li", null, [
    el("span", { cls: "muted", text: fmtDate(x.at) + "  " }), el("b", { text: x.action }), " ", x.target || "",
    el("span", { cls: "muted", text: "  by " + (x.email || x.by) }), x.note ? el("div", { cls: "fhint", text: x.note }) : null
  ])));
  body.appendChild(card([ul]));
}

start();
