// Node test reporter: every failing test becomes a GitHub annotation on the run.
export default async function* annotate(source) {
  let pass = 0, fail = 0;
  for await (const ev of source) {
    if (ev.type === "test:pass" && ev.data.details && ev.data.details.type !== "suite") pass++;
    if (ev.type === "test:fail" && ev.data.details && ev.data.details.type !== "suite") {
      fail++;
      const err = ev.data.details.error || {};
      const cause = err.cause || err;
      const msg = String((cause && (cause.message || cause)) || "failed").replace(/\r?\n/g, "%0A").slice(0, 900);
      yield "::error title=Rules test failed::" + ev.data.name + ": " + msg + "\n";
    }
  }
  yield "::notice title=Rules tests::" + pass + " passed, " + fail + " failed\n";
}
