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
  if (rrt.includes("NGO-DIRECTORY START")) {
    const a = rrt.indexOf("    // ===== NGO-DIRECTORY START =====");
    const end = "// ===== NGO-DIRECTORY END =====";
    const b = rrt.indexOf(end) + end.length + 1;
    rrt = rrt.slice(0, a) + rrt.slice(b);
  }
  const last = rrt.lastIndexOf("}");
  const inner = rrt.lastIndexOf("}", last - 1);
  return rrt.slice(0, inner).replace(/\s*$/, "\n\n") + block() + "  " + rrt.slice(inner);
}
