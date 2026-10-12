// Federation add-ons for the public directory: Verified badges, capacity,
// open needs (items and help only, never money), claim and report links.
import { backend } from "./api.js";
import { el, NEED_KINDS, fmtDate } from "./common.js";

const KIND = Object.fromEntries(NEED_KINDS);
const INTAKE = { open: "Taking animals in", limited: "Limited space", full: "Full right now" };

export async function attach() {
  const B = await backend();
  if (!B) return null;
  let index = { verified: {} };
  try { index = await B.publicIndex(); } catch (e) { /* show the directory without badges */ }
  const verified = index.verified || {};

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

    // Appended to a group's details when it is opened.
    detail(d, o) {
      const box = el("div", { cls: "fed-box" });
      d.appendChild(box);
      const links = el("div", { cls: "row-actions" }, [
        verified[o._id] ? null : el("a", { cls: "act", href: "join.html?g=" + encodeURIComponent(o._id), text: "Is this your group? Claim it" }),
        el("a", { cls: "act", href: "join.html?report=" + encodeURIComponent(o._id) + "&name=" + encodeURIComponent(o.n), text: "Report a problem" })
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
