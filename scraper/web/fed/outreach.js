// Admin outreach log: pick an NGO, record a call, email, message or visit, update its
// contact details, and look everything up in one searchable table. Written for people
// who are not used to computers: one question at a time, big targets, plain words.
import { el, clear, toast, errText, findGroups, fold, fmtDate } from "./common.js";

const METHODS = [["phone", "Phone call"], ["email", "Email"], ["whatsapp", "WhatsApp"], ["visit", "Visit"]];
const RESPONSES = [["yes", "Yes, they responded"], ["no", "No response"], ["wrong", "Wrong number or email"]];
const METHOD = Object.fromEntries(METHODS);
const RESPONSE = Object.fromEntries(RESPONSES);
const RESPONSE_SHORT = { yes: "Responded", no: "No response", wrong: "Wrong contact" };

function today() {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
function showDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : (s || "");
}
const ms = (t) => (t && t.toMillis ? t.toMillis() : 0);
const placeOf = (r) => [r.district, r.state].filter((x) => x && x !== "Unknown").join(", ");
const phoneOk = (v) => !v || v.replace(/\D/g, "").length >= 8;
const emailOk = (v) => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
const webOk = (v) => !v || /^https?:\/\/\S+\.\S+/.test(v);

// A field with a big label above it and an optional hint below.
function field(label, input, hint, id) {
  input.id = id;
  return el("div", { cls: "ofield" }, [el("label", { cls: "olabel", for: id, text: label }), input,
    hint ? el("div", { cls: "ohint", text: hint }) : null]);
}
// One choice out of a few, as big buttons (real radio buttons underneath).
function choice(name, options, legend, onChange) {
  const box = el("fieldset", { cls: "ochoice" }, [el("legend", { cls: "olabel", text: legend })]);
  options.forEach(([v, l]) => {
    const r = el("input", { type: "radio", name, value: v });
    r.addEventListener("change", () => onChange && onChange(v));
    box.appendChild(el("label", { cls: "otile" }, [r, el("span", { text: l })]));
  });
  box.value = () => (box.querySelector("input:checked") || {}).value || "";
  box.set = (v) => box.querySelectorAll("input").forEach((r) => { r.checked = r.value === v; });
  return box;
}

export async function outreachTab(body, ctx) {
  const { B, DIR, setSub } = ctx;
  let records = [];
  let picked = null;    // { gid, name, state, district, org }
  let editing = null;   // the record being edited
  let checked = null;   // contact details the team confirmed earlier, for the picked NGO

  // ---------------------------------------------------------------- 1. the NGO
  const step1 = el("section", { cls: "card ostep" });
  const find = el("input", { type: "search", autocomplete: "off", placeholder: "For example: CUPA, Udupi, Gaushala" });
  const picks = el("ul", { cls: "opicks" });
  const chosen = el("div", { cls: "ochosen", hidden: true });

  // ---------------------------------------------------------------- 2. what happened
  const step2 = el("section", { cls: "card ostep" });
  const person = el("input", { type: "text", maxlength: "120", autocomplete: "off" });
  const method = choice("omethod", METHODS, "How did you contact them?");
  const when = el("input", { type: "date", max: today() });
  const publish = el("input", { type: "checkbox", checked: true });
  const response = choice("oresponse", RESPONSES, "Did they respond?", (v) => { publish.checked = v !== "wrong"; });
  const phone = el("input", { type: "tel", maxlength: "40", autocomplete: "off", placeholder: "+91 98450 00000" });
  const email = el("input", { type: "email", maxlength: "200", autocomplete: "off", placeholder: "name@example.org" });
  const website = el("input", { type: "url", maxlength: "300", autocomplete: "off", placeholder: "https://" });
  const comments = el("textarea", { rows: "4", maxlength: "3000" });
  const save = el("button", { cls: "obig primary", type: "button", text: "Save" });
  const cancel = el("button", { cls: "obig", type: "button", text: "Clear the form" });
  const errors = el("div", { cls: "oerrors", role: "alert" });
  const title2 = el("h2", { cls: "otitle", text: "2. What happened?" });

  // ---------------------------------------------------------------- 3. the log
  const step3 = el("section", { cls: "card ostep" });
  const search = el("input", { type: "search", autocomplete: "off", placeholder: "NGO, person, place or words in comments" });
  const fResp = el("select", null, [el("option", { value: "", text: "All responses" })].concat(RESPONSES.map(([v]) => el("option", { value: v, text: RESPONSE_SHORT[v] }))));
  const fMeth = el("select", null, [el("option", { value: "", text: "All methods" })].concat(METHODS.map(([v, l]) => el("option", { value: v, text: l }))));
  const count = el("p", { cls: "ocount", "aria-live": "polite" });
  const table = el("table", { cls: "otable" });
  const csv = el("button", { cls: "obig", type: "button", text: "Download as spreadsheet (CSV)" });
  let sortKey = "when", sortDir = -1;

  body.append(step1, step2, step3);
  step1.append(el("h2", { cls: "otitle", text: "1. Which NGO?" }),
    field("Type the NGO's name or town", find, "Then tap the right one in the list.", "ofind"), picks, chosen);
  step2.append(title2,
    field("Contact person", person, "Who you spoke or wrote to. Leave empty if you do not know.", "operson"),
    method,
    field("Date", when, "When you contacted them.", "owhen"),
    response,
    el("div", { cls: "osub" }, [el("div", { cls: "olabel", text: "Contact details" }),
      el("div", { cls: "ohint", text: "Add or correct what you found out. Leave a box empty if you do not know." })]),
    el("div", { cls: "ogrid" }, [field("Phone", phone, null, "ophone"), field("Email", email, null, "oemail"), field("Website", website, null, "oweb")]),
    el("label", { cls: "ocheck" }, [publish, el("span", { text: "Show these contact details on the public directory" })]),
    field("Comments", comments, "Anything the next person should know.", "ocomments"),
    errors,
    el("div", { cls: "oactions" }, [save, cancel]));
  step3.append(el("h2", { cls: "otitle", text: "Outreach log" }),
    el("div", { cls: "otools" }, [field("Search", search, null, "osearch"),
      field("Response", fResp, null, "ofresp"), field("Method", fMeth, null, "ofmeth"), csv]),
    count, el("div", { cls: "otablewrap" }, [table]));

  // ---------------------------------------------------------------- behaviour
  // Step 2 appears only once an NGO is chosen: one question at a time.
  function setStep2(on) { step2.hidden = !on; }

  function resetForm() {
    editing = null;
    title2.textContent = "2. What happened?";
    save.textContent = "Save";
    cancel.textContent = "Clear the form";
    person.value = ""; comments.value = ""; when.value = today();
    method.set(""); response.set(""); publish.checked = true; errors.textContent = "";
    fillContacts();
  }

  function fillContacts() {
    const o = picked && picked.org;
    phone.value = (checked && checked.phones && checked.phones[0]) || (o && o.p && o.p[0]) || "";
    email.value = (checked && checked.emails && checked.emails[0]) || (o && o.e && o.e[0]) || "";
    website.value = (checked && checked.website) || (o && o.w) || "";
  }

  async function pick(p) {
    picked = p; checked = null;
    clear(picks); find.value = "";
    find.closest(".ofield").hidden = true;
    clear(chosen).hidden = false;
    const known = [];
    if (p.org) {
      if (p.org.p && p.org.p.length) known.push("Phone: " + p.org.p.join(", "));
      if (p.org.e && p.org.e.length) known.push("Email: " + p.org.e.join(", "));
    }
    const past = records.filter((r) => r.gid === p.gid).length;
    chosen.append(el("div", { cls: "oname", text: p.name }), el("div", { cls: "oplace", text: placeOf(p) }),
      known.length ? el("div", { cls: "ohint", text: "In the directory: " + known.join(". ") }) : el("div", { cls: "ohint", text: "No phone or email in the directory yet." }),
      past ? el("div", { cls: "ohint", text: past + " earlier record" + (past === 1 ? "" : "s") + " in the log below." }) : null,
      el("button", { cls: "obig", type: "button", text: "Choose a different NGO", on: { click: unpick } }));
    setStep2(true);
    try { checked = await B.contactsFor(p.gid); } catch (e) { checked = null; }
    if (checked) chosen.insertBefore(el("div", { cls: "ohint", text: "Checked by the team on " + showDate(checked.checkedOn) + ": " +
      [checked.phones.join(", "), checked.emails.join(", "), checked.website].filter(Boolean).join(". ") }), chosen.lastChild);
    if (!editing) fillContacts();
    person.focus();
  }

  function unpick() {
    picked = null; checked = null;
    chosen.hidden = true; find.closest(".ofield").hidden = false;
    resetForm(); setStep2(false); find.focus();
  }

  find.addEventListener("input", () => {
    clear(picks);
    const q = find.value.trim();
    if (q.length < 2 || !DIR) return;
    const hits = findGroups(q, 8);
    if (!hits.length) { picks.appendChild(el("li", { cls: "ohint", text: "No NGO matches \"" + q + "\". Try fewer letters or the town." })); return; }
    hits.forEach((o) => picks.appendChild(el("li", null, [el("button", { cls: "opick", type: "button", on: { click: () => pick({ gid: o._id, name: o.n, state: o.st, district: o.d, org: o }) } },
      [el("span", { cls: "oname", text: o.n }), el("span", { cls: "oplace", text: [o.a, o.d !== "Unknown" ? o.d : "", o.st].filter(Boolean).join(", ") })])])));
  });

  function problems() {
    const out = [];
    if (!picked) out.push("Choose the NGO first (step 1).");
    if (!method.value()) out.push("Choose how you contacted them.");
    if (!when.value) out.push("Enter the date.");
    else if (when.value > today()) out.push("The date cannot be in the future.");
    if (!response.value()) out.push("Choose whether they responded.");
    if (!phoneOk(phone.value.trim())) out.push("The phone number looks too short.");
    if (!emailOk(email.value.trim())) out.push("The email address does not look right.");
    if (!webOk(website.value.trim())) out.push("The website should start with https://");
    return out;
  }

  save.addEventListener("click", async () => {
    const bad = problems();
    clear(errors);
    if (bad.length) { errors.append(el("ul", null, bad.map((t) => el("li", { text: t })))); errors.scrollIntoView({ block: "center" }); return; }
    const rec = {
      gid: picked.gid, gname: picked.name, state: picked.state || "", district: picked.district || "",
      person: person.value.trim(), method: method.value(), when: when.value, response: response.value(),
      phone: phone.value.trim(), email: email.value.trim().toLowerCase(), website: website.value.trim(), comments: comments.value.trim()
    };
    save.disabled = true; save.textContent = "Saving...";
    try {
      await B.saveOutreach(rec, editing);
      if (publish.checked && rec.response !== "wrong" && (rec.phone || rec.email || rec.website)) {
        await B.saveContacts({ gid: rec.gid, name: rec.gname, state: rec.state, district: rec.district },
          { phones: rec.phone ? [rec.phone] : ((checked && checked.phones) || []), emails: rec.email ? [rec.email] : ((checked && checked.emails) || []),
            website: rec.website || ((checked && checked.website) || "") }, rec.when);
      }
      toast(editing ? "Changes saved." : "Saved: " + METHOD[rec.method].toLowerCase() + " with " + rec.gname + ".");
      await load();
      unpick();
      step3.scrollIntoView({ behavior: "smooth" });
    } catch (e) {
      errors.append(el("p", { text: "Not saved. " + errText(e) }));
    } finally {
      save.disabled = false; save.textContent = editing ? "Save changes" : "Save";
    }
  });
  ["input", "change"].forEach((ev) => step2.addEventListener(ev, () => { if (errors.textContent) clear(errors); }));
  cancel.addEventListener("click", () => { if (editing) unpick(); else resetForm(); });

  function edit(r) {
    const o = DIR && DIR.orgs.find((x) => x._id === r.gid);
    editing = r;
    pick({ gid: r.gid, name: r.gname, state: r.state, district: r.district, org: o || null }).then(() => {
      person.value = r.person || ""; method.set(r.method); when.value = r.when; response.set(r.response);
      phone.value = r.phone || ""; email.value = r.email || ""; website.value = r.website || ""; comments.value = r.comments || "";
      publish.checked = false;
    });
    title2.textContent = "Edit this record";
    save.textContent = "Save changes";
    cancel.textContent = "Cancel";
    step1.scrollIntoView({ behavior: "smooth" });
  }

  async function remove(r) {
    if (!confirm("Delete this record?\n\n" + r.gname + ", " + showDate(r.when) + "\n\nThis cannot be undone. It stays in the audit log.")) return;
    try { await B.deleteOutreach(r); toast("Deleted."); await load(); } catch (e) { toast(errText(e)); }
  }

  // ---------------------------------------------------------------- the table
  const COLS = [["when", "Date"], ["gname", "NGO"], ["person", "Contact person"], ["method", "Method"], ["response", "Response"],
    ["contact", "Contact details"], ["comments", "Comments"], ["by", "Logged by"], ["", ""]];

  function shown() {
    const terms = fold(search.value).split(/\s+/).filter(Boolean);
    return records.filter((r) => (!fResp.value || r.response === fResp.value) && (!fMeth.value || r.method === fMeth.value) &&
      terms.every((t) => fold([r.gname, r.person, r.district, r.state, r.comments, r.phone, r.email, r.createdByEmail].join(" ")).includes(t)))
      .sort((a, b) => {
        const x = sortKey === "gname" ? fold(a.gname).localeCompare(fold(b.gname)) : (a.when || "").localeCompare(b.when || "") || (ms(a.createdAt) - ms(b.createdAt));
        return x * sortDir;
      });
  }

  function draw() {
    const list = shown();
    count.textContent = records.length ? "Showing " + list.length + " of " + records.length + " record" + (records.length === 1 ? "" : "s") + "." : "No outreach logged yet.";
    clear(table);
    const head = el("tr");
    COLS.forEach(([k, l]) => {
      if (k === "when" || k === "gname") {
        const arrow = sortKey === k ? (sortDir < 0 ? " (newest first)" : " (oldest first)") : "";
        const label = k === "gname" ? (sortKey === k ? (sortDir > 0 ? " (A to Z)" : " (Z to A)") : "") : arrow;
        head.appendChild(el("th", { scope: "col", "aria-sort": sortKey === k ? (sortDir > 0 ? "ascending" : "descending") : "none" },
          [el("button", { cls: "osort", type: "button", text: l + label, on: { click: () => { sortDir = sortKey === k ? -sortDir : (k === "gname" ? 1 : -1); sortKey = k; draw(); } } })]));
      } else head.appendChild(el("th", { scope: "col", text: l }));
    });
    table.appendChild(el("thead", null, [head]));
    const tb = el("tbody");
    list.forEach((r) => {
      const contact = [r.phone, r.email, r.website].filter(Boolean);
      tb.appendChild(el("tr", null, [
        el("td", { "data-label": "Date", text: showDate(r.when) }),
        el("td", { "data-label": "NGO" }, [el("div", null, [el("div", { cls: "oname", text: r.gname }), el("div", { cls: "oplace", text: placeOf(r) })])]),
        el("td", { "data-label": "Contact person", text: r.person || "-" }),
        el("td", { "data-label": "Method", text: METHOD[r.method] || r.method }),
        el("td", { "data-label": "Response" }, [el("span", { cls: "oresp " + r.response, text: RESPONSE_SHORT[r.response] || r.response })]),
        el("td", { "data-label": "Contact details" }, [el("div", null, contact.length ? contact.map((c) => el("div", { text: c })) : ["-"])]),
        el("td", { "data-label": "Comments", cls: "ocomm", text: r.comments || "-" }),
        el("td", { "data-label": "Logged by" }, [el("div", null, [el("div", { text: (r.createdByEmail || "").split("@")[0] }),
          r.rev ? el("div", { cls: "oplace", text: "edited " + fmtDate(r.updatedAt) }) : null])]),
        el("td", { cls: "orow-actions" }, [
          el("button", { cls: "osmall", type: "button", text: "Edit", "aria-label": "Edit the record for " + r.gname, on: { click: () => edit(r) } }),
          el("button", { cls: "osmall danger", type: "button", text: "Delete", "aria-label": "Delete the record for " + r.gname, on: { click: () => remove(r) } })])
      ]));
    });
    table.appendChild(tb);
  }
  [search, fResp, fMeth].forEach((x) => x.addEventListener("input", draw));

  csv.addEventListener("click", () => {
    const cell = (v) => { v = String(v == null ? "" : v); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const rows = [["Date", "NGO", "District", "State", "Contact person", "Method", "Response", "Phone", "Email", "Website", "Comments", "Logged by", "Last changed"]]
      .concat(shown().map((r) => [r.when, r.gname, r.district, r.state, r.person, METHOD[r.method], RESPONSE_SHORT[r.response], r.phone, r.email, r.website,
        r.comments, r.createdByEmail, fmtDate(r.updatedAt)]));
    const url = URL.createObjectURL(new Blob(["﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" }));
    const a = el("a", { href: url, download: "outreach-log-" + today() + ".csv" });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  });

  async function load() {
    records = await B.outreachAll();
    const done = records.filter((r) => r.response === "yes").length;
    setSub(records.length + " outreach record" + (records.length === 1 ? "" : "s") + ", " + done + " with a response.");
    draw();
  }

  resetForm(); setStep2(false);
  await load();
}
