/* Karnataka animal NGOs lookup. Data is inserted with textContent only. */
(function () {
  "use strict";

  var CATS = [["all", "All"], ["animal", "Animal welfare"], ["wildlife", "Wildlife"], ["cattle", "Gaushala"]];
  var CAT_LABEL = { animal: "Animal welfare", wildlife: "Wildlife", cattle: "Gaushala" };
  var PAGE = 40;
  var SMALL = /^(of|for|and|the|to|a|an|in|on|at)$/i;
  var st = { q: "", cat: "all", district: null, shown: PAGE, contact: false, people: false, awbi: false, verified: false };
  var ORGS = [], DISTRICTS = {}, META = {};

  // ---------------------------------------------------------------- helpers
  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (!Object.prototype.hasOwnProperty.call(attrs, k) || attrs[k] == null) continue;
      if (k === "text") e.textContent = attrs[k];
      else if (k === "cls") e.className = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function svg(paths, size) {
    var ns = "http://www.w3.org/2000/svg";
    var s = document.createElementNS(ns, "svg");
    s.setAttribute("width", size || 14); s.setAttribute("height", size || 14); s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "2.4");
    s.setAttribute("aria-hidden", "true");
    paths.forEach(function (p) {
      var path = document.createElementNS(ns, "path");
      path.setAttribute("d", p[0]); if (p[1]) path.setAttribute("class", p[1]);
      s.appendChild(path);
    });
    return s;
  }
  function safe(u) { return /^(https?:|tel:|mailto:)/i.test(u || "") ? u : ""; }
  function host(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return u; } }
  function plural(n, w) { return n + " " + w + (n === 1 ? "" : "s"); }
  function districtLabel(d) { return d === "Unknown" ? "District not known" : d; }
  function initials(s) {
    var words = (s || "").replace(/\([^)]*\)/g, " ").split(/[^A-Za-z]+/).filter(Boolean);
    var all = words.map(function (w) { return w[0]; }).join("");
    var sig = words.filter(function (w) { return !SMALL.test(w); }).map(function (w) { return w[0]; }).join("");
    return (all + " " + sig).toLowerCase();
  }
  function roleRank(r) {
    r = (r || "").toLowerCase();
    if (/found/.test(r)) return 0;
    if (/managing trustee|president|chair/.test(r)) return 1;
    if (/secretary|director|ceo|head/.test(r)) return 2;
    return 3;
  }
  var toastTimer;
  function toast(msg) {
    var t = $("toast"); t.textContent = msg; t.classList.add("on");
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove("on"); }, 1800);
  }

  // ------------------------------------------------------------------ state
  function readHash() {
    var h = new URLSearchParams(location.hash.replace(/^#/, ""));
    st.q = h.get("q") || "";
    st.district = h.get("d") && DISTRICTS[h.get("d")] ? h.get("d") : null;
    st.cat = h.get("t") && CAT_LABEL[h.get("t")] ? h.get("t") : "all";
    st.shown = PAGE;
  }
  function writeHash() {
    var h = new URLSearchParams();
    if (st.district) h.set("d", st.district);
    if (st.q) h.set("q", st.q);
    if (st.cat !== "all") h.set("t", st.cat);
    var s = h.toString();
    history.replaceState(null, "", s ? "#" + s : location.pathname + location.search);
  }

  function passes(o) {
    if (st.cat !== "all" && o.c.indexOf(st.cat) < 0) return false;
    if (st.contact && !o.p.length && !o.e.length) return false;
    if (st.people && !o.pp.length) return false;
    if (st.awbi && !o.ac) return false;
    if (st.verified && o.u) return false;
    return true;
  }
  function score(o) {
    if (!st.q) return 1;
    var words = st.q.toLowerCase().split(/\s+/).filter(Boolean);
    for (var i = 0; i < words.length; i++) if (o._s.indexOf(words[i]) < 0) return 0;
    var q = st.q.toLowerCase(), names = [o.n].concat(o.k).join(" | ").toLowerCase();
    if (names.indexOf(q) === 0) return 4;
    if (names.indexOf(q) >= 0) return 3;
    if ((" " + o._i + " ").indexOf(" " + q) >= 0) return 3;
    return 1;
  }

  // ------------------------------------------------------------------ views
  var view;

  function render() {
    writeHash();
    view.textContent = "";
    if (!st.q && !st.district) renderDistricts();
    else renderResults();
  }

  function renderDistricts() {
    var counts = {};
    ORGS.forEach(function (o) { if (passes(o)) counts[o.d] = (counts[o.d] || 0) + 1; });
    var names = Object.keys(DISTRICTS).sort(function (a, b) {
      if (a === "Unknown") return 1; if (b === "Unknown") return -1;
      return (counts[b] || 0) - (counts[a] || 0) || a.localeCompare(b);
    });
    view.appendChild(el("h2", { text: "Pick a district" }));
    var wrap = el("div", { cls: "tiles" });
    names.forEach(function (d) {
      var n = counts[d] || 0;
      var t = el("button", { cls: "tile" + (n ? "" : " zero"), type: "button" },
        [el("span", { text: districtLabel(d) }), el("span", { cls: "count", text: String(n) })]);
      t.addEventListener("click", function () { st.district = d; st.shown = PAGE; render(); window.scrollTo(0, 0); });
      wrap.appendChild(t);
    });
    view.appendChild(wrap);
  }

  function renderResults() {
    var list = [];
    ORGS.forEach(function (o) {
      if (st.district && o.d !== st.district) return;
      if (!passes(o)) return;
      var s = score(o);
      if (s) list.push([s, o]);
    });
    list.sort(function (a, b) { return b[0] - a[0] || a[1].n.localeCompare(b[1].n); });
    list = list.map(function (x) { return x[1]; });

    var bar = el("div", { cls: "bar" });
    if (st.district) {
      var back = el("button", { cls: "back", type: "button" }, [svg([["M15 6l-6 6 6 6"]]), "All districts"]);
      back.addEventListener("click", function () { st.district = null; render(); });
      bar.appendChild(back);
    }
    bar.appendChild(el("h2", { text: st.district ? districtLabel(st.district) : "Search results" }));
    bar.appendChild(el("span", { cls: "n", text: plural(list.length, "group") }));
    var share = el("button", { cls: "share", type: "button", text: "Copy link" });
    share.addEventListener("click", function () {
      var url = location.href;
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { toast("Link copied"); }, function () { toast(url); });
      else toast(url);
    });
    bar.appendChild(share);
    view.appendChild(bar);

    if (!list.length) {
      var e = el("div", { cls: "empty" }, [
        el("div", { text: st.q ? "Nothing matches \"" + st.q + "\"" + (st.district ? " in " + districtLabel(st.district) : "") + "." : "No groups here with these filters." }),
        el("div", { cls: "n", text: "Try a town name, a short name like PFA, fewer words, or a different type." })
      ]);
      var reset = el("button", { cls: "back", type: "button", text: "Clear search and filters" });
      reset.addEventListener("click", resetAll);
      e.appendChild(reset);
      view.appendChild(e);
      return;
    }

    var ul = el("ul", { cls: "list" });
    list.slice(0, st.shown).forEach(function (o) { ul.appendChild(row(o)); });
    view.appendChild(ul);
    if (list.length > st.shown) {
      var more = el("button", { cls: "showmore", type: "button", text: "Show " + Math.min(PAGE, list.length - st.shown) + " more" });
      more.addEventListener("click", function () { st.shown += PAGE; render(); });
      view.appendChild(more);
    }
  }

  function resetAll() {
    q.value = ""; st.q = ""; box.classList.remove("has"); st.cat = "all";
    st.contact = st.people = st.awbi = st.verified = false;
    ["fContact", "fPeople", "fAwbi", "fVerified"].forEach(function (id) { $(id).checked = false; });
    syncPills(); render();
  }

  var rowId = 0;
  function row(o) {
    var li = el("li", { cls: "item" });
    var id = "d" + (++rowId);
    var area = [o.a, st.district ? "" : districtLabel(o.d)].filter(function (v, i, a) { return v && a.indexOf(v) === i; }).join(", ");
    var meta = el("div", { cls: "meta" }, [
      el("span", { cls: "tag", text: o.c.map(function (c) { return CAT_LABEL[c]; }).join(", ") || "Type not clear" }),
      area ? el("span", { text: area }) : null,
      o.ac ? el("span", { cls: "awbi", title: "Recognised by the Animal Welfare Board of India", text: "AWBI" }) : null,
      o.u ? el("span", { cls: "flag", text: "Not verified" }) : null
    ]);
    var aka = null;
    var bare = function (x) { return x.toLowerCase().replace(/[^a-z0-9]/g, ""); };
    var alt = o.k.filter(function (k) { return bare(o.n).indexOf(bare(k)) < 0 && bare(k).indexOf(bare(o.n)) < 0; })[0];
    if (alt) aka = el("div", { cls: "aka", text: "Also known as " + alt });
    var runby = null;
    if (o.pp.length) {
      var lead = o.pp[0];
      runby = el("div", { cls: "runby" }, ["Run by ", el("b", { text: lead.n }),
        lead.r ? ", " + lead.r.charAt(0).toLowerCase() + lead.r.slice(1) : "",
        o.pp.length > 1 ? " +" + (o.pp.length - 1) + " more" : ""]);
    }
    var plus = el("span", { cls: "plus", "aria-hidden": "true" });
    plus.appendChild(svg([["M5 12h14"], ["M12 5v14", "v"]]));
    var head = el("button", { cls: "head", type: "button", "aria-expanded": "false", "aria-controls": id },
      [el("div", { cls: "body" }, [el("div", { cls: "nm", text: o.n }), aka, meta, runby]), plus]);
    var detail = el("div", { cls: "detail", id: id });
    var built = false;
    head.addEventListener("click", function () {
      var open = !li.classList.contains("open");
      if (open && !built) { fillDetail(detail, o); built = true; }
      li.classList.toggle("open", open);
      head.setAttribute("aria-expanded", String(open));
    });
    li.appendChild(head); li.appendChild(detail);
    return li;
  }

  function act(label, href, primary) {
    href = safe(href); if (!href) return null;
    var a = el("a", { cls: "act" + (primary ? " primary" : ""), href: href, text: label });
    if (/^https?:/i.test(href)) { a.target = "_blank"; a.rel = "noopener"; }
    return a;
  }
  function linkList(arr, toHref, toText) {
    if (!arr.length) return null;
    var span = el("span", { cls: "srcs" });
    arr.forEach(function (x, i) {
      var h = safe(toHref(x));
      if (i && !toText) span.appendChild(document.createTextNode(", "));
      if (h) {
        var a = el("a", { href: h, text: toText ? toText(x) : x.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") });
        if (/^https?:/i.test(h)) { a.target = "_blank"; a.rel = "noopener"; }
        span.appendChild(a);
      } else span.appendChild(el("span", { text: x }));
    });
    return span;
  }

  function fillDetail(d, o) {
    var acts = el("div", { cls: "actions" }, [
      o.p[0] ? act("Call " + o.p[0], "tel:" + o.p[0].replace(/[^\d+]/g, ""), true) : null,
      o.e[0] ? act("Email", "mailto:" + o.e[0], !o.p[0]) : null,
      act("Website", o.w),
      o.s[0] ? act(/instagram/i.test(o.s[0]) ? "Instagram" : /facebook/i.test(o.s[0]) ? "Facebook" : "Social page", o.s[0]) : null,
      act("Map", o.m)
    ]);
    if (acts.children.length) d.appendChild(acts);

    d.appendChild(el("div", { cls: "sec", text: "Who runs it" }));
    if (o.pp.length) {
      var ul = el("ul", { cls: "people" });
      o.pp.forEach(function (p) {
        var src = safe(p.u) ? el("a", { href: p.u, target: "_blank", rel: "noopener", text: "source: " + (p.h || "web") }) : null;
        ul.appendChild(el("li", null, [el("span", { text: p.n }), p.r ? el("span", { cls: "role", text: ", " + p.r }) : null, src]));
      });
      d.appendChild(ul);
    } else {
      d.appendChild(el("p", { cls: "none", text: (o.p.length || o.e.length || o.w)
        ? "No names published. Ask when you call or email."
        : "No names or contact found yet." }));
    }

    var tog = el("button", { cls: "more-toggle", type: "button", "aria-expanded": "false" },
      [svg([["M12 5v14M5 12h14", "fv"]]), el("span", { text: "More details" })]);
    var more = el("div", { cls: "more" });
    var dl = el("dl");
    function line(k, v) { if (v) { dl.appendChild(el("dt", { text: k })); dl.appendChild(typeof v === "string" ? el("dd", { text: v }) : el("dd", null, [v])); } }
    if (o.k.length) line("Also known as", o.k.join(", "));
    if (o.ad && o.ad !== o.a) line("Address", o.ad);
    if (o.ra && o.ra !== o.ad) line(o.ad ? "Registered address" : "Address", o.ra);
    line("Area", [o.a, districtLabel(o.d)].filter(Boolean).join(", "));
    line("Phones", linkList(o.p, function (x) { return "tel:" + x.replace(/[^\d+]/g, ""); }));
    line("Emails", linkList(o.e, function (x) { return "mailto:" + x; }));
    line("Website", linkList(o.w ? [o.w] : [], function (x) { return x; }));
    line("Social", linkList(o.s, function (x) { return x; }));
    if (o.ac) line("AWBI", "Recognised, code " + o.ac + (o.av ? ", valid till " + o.av : ""));
    if (o.u) line("Check", "Found only by web search. Confirm it is an active NGO before relying on it.");
    if (o.nt.length) line("Notes", o.nt.join(". "));
    line("Sources", linkList(o.sr, function (x) { return x; }, host));
    more.appendChild(dl);
    tog.addEventListener("click", function () {
      var open = !more.classList.contains("open");
      more.classList.toggle("open", open); tog.setAttribute("aria-expanded", String(open));
      tog.querySelector(".fv").setAttribute("d", open ? "M5 12h14" : "M12 5v14M5 12h14");
    });
    d.appendChild(tog); d.appendChild(more);
  }

  // ---------------------------------------------------------------- wiring
  var pills, q, box;
  function syncPills() {
    Array.prototype.forEach.call(pills.children, function (x) { x.setAttribute("aria-pressed", String(x.getAttribute("data-cat") === st.cat)); });
  }

  function boot(DB) {
    META = DB.meta || {};
    ORGS = DB.orgs || [];
    ORGS.forEach(function (o) {
      o.k = o.k || []; o.sr = o.sr || [];
      o.pp.sort(function (a, b) { return roleRank(a.r) - roleRank(b.r); });
      o._i = [o.n].concat(o.k).map(initials).join(" ");
      o._s = [o.n, o.k.join(" "), o.d, o.a, o.ad, o.ra, o.ac, o._i]
        .concat(o.pp.map(function (p) { return p.n + " " + p.r; })).join(" ").toLowerCase();
      DISTRICTS[o.d] = 1;
    });
    var real = Object.keys(DISTRICTS).filter(function (d) { return d !== "Unknown"; }).length;
    $("sub").textContent = plural(ORGS.length, "group") + " across " + plural(real, "district") +
      (META.date ? ". Updated " + META.date + "." : ".");

    var foot = $("foot");
    foot.appendChild(el("p", { text: "Sources: the Animal Welfare Board of India list of recognised organisations" +
      (META.awbi_date ? " (as on " + META.awbi_date + ")" : "") +
      ", the groups' own websites and pages, news reports and NGO directories. Every entry links to where its details come from." }));
    foot.appendChild(el("p", { text: "Names under \"Who runs it\" are as published by each source; confirm when you get in touch." }));
    if (META.ola) foot.appendChild(el("p", { text: "Map listings from Ola Maps. That data is available under the Open Database License." }));

    pills = $("pills");
    CATS.forEach(function (c) {
      var b = el("button", { cls: "pill", type: "button", "data-cat": c[0], "aria-pressed": "false", text: c[1] });
      b.addEventListener("click", function () { st.cat = c[0]; st.shown = PAGE; syncPills(); render(); });
      pills.appendChild(b);
    });

    var ft = $("ftoggle"), fl = $("filters");
    ft.addEventListener("click", function () {
      var open = !fl.classList.contains("open");
      fl.classList.toggle("open", open); ft.setAttribute("aria-expanded", String(open));
      ft.querySelector(".fv").setAttribute("d", open ? "M5 12h14" : "M12 5v14M5 12h14");
    });
    [["fContact", "contact"], ["fPeople", "people"], ["fAwbi", "awbi"], ["fVerified", "verified"]].forEach(function (p) {
      $(p[0]).addEventListener("change", function (e) { st[p[1]] = e.target.checked; st.shown = PAGE; render(); });
    });

    q = $("q"); box = $("searchbox");
    var timer;
    q.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(function () { st.q = q.value.trim(); st.shown = PAGE; box.classList.toggle("has", !!q.value); render(); }, 120);
    });
    $("clear").addEventListener("click", function () { q.value = ""; st.q = ""; box.classList.remove("has"); render(); q.focus(); });

    view = $("view");
    function fromHash() {
      readHash();
      q.value = st.q; box.classList.toggle("has", !!st.q);
      syncPills();
      render();
    }
    window.addEventListener("hashchange", fromHash);
    fromHash();
  }

  function fail(msg) {
    var v = $("view"); v.textContent = "";
    v.appendChild(el("div", { cls: "err", text: msg }));
    $("sub").textContent = "";
  }

  function start() {
    var inline = document.getElementById("data");
    if (inline && /^\s*\{/.test(inline.textContent)) {
      try { boot(JSON.parse(inline.textContent)); } catch (e) { fail("The directory data could not be read."); }
      return;
    }
    fetch("data/ngos.json", { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(boot)
      .catch(function () { fail("The directory could not be loaded. Check your connection and refresh the page."); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
