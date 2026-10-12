// Federation add-ons for the public directory: Verified badges, capacity,
// open needs (items and help only, never money), claim and report links,
// "Did you reach them?" and comments (checked by an admin before they show).
import { backend } from "./api.js";
import { el, clear, toast, errText, moneyIn, NO_MONEY, NEED_KINDS, fmtDate } from "./common.js";

const KIND = Object.fromEntries(NEED_KINDS);
// The portal sits next to this folder, wherever the directory is served from.
const JOIN = new URL("../join.html", import.meta.url).href;
const INTAKE = { open: "Taking animals in", limited: "Limited space", full: "Full right now" };

export async function attach() {
  const B = await backend();
  if (!B) return null;
  let index;
  // Refused until the rules are published (or offline): the directory then
  // runs on its own, with the plain "Tell us" link.
  try { index = await B.publicIndex(); } catch (e) { return null; }
  const verified = index.verified || {};
  try { await B.finishLink(); } catch (e) { /* not a sign-in link */ }
  let me = B.user();
  B.onUser((u) => { me = u; });

  const WHY = [["no_answer", "No answer"], ["wrong_number", "Wrong number"], ["email_bounced", "Email bounced"],
    ["closed", "Closed down"], ["other", "Something else"]];
  const ms = (t) => (t && t.toMillis ? t.toMillis() : 0);

  // Sign in once (Google, or a link by email), so each answer is one real person.
  function signIn(slot, then) {
    if (me) { then(); return; }
    clear(slot);
    const mail = el("input", { type: "email", placeholder: "Your email", autocomplete: "email", "aria-label": "Your email" });
    slot.append(
      el("p", { cls: "fbq", text: "Sign in once, so every answer comes from a real person. We never show your email." }),
      el("div", { cls: "row-actions" }, [
        el("button", { cls: "pill dark", type: "button", text: "Continue with Google", on: { click: async () => {
          try { await B.signInGoogle(); me = B.user(); clear(slot); then(); } catch (e) { toast(errText(e)); } } } }),
        mail,
        el("button", { cls: "pill", type: "button", text: "Email me a link", on: { click: async () => {
          const v = mail.value.trim();
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { toast("Enter your email address."); return; }
          try { await B.sendLink(v); clear(slot).appendChild(el("p", { cls: "fbq", text: "Check " + v + " for the sign-in link, then answer again." })); }
          catch (e) { toast(errText(e)); } } } })
      ]));
  }

  function needItem(n, withGroup, go) {
    return el("li", { cls: "need" + (n.urgent ? " urgent" : "") }, [
      el("div", { cls: "meta" }, [el("span", { cls: "chip", text: KIND[n.kind] || n.kind }), n.urgent ? el("span", { cls: "chip flag", text: "Urgent" }) : null,
        el("span", { text: "until " + fmtDate(n.expiresAt) })]),
      el("div", { cls: "ntext", text: n.text }),
      withGroup ? el("button", { cls: "linkish", type: "button", text: n.name + ", " + n.district + ", " + n.state,
        on: { click: () => go({ q: n.name }) } }) : null
    ]);
  }

  return {
    verified,

    // In a group's details, under its contacts: did the contacts work, and comments.
    feedback(box, o) {
      const gid = o._id;
      const tally = el("span", { cls: "fbtally" });
      const slot = el("div", { cls: "fbslot" });
      const list = el("ul", { cls: "comments" });
      const yes = el("button", { cls: "pill", type: "button", text: "Yes" });
      const no = el("button", { cls: "pill", type: "button", text: "No" });
      box.append(el("div", { cls: "fbask" }, [el("span", { cls: "fbq", text: "Did you reach them?" }), yes, no, tally]), slot);

      function count() {
        B.checksFor(gid).then((all) => {
          const ok = all.filter((c) => c.ok).length, bad = all.length - ok;
          const last = all.reduce((m, c) => Math.max(m, ms(c.at)), 0);
          tally.textContent = all.length
            ? [ok ? ok + " reached them" : "", bad ? bad + " could not" : ""].filter(Boolean).join(", ") + (last ? " (latest " + fmtDate(new Date(last)) + ")" : "")
            : "";
          const mine = me && all.find((c) => c.uid === me.uid);
          yes.setAttribute("aria-pressed", String(!!(mine && mine.ok)));
          no.setAttribute("aria-pressed", String(!!(mine && !mine.ok)));
        }).catch(() => {});
      }
      async function save(ok, why) {
        try { await B.check(gid, ok, why); clear(slot); toast("Thanks. That helps the next person."); count(); }
        catch (e) { toast(errText(e)); }
      }
      yes.addEventListener("click", () => signIn(slot, () => save(true, "")));
      no.addEventListener("click", () => signIn(slot, () => {
        clear(slot).append(el("p", { cls: "fbq", text: "What happened?" }),
          el("div", { cls: "row-actions" }, WHY.map(([k, l]) => el("button", { cls: "pill", type: "button", text: l, on: { click: () => save(false, k) } }))));
      }));
      count();

      // Comments: approved ones for everyone, plus your own while it waits.
      const add = el("button", { cls: "more-toggle", type: "button", text: "+ Add a comment or a working number" });
      box.append(el("div", { cls: "sec", text: "Comments" }), list, add);
      function draw() {
        Promise.all([B.commentsFor(gid).catch(() => []), me ? B.myComment(gid).catch(() => null) : null]).then(([pub, mine]) => {
          clear(list);
          pub.sort((a, b) => ms(b.at) - ms(a.at));
          if (mine && mine.status !== "approved") pub.unshift(mine);
          if (!pub.length) list.appendChild(el("li", { cls: "none", text: "No comments yet." }));
          pub.forEach((c) => list.appendChild(el("li", { cls: "comment" }, [
            el("div", { cls: "cmeta", text: (c.name || "A visitor") + ", " + fmtDate(c.at) +
              (c.status === "pending" ? ". Yours, waiting for a check" : c.status === "rejected" ? ". Yours, not approved" : "") }),
            el("div", { text: c.text }),
            c.contact ? el("div", { cls: "cmeta", text: "Shared contact: " + c.contact }) : null
          ])));
        });
      }
      add.addEventListener("click", () => signIn(slot, () => {
        const text = el("textarea", { rows: "3", maxlength: "1000", placeholder: "What happened when you contacted them? Anything that helps the next person." });
        const contact = el("input", { maxlength: "200", placeholder: "A working phone, email or website (optional)" });
        clear(slot).append(text, contact,
          el("p", { cls: "fhint", text: "Checked by the Rapid Response team before it shows. No money requests or accusations; for serious problems use Report a problem." }),
          el("div", { cls: "row-actions" }, [el("button", { cls: "pill dark", type: "button", text: "Send", on: { click: async () => {
            const t = text.value.trim(), c = contact.value.trim();
            if (t.length < 3) { toast("Write a few words."); return; }
            const m = moneyIn(t, c);
            if (m) { toast(NO_MONEY.replace("%s", m)); return; }
            try {
              await B.comment({ gid, name: o.n, state: o.st, district: o.d }, t, c);
              clear(slot).appendChild(el("p", { cls: "fbq", text: "Thanks. It shows here once the team has checked it." }));
              draw();
            } catch (e) { toast(errText(e)); }
          } } })]));
        text.focus();
      }));
      draw();
    },

    // Appended to a group's details when it is opened.
    detail(d, o) {
      const box = el("div", { cls: "fed-box" });
      d.appendChild(box);
      const links = el("div", { cls: "row-actions" }, [
        verified[o._id] ? null : el("a", { cls: "act", href: JOIN + "?g=" + encodeURIComponent(o._id), text: "Is this your group? Claim it" }),
        el("a", { cls: "act", href: JOIN + "?report=" + encodeURIComponent(o._id) + "&name=" + encodeURIComponent(o.n), text: "Report a problem" })
      ]);
      if (!verified[o._id]) { box.appendChild(links); return; }
      Promise.all([B.profile(o._id), B.needsFor(o._id)]).then(([p, needs]) => {
        if (p) {
          const cap = p.capacity || {};
          box.appendChild(el("div", { cls: "sec", text: "From the group (verified " + fmtDate(p.verifiedAt) + ")" }));
          box.appendChild(el("div", { cls: "meta" }, [cap.intake ? el("span", { cls: "chip " + (cap.intake === "full" ? "flag" : "fed"), text: INTAKE[cap.intake] }) : null,
            cap.note ? el("span", { text: cap.note }) : null, p.hours ? el("span", { text: "Hours: " + p.hours }) : null]));
          if (p.about) box.appendChild(el("p", { cls: "about", text: p.about }));
          if (p.phones && p.phones.length) box.appendChild(el("div", { cls: "row-actions" }, p.phones.slice(0, 2).map((ph) => el("a", { cls: "act primary", href: "tel:" + ph.replace(/[^0-9+]/g, ""), text: "Call " + ph }))));
        }
        const t = Date.now();
        const open = needs.filter((n) => n.status === "open" && n.expiresAt && n.expiresAt.toMillis() > t);
        if (open.length) {
          box.appendChild(el("div", { cls: "sec", text: "What they need now" }));
          box.appendChild(el("ul", { cls: "needs" }, open.map((n) => needItem(n, false))));
        }
        box.appendChild(links);
      }).catch(() => box.appendChild(links));
    },

    // "Needs" view: open needs across India, newest and most urgent first.
    async needsView(view, h) {
      h.setHeader([["India", () => h.go({})]], "What groups need now", "Loading...");
      let all = [];
      try { all = await B.openNeeds(); } catch (e) { /* none */ }
      all.sort((a, b) => (b.urgent - a.urgent) || ((b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0) - (a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0)));
      const states = Array.from(new Set(all.map((n) => n.state))).sort();
      let pick = "";
      const bar = el("nav", { cls: "types sub" });
      const list = el("ul", { cls: "needs" });
      const draw = () => {
        Array.from(bar.children).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.s === pick)));
        list.textContent = "";
        all.filter((n) => !pick || n.state === pick).forEach((n) => list.appendChild(needItem(n, true, h.go)));
      };
      [""].concat(states).forEach((s) => bar.appendChild(el("button", { cls: "pill", type: "button", "data-s": s, text: s || "All states", on: { click: () => { pick = s; draw(); } } })));
      h.setHeader([["India", () => h.go({})]], "What groups need now",
        all.length ? all.length + " open need" + (all.length === 1 ? "" : "s") + " from verified groups. Items and help only: no money is ever asked for here." : "No open needs right now.");
      if (states.length > 1) view.appendChild(bar);
      view.appendChild(el("section", { cls: "card" }, [list]));
      draw();
    }
  };
}
