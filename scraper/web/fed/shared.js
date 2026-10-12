// Pieces shared by the NGO portal and the admin console.
import { el, fmtDate, REG_TYPES, toast, errText } from "./common.js";

export function appSummary(a) {
  const reg = (REG_TYPES.find((r) => r[0] === a.regType) || [0, a.regType])[1];
  const dl = el("dl");
  const line = (k, v) => { if (v) { dl.appendChild(el("dt", { text: k })); dl.appendChild(typeof v === "string" ? el("dd", { text: v }) : el("dd", null, [v])); } };
  line("Group", a.name);
  line("Kind", a.kind === "claim" ? "Claim of a listed group" : "New group");
  line("Place", [a.town, a.district, a.state].filter(Boolean).join(", "));
  line("Address", a.address);
  line("Applicant", (a.email || "") + (a.role ? ", " + a.role : ""));
  line("Registration", reg + ": " + (a.regNumber || ""));
  line("Official contact", [a.phone, a.officialEmail, a.website].filter(Boolean).join("  |  "));
  line("About", a.about);
  line("Voucher asked", a.voucherEmail || "A coordinator for the district");
  if (a.driveLink && /^https:\/\//.test(a.driveLink)) line("Drive folder", el("a", { href: a.driveLink, target: "_blank", rel: "noopener", text: "Open shared folder" }));
  if (a.vouch) line("Vouch", (a.vouch.ok ? "Yes, by " : "No, by ") + a.vouch.email + (a.vouch.note ? ": " + a.vouch.note : ""));
  if (a.visit) line("Visit", (a.visit.ok ? "Passed (" : "Not passed (") + a.visit.how + ") by " + a.visit.email + (a.visit.note ? ": " + a.visit.note : ""));
  line("Sent", fmtDate(a.createdAt));
  return dl;
}

// Proof documents, loaded only when asked for.
export function proofList(B, a) {
  const box = el("div", { cls: "proofs" });
  if (!a.proofs || !a.proofs.length) return el("p", { cls: "fhint", text: "No document photos attached." });
  const btn = el("button", { cls: "pill", type: "button", text: "Show " + a.proofs.length + " document(s)" });
  btn.addEventListener("click", async () => {
    btn.remove();
    for (const id of a.proofs) {
      try {
        const p = await B.proof(id);
        if (!p) continue;
        // Browsers will not open data: links in a tab, so hand them a blob link.
        const bin = atob(p.data.split(",")[1]), bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const url = URL.createObjectURL(new Blob([bytes], { type: p.type }));
        if (p.type === "application/pdf") {
          box.appendChild(el("a", { cls: "pill", href: url, target: "_blank", rel: "noopener", text: "Open " + p.name }));
        } else {
          box.appendChild(el("a", { href: url, target: "_blank", rel: "noopener", title: p.name }, [el("img", { src: p.data, alt: p.name, loading: "lazy" })]));
        }
      } catch (e) { toast(errText(e)); }
    }
  });
  box.appendChild(btn);
  return box;
}
