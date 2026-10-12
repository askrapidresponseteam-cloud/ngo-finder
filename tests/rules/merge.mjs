// The directory's rules block (between the NGO-DIRECTORY markers in
// firestore.rules), placed inside Rapid Response's own rules, as it is
// published in the rrt-new-backend project.
import { readFileSync } from "node:fs";

export function block() {
  const s = readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8");
  const a = s.indexOf("    // ===== NGO-DIRECTORY START =====");
  const b = s.indexOf("// ===== NGO-DIRECTORY END =====");
  if (a < 0 || b < 0) throw new Error("NGO-DIRECTORY markers missing in firestore.rules");
  return s.slice(a, b + "// ===== NGO-DIRECTORY END =====".length) + "\n";
}

// rrt: the text of RRT's rules file. The block goes just before the two
// closing braces of "match /databases/{database}/documents" and "service".
export function merge(rrt) {
  // An earlier copy of the block (however it was indented) is replaced, never doubled.
  const start = rrt.indexOf("// ===== NGO-DIRECTORY START =====");
  if (start >= 0) {
    const end = "// ===== NGO-DIRECTORY END =====";
    const e = rrt.indexOf(end, start);
    if (e < 0) throw new Error("The rules have the directory's start marker but not its end marker; fix them by hand.");
    const a = rrt.lastIndexOf("\n", start) + 1;
    let b = e + end.length;
    if (rrt[b] === "\n") b++;
    rrt = rrt.slice(0, a) + rrt.slice(b);
  }
  const last = rrt.lastIndexOf("}");
  const inner = rrt.lastIndexOf("}", last - 1);
  return rrt.slice(0, inner).replace(/\s*$/, "\n\n") + block() + "  " + rrt.slice(inner);
}
