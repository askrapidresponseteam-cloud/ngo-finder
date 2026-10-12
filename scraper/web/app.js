/* Animal NGOs of India. Scraped data is only ever inserted with textContent. */
(function () {
  "use strict";

  var TYPES = [["all", "All", "i-grid"], ["animal", "Animal welfare", "i-paw"], ["wildlife", "Wildlife", "i-leaf"], ["cattle", "Gaushala", "i-cow"]];
  var TYPE_LABEL = { animal: "Animal welfare", wildlife: "Wildlife", cattle: "Gaushala" };
  var PAGE = 40, TOP = 6, SCALE = 20;
  var SMALL = /^(of|for|and|the|to|a|an|in|on|at)$/i;
  var NS = "http://www.w3.org/2000/svg";
  var st = { v: "", q: "", cat: "all", state: null, district: null, shown: PAGE, contact: false, people: false, awbi: false, verified: false };
  var ORGS = [], META = {}, GEO = {}, SHAPES = {};
  var FED = null, VERIFIED = {};  // federation add-ons (fed/public.js), when set up
  var view;

  // Data and add-ons load from beside this script, so the directory also runs
  // inside another site's page (rapid-response.in/ngos) from a container
  // <div id="ngo-app" class="ngo-rr"></div>.
  var BASE = (function () {
    var s = document.currentScript;
    try { return s && s.src ? new URL(".", s.src).href : ""; } catch (e) { return ""; }
  })();
  var ROOT = null, SITE = "Kindaura", SUFFIX = "";
  var SPRITE = '<svg class="sprite" aria-hidden="true"><defs><symbol id="i-grid" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></symbol><symbol id="i-pin" viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></symbol><symbol id="i-search" viewBox="0 0 24 24"><circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/></symbol><symbol id="i-filter" viewBox="0 0 24 24"><path d="M3 7h18M3 17h18"/><circle cx="9" cy="7" r="3" class="hole"/><circle cx="15" cy="17" r="3" class="hole"/></symbol><symbol id="i-link" viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></symbol><symbol id="i-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></symbol><symbol id="i-arrow" viewBox="0 0 24 24"><path d="M7 17 17 7M7 7h10v10"/></symbol><symbol id="i-back" viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></symbol><symbol id="i-heart" viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></symbol><symbol id="i-x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></symbol><symbol id="i-paw" viewBox="0 0 24 24"><ellipse cx="12" cy="16" rx="4.5" ry="3.8"/><circle cx="6" cy="10.5" r="1.9"/><circle cx="9.6" cy="6.6" r="1.9"/><circle cx="14.4" cy="6.6" r="1.9"/><circle cx="18" cy="10.5" r="1.9"/></symbol><symbol id="i-leaf" viewBox="0 0 24 24"><path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15"/><path d="M5 19 13 11"/></symbol><symbol id="i-cow" viewBox="0 0 24 24"><path d="M6 8 3 6M18 8l3-2"/><rect x="6" y="7" width="12" height="11" rx="5"/><path d="M9.5 15h.01M14.5 15h.01"/></symbol><symbol id="i-locate" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></symbol><symbol id="i-download" viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></symbol><symbol id="i-phone" viewBox="0 0 24 24"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"/></symbol></defs></svg>';
  function mount() {
    var host = document.getElementById("ngo-app");
    if (!host || document.getElementById("view")) return;
    ROOT = host;
    SITE = "Animal NGOs of India";  // inside another site, its own name stays in the tab
    SUFFIX = host.getAttribute("data-title-suffix") || "";
    host.innerHTML = SPRITE +
      '<div class="shell embed">' +
      '<div class="eyebar"><span class="eyebrow">' + (host.getAttribute("data-eyebrow") || "Animal NGO directory").replace(/[&<>"]/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }) + '</span>' +
      '<nav class="viewnav" aria-label="Sections">' +
      '<button type="button" data-go="home">Overview</button>' +
      '<button type="button" data-go="states">All states</button>' +
      '<button type="button" data-go="needs" id="needsBtn" hidden>Needs</button>' +
      '</nav></div>' +
      '<section class="intro"><div class="intro-text"><div class="crumbs" id="crumbs"></div>' +
      '<h1 id="title">Animal NGOs of India</h1><div class="muted" id="sub">Loading the directory...</div></div></section>' +
      '<header class="top"><div class="finderslot" id="finderSlot"></div>' +
      '<label class="searchbox" id="searchbox"><svg class="icon"><use href="#i-search"/></svg>' +
      '<input id="q" type="search" autocomplete="off" placeholder="Group, person or town" aria-label="Search groups, people or towns">' +
      '<button class="clear" id="clear" type="button" aria-label="Clear search"><svg class="icon"><use href="#i-x"/></svg></button></label></header>' +
      '<div class="subbar"><nav class="types" id="types" aria-label="Type of group"></nav>' +
      '<div class="tools"><button class="round" id="filterBtn" type="button" aria-label="Filters" aria-expanded="false" aria-controls="filters">' +
      '<svg class="icon"><use href="#i-filter"/></svg><span class="dot" id="filterDot"></span></button>' +
      '<button class="pill blue" id="share" type="button" aria-label="Copy link"><svg class="icon"><use href="#i-link"/></svg><span class="tl">Copy link</span></button>' +
      '<button class="pill" id="csv" type="button" aria-label="Download CSV"><svg class="icon"><use href="#i-download"/></svg><span class="tl">Download CSV</span></button></div></div>' +
      '<div class="filters card" id="filters" hidden>' +
      '<label><input type="checkbox" id="fContact"> Has a phone or email</label>' +
      '<label><input type="checkbox" id="fPeople"> We know who runs it</label>' +
      '<label><input type="checkbox" id="fAwbi"> AWBI recognised</label>' +
      '<label><input type="checkbox" id="fVerified"> Hide unverified web finds</label>' +
      '<label hidden><input type="checkbox" id="fFed"> Only groups verified by the federation</label></div>' +
      '<main id="view" aria-live="polite"><div class="loading"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div></main>' +
      '</div>' +
      '<div class="toast" id="toast" role="status"></div>';
  }
  function scope() { return ROOT || document; }
  function toTop() {
    if (!ROOT) { window.scrollTo(0, 0); return; }
    if (ROOT.getBoundingClientRect().top < 0) ROOT.scrollIntoView();
  }

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
    add(e, kids);
    return e;
  }
  function add(parent, kids) {
    (kids || []).forEach(function (c) { if (c) parent.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return parent;
  }
  function sv(tag, attrs) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, attrs[k]);
    return e;
  }
  function icon(id) {
    var s = sv("svg", { "class": "icon", "aria-hidden": "true" });
    s.appendChild(sv("use", { href: "#" + id }));
    return s;
  }
  function on(node, fn) { node.addEventListener("click", fn); return node; }
  function safe(u) { return /^(https?:|tel:|mailto:)/i.test(u || "") ? u : ""; }
  function host(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return u; } }
  function fmt(n) { return Number(n).toLocaleString("en-IN"); }
  function plural(n, w, many) { return fmt(n) + " " + (n === 1 ? w : (many || w + "s")); }
  function pct(a, b) { return b ? Math.round(100 * a / b) : 0; }
  function dName(d) { return d === "Unknown" ? "District not known" : d; }
  function sName(s) { return s === "Unknown" ? "State not known" : s; }
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
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove("on"); }, 2200);
  }
  function copyLink() {
    var url = location.href;
    if (navigator.clipboard && /^https?:/.test(location.protocol)) {
      navigator.clipboard.writeText(url).then(function () { toast("Link copied"); }, function () { toast(url); });
    } else toast(url);
  }

  // ------------------------------------------------------------------ state
  function readHash() {
    var h = new URLSearchParams(location.hash.replace(/^#/, ""));
    st.q = h.get("q") || "";
    st.state = h.get("s") && GEO[h.get("s")] ? h.get("s") : (h.get("s") === "Unknown" ? "Unknown" : null);
    st.district = st.state && h.get("d") ? h.get("d") : null;
    st.cat = TYPE_LABEL[h.get("t")] ? h.get("t") : "all";
    st.v = ["states", "needs"].indexOf(h.get("v")) >= 0 && !st.state && !st.q ? h.get("v") : "";
    st.shown = PAGE;
  }
  function hashFor(o) {
    var h = new URLSearchParams();
    if (o.v) h.set("v", o.v);
    if (o.state) h.set("s", o.state);
    if (o.district) h.set("d", o.district);
    if (o.q) h.set("q", o.q);
    if (o.cat && o.cat !== "all") h.set("t", o.cat);
    var s = h.toString();
    return s ? "#" + s : location.pathname + location.search;
  }
  function sync(push) {
    var url = hashFor(st);
    if (url === (location.hash || location.pathname + location.search)) return;
    try { history[push ? "pushState" : "replaceState"](null, "", url); } catch (e) { /* file:// in some browsers */ }
  }
  // Move to another view (adds a browser history step so Back works).
  function go(o) {
    st.v = o.v || ""; st.state = o.state || null; st.district = o.district || null;
    st.q = o.q != null ? o.q : ""; st.shown = PAGE;
    q.value = st.q; box.classList.toggle("has", !!st.q);
    sync(true); render(); toTop();
  }

  function passes(o) {
    if (st.cat !== "all" && o.c.indexOf(st.cat) < 0) return false;
    if (st.contact && !o.p.length && !o.e.length) return false;
    if (st.people && !o.pp.length) return false;
    if (st.awbi && !o.ac) return false;
    if (st.verified && o.u) return false;
    if (st.fedOnly && !VERIFIED[o._id]) return false;
    return true;
  }
  function pool(scope) {
    return ORGS.filter(function (o) {
      if (scope && scope.state && o.st !== scope.state) return false;
      if (scope && scope.district && o.d !== scope.district) return false;
      return passes(o);
    });
  }
  function countBy(list, key) {
    var c = {};
    list.forEach(function (o) { var k = key(o); c[k] = (c[k] || 0) + 1; });
    return c;
  }

  // ---------------------------------------------------------------- search
  // One index over every field of every group. A query word matches a word in
  // a record exactly, by its start, by sound (Ganguli = Ganguly, Goshala =
  // Gaushala = Gowshala), inside a longer word, or with a typo or two.
  var FIELDS = [
    // [record key, label shown as "Matched in", weight]
    ["n", "Name", 10], ["k", "Also known as", 8], ["pp", "People", 8], ["ac", "AWBI code", 7],
    ["p", "Phone", 6], ["e", "Email", 6], ["w", "Website", 5], ["d", "District", 4], ["st", "State", 4],
    ["a", "Area", 4], ["ad", "Address", 3], ["ra", "Registered address", 3], ["s", "Social", 3],
    ["nt", "Notes", 2], ["src", "Source", 1]
  ];
  var MARKS = new RegExp("[" + String.fromCharCode(0x300) + "-" + String.fromCharCode(0x36f) + "]", "g");
  var IDX = null;

  function fold(s) { return String(s || "").normalize("NFD").replace(MARKS, "").toLowerCase(); }
  function wordsOf(s) { return fold(s).split(/[^a-z0-9]+/).filter(Boolean); }
  // Sound-alike key for Indian names and spellings.
  function pk(w) {
    if (/^[0-9]+$/.test(w)) return w;
    w = w.replace(/ph/g, "f").replace(/([bdtkgcs])h/g, "$1").replace(/ow(?=[^aeiou]|$)/g, "o")
      .replace(/au|ou/g, "o").replace(/w/g, "v").replace(/z/g, "j").replace(/q/g, "k").replace(/ck/g, "k")
      .replace(/ee|ie/g, "i").replace(/oo/g, "u").replace(/y/g, "i").replace(/(.)\1+/g, "$1");
    return w.length > 4 ? w.replace(/a$/, "") : w;
  }
  function lev(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    var prev = [], cur, i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      var best = i;
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (cur[j] < best) best = cur[j];
      }
      if (best > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }
  function fieldText(o, key) {
    var v = o[key];
    if (key === "pp") return v.map(function (p) { return p.n + (p.r ? ", " + p.r : ""); });
    if (key === "p") return v.map(function (x) { return x + " " + x.replace(/[^0-9]/g, ""); });
    if (key === "st") return [sName(v)];
    if (key === "d") return [v === "Unknown" ? "" : v];
    if (Array.isArray(v)) return v;
    return [v || ""];
  }
  function buildIndex() {
    var vocab = {};
    ORGS.forEach(function (o, i) {
      FIELDS.forEach(function (f) {
        var texts = fieldText(o, f[0]);
        if (f[0] === "n" || f[0] === "k") texts = texts.concat([initials(texts.join(" "))]);
        texts.forEach(function (t) {
          wordsOf(t).forEach(function (w) {
            var hits = vocab[w] || (vocab[w] = {});
            if (!hits[i] || hits[i] < f[2]) hits[i] = f[2];
          });
        });
      });
    });
    var words = Object.keys(vocab);
    var keys = {};
    words.forEach(function (w) { keys[w] = pk(w); });
    IDX = { vocab: vocab, words: words, keys: keys };
  }
  // Words in the index that a query word matches, with how well (4 best).
  function matchWord(t) {
    // Only real matches count: the whole word, its start, the same sound, or
    // (for 4+ letters) inside a longer word. Typos never produce results; they
    // only produce a "Did you mean" suggestion.
    var out = {}, tk = pk(t), digits = /^[0-9]+$/.test(t);
    IDX.words.forEach(function (w) {
      var lvl = 0, wk = IDX.keys[w];
      if (w === t) lvl = 4;
      else if (w.indexOf(t) === 0) lvl = 3.5;
      else if (!digits && wk === tk) lvl = 3;
      else if (!digits && tk.length >= 4 && wk.indexOf(tk) === 0) lvl = 2.5;
      else if (t.length >= 4 && w.indexOf(t) > 0) lvl = digits ? 3 : 2;
      if (lvl) out[w] = lvl;
    });
    return out;
  }
  // The likeliest intended word for a word that matches nothing: same first
  // letter, one or two letters different, used by the most groups.
  function suggestWord(t) {
    var tk = pk(t);
    if (t.length < 4 || tk.length < 4 || /^[0-9]+$/.test(t)) return "";
    var maxd = t.length >= 8 ? 2 : 1, best = "", bestN = 0, bestD = 9;
    IDX.words.forEach(function (w) {
      var wk = IDX.keys[w];
      if (wk.charAt(0) !== tk.charAt(0) || Math.abs(wk.length - tk.length) > maxd) return;
      var d = lev(wk, tk, maxd);
      if (d > maxd) return;
      var n = Object.keys(IDX.vocab[w]).length;
      if (d < bestD || (d === bestD && n > bestN)) { best = w; bestN = n; bestD = d; }
    });
    return best;
  }
  function blobOf(o) {
    if (o._blob == null) {
      o._blob = " " + FIELDS.map(function (f) { return fieldText(o, f[0]).join(" "); }).join(" ").split(/[^A-Za-z0-9]+/)
        .map(fold).join(" ") + " ";
    }
    return o._blob;
  }
  // {list: [{o, score, words}], terms, suggest: [queries]} for a query, best first.
  // Every word must match (exactly, by its start, by sound or inside a word).
  function search(query) {
    if (!IDX) buildIndex();
    var terms = wordsOf(query).filter(function (t, i, a) { return a.indexOf(t) === i; });
    if (!terms.length) return { list: [], terms: [], suggest: [] };
    var per = terms.map(function (t) {
      var scores = {}, words = matchWord(t);
      Object.keys(words).forEach(function (w) {
        var hits = IDX.vocab[w];
        for (var i in hits) {
          // How well the word matched comes first, then which field it is in.
          var s = words[w] * 100 + hits[i];
          if (!scores[i] || scores[i].s < s) scores[i] = { s: s, w: w };
        }
      });
      return scores;
    });
    var ids = Object.keys(per[0]).filter(function (i) {
      for (var k = 1; k < per.length; k++) if (!per[k][i]) return false;
      return true;
    });
    var phrase = " " + terms.join(" ") + " ";
    var list = ids.map(function (i) {
      var o = ORGS[i], s = 0, words = [];
      per.forEach(function (sc) { s += sc[i].s; words.push(sc[i].w); });
      if (terms.length > 1 && blobOf(o).indexOf(phrase) >= 0) s += 80;        // the words together, in order
      var name = " " + wordsOf(o.n).join(" ") + " ";
      if (name.indexOf(phrase) >= 0) s += 60;
      if (name.indexOf(phrase) === 0) s += 30;
      return { o: o, score: s, words: words };
    }).filter(function (r) { return passes(r.o); });
    list.sort(function (x, y) { return y.score - x.score || x.o.n.localeCompare(y.o.n); });
    var suggest = [];
    if (!list.length) {
      var fixed = terms.map(function (t, k) { return Object.keys(per[k]).length ? t : suggestWord(t); });
      if (fixed.every(Boolean) && fixed.join(" ") !== terms.join(" ") && search(fixed.join(" ")).list.length) suggest.push({ q: fixed.join(" "), fix: true });
      if (terms.length > 1) terms.forEach(function (t, k) { if (Object.keys(per[k]).length) suggest.push({ q: t }); });
    }
    return { list: list, terms: terms, suggest: suggest };
  }
  // Where a record matched, for the "Matched in" line.
  function whereMatched(o, words) {
    // The field line holding the most of the matched words (ties: the more important field).
    var set = {}, best = null, bestN = 0;
    words.forEach(function (w) { set[w] = 1; });
    for (var f = 0; f < FIELDS.length; f++) {
      var key = FIELDS[f][0];
      if (key === "n") continue;
      var texts = fieldText(o, key);
      for (var t = 0; t < texts.length; t++) {
        var seen = {};
        wordsOf(texts[t]).forEach(function (w) { if (set[w]) seen[w] = 1; });
        var n = Object.keys(seen).length;
        if (n > bestN) { bestN = n; best = { label: FIELDS[f][1], text: key === "p" ? o.p[t] : texts[t] }; }
      }
    }
    return best;
  }
  // Text with the matched words wrapped in <mark>, built from text nodes only.
  function marked(text, words) {
    var set = {}, span = el("span"), last = 0, m, re = /[A-Za-z0-9]+/g;
    (words || []).forEach(function (w) { set[w] = 1; });
    text = String(text || "");
    while ((m = re.exec(text))) {
      if (!set[fold(m[0])]) continue;
      if (m.index > last) span.appendChild(document.createTextNode(text.slice(last, m.index)));
      span.appendChild(el("mark", { text: m[0] }));
      last = m.index + m[0].length;
    }
    if (last < text.length) span.appendChild(document.createTextNode(text.slice(last)));
    return span;
  }
  function placeHits(terms) {
    var hits = [];
    var match = function (name) {
      var ws = wordsOf(name);
      return terms.every(function (t) {
        return ws.some(function (w) { return w.indexOf(t) === 0 || pk(w) === pk(t); });
      });
    };
    Object.keys(GEO).forEach(function (s) {
      if (match(s)) hits.push({ label: s, go: function () { go({ state: s }); } });
      GEO[s].forEach(function (d) {
        if (match(d[0])) hits.push({ label: d[0] + ", " + s, go: function () { go({ state: s, district: d[0] }); } });
      });
    });
    return hits.slice(0, 8);
  }

  // -------------------------------------------------------------- the map
  function project(bbox) {
    var k = Math.cos((bbox[0] + bbox[2]) / 2 * Math.PI / 180);
    return {
      w: (bbox[3] - bbox[1]) * SCALE * k, h: (bbox[2] - bbox[0]) * SCALE,
      x: function (lon) { return (lon - bbox[1]) * SCALE * k; },
      y: function (lat) { return (bbox[2] - lat) * SCALE; }
    };
  }
  // spots: [{lat, lon, n, label, go}]
  // Ladakh is drawn inside the Jammu and Kashmir outline of the map data.
  function shapeOf(state) { return state === "Ladakh" ? "Jammu and Kashmir" : state; }
  function pathOf(rings, p) {
    return rings.map(function (r) {
      var d = "";
      for (var i = 0; i < r.length; i += 2) d += (i ? "L" : "M") + p.x(r[i]).toFixed(1) + " " + p.y(r[i + 1]).toFixed(1);
      return d + "Z";
    }).join("");
  }
  // opt: {counts: groups per state (overview), focus: the state being shown}
  function drawMap(bbox, spots, dims, opt) {
    opt = opt || {};
    var p = project(bbox);
    var zoom = 560 / Math.max(p.w, p.h);  // above 1 when zoomed in on a state
    var map = sv("svg", { "class": "map", viewBox: "0 0 " + p.w.toFixed(1) + " " + p.h.toFixed(1), role: "img",
      preserveAspectRatio: "xMidYMid meet", "aria-label": "Map of " + (opt.focus || "India") + " with " + plural(spots.length, "place") + " that have groups" });
    var defs = sv("defs", {}), pat = sv("pattern", { id: "hatch", width: "6", height: "6", patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" });
    pat.appendChild(sv("rect", { width: "6", height: "6", "class": "hatch-bg" }));
    pat.appendChild(sv("rect", { width: "3", height: "6", "class": "hatch-line" }));
    defs.appendChild(pat); map.appendChild(defs);
    var land = sv("g", { "class": "land" });
    var counts = opt.counts || {}, focus = opt.focus ? shapeOf(opt.focus) : "";
    Object.keys(SHAPES).forEach(function (name) {
      var n = 0;
      Object.keys(counts).forEach(function (st) { if (shapeOf(st) === name) n += counts[st]; });
      var cls = "st" + (focus ? (name === focus ? " sel" : " other") : (n ? " has" : ""));
      var path = sv("path", { "class": cls, d: pathOf(SHAPES[name], p) });
      var label = name === "Jammu and Kashmir" ? "Jammu and Kashmir, Ladakh" : name;
      path.appendChild(sv("title", {})).textContent = label + (focus ? "" : ": " + plural(n, "group"));
      if (!focus && n) {
        var target = name === "Jammu and Kashmir" && !counts[name] ? "Ladakh" : name;
        path.addEventListener("click", function () { go({ state: target }); });
      }
      land.appendChild(path);
    });
    map.appendChild(land);
    var unit = zoom > 1.6 ? Math.max(p.w, p.h) / 600 * 1.7 : 1;
    (dims || []).forEach(function (s) {
      var c = sv("circle", { "class": "spot dim", cx: p.x(s.lon).toFixed(1), cy: p.y(s.lat).toFixed(1), r: (3.4 * unit).toFixed(2) });
      c.appendChild(sv("title", {})).textContent = s.label;
      map.appendChild(c);
    });
    spots.sort(function (a, b) { return b.n - a.n; }).forEach(function (s) {
      var c = sv("circle", { "class": "spot", cx: p.x(s.lon).toFixed(1), cy: p.y(s.lat).toFixed(1),
        r: (zoom > 1.6 ? unit * Math.min(3.2 + Math.sqrt(s.n) * 1.9, 15) : Math.min(1.8 + Math.sqrt(s.n) * 0.9, 8)).toFixed(2), tabindex: "0", role: "button",
        "aria-label": s.label + ", " + plural(s.n, "group") });
      c.appendChild(sv("title", {})).textContent = s.label + ": " + plural(s.n, "group");
      c.addEventListener("click", s.go);
      c.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); s.go(); } });
      map.appendChild(c);
    });
    return map;
  }
  function districtSpots(list, state) {
    var counts = countBy(list, function (o) { return o.st + "|" + o.d; }), spots = [];
    Object.keys(GEO).forEach(function (s) {
      if (state && s !== state) return;
      GEO[s].forEach(function (d) {
        var n = counts[s + "|" + d[0]];
        if (d[1] == null) return;
        var spot = { lat: d[1], lon: d[2], n: n || 0, label: d[0] + (state ? "" : ", " + s) };
        spot.go = function () { go({ state: s, district: d[0] }); };
        spots.push(spot);
      });
    });
    return spots;
  }

  // ------------------------------------------------------ the easy way in
  // Near me, or a state then a district: the quickest way to groups close by.
  function finder() {
    var all = pool();
    var counts = countBy(all, function (o) { return o.st; });
    var dcounts = countBy(all, function (o) { return o.st + "|" + o.d; });
    var near = el("button", { cls: "pill dark near", type: "button" }, [icon("i-locate"), el("span", { text: "Near me" })]);
    on(near, function () { nearMe(near); });
    var sSel = el("select", { "aria-label": "State" });
    sSel.appendChild(el("option", { value: "", text: "Choose a state" }));
    Object.keys(GEO).filter(function (x) { return counts[x]; }).sort().forEach(function (x) {
      var o = el("option", { value: x, text: x + " (" + fmt(counts[x]) + ")" });
      o.selected = x === st.state;
      sSel.appendChild(o);
    });
    sSel.addEventListener("change", function () { go(sSel.value ? { state: sSel.value } : {}); });
    var kids = [near, sSel];
    if (st.state && GEO[st.state]) {
      var dSel = el("select", { "aria-label": "District" });
      dSel.appendChild(el("option", { value: "", text: "Choose a district" }));
      GEO[st.state].map(function (d) { return d[0]; }).filter(function (d) { return dcounts[st.state + "|" + d]; }).sort().forEach(function (d) {
        var o = el("option", { value: d, text: d + " (" + fmt(dcounts[st.state + "|" + d]) + ")" });
        o.selected = d === st.district;
        dSel.appendChild(o);
      });
      dSel.addEventListener("change", function () { go({ state: st.state, district: dSel.value || null }); });
      kids.push(dSel);
    }
    return el("div", { cls: "finder" }, kids);
  }
  function showFinder() {
    var slot = $("finderSlot");
    if (slot) { slot.textContent = ""; slot.appendChild(finder()); } else view.appendChild(finder());
  }
  function nearMe(btn) {
    var label = btn.lastChild;
    function done(msg) { btn.disabled = false; label.textContent = "Near me"; if (msg) toast(msg); }
    if (!navigator.geolocation) { done("Location is not available here. Choose a state instead."); return; }
    btn.disabled = true; label.textContent = "Finding you...";
    navigator.geolocation.getCurrentPosition(function (pos) {
      var lat = pos.coords.latitude, lon = pos.coords.longitude, k = Math.cos(lat * Math.PI / 180);
      var counts = countBy(pool(), function (o) { return o.st + "|" + o.d; });
      var best = null, nearest = null;
      Object.keys(GEO).forEach(function (s) {
        GEO[s].forEach(function (d) {
          if (d[1] == null) return;
          var dist = Math.pow(d[1] - lat, 2) + Math.pow((d[2] - lon) * k, 2);
          if (!nearest || dist < nearest.dist) nearest = { s: s, d: d[0], dist: dist };
          if (counts[s + "|" + d[0]] && (!best || dist < best.dist)) best = { s: s, d: d[0], dist: dist };
        });
      });
      if (!best || best.dist > 9) { done("No groups listed near you yet. Choose a state instead."); return; }
      done(nearest.d !== best.d ? "None listed in " + nearest.d + " yet, so this shows " + best.d + ", the nearest with groups." : "");
      go({ state: best.s, district: best.d });
    }, function () { done("Location is off. Allow it, or choose a state instead."); }, { timeout: 12000, maximumAge: 600000 });
  }

  // ------------------------------------------------------------ CSV download
  // Whatever the page shows (India, a state, a district, a search, with the
  // type and filters applied), every group in it, not just the first page.
  function currentList() {
    if (st.q) {
      var r = search(st.q);
      var fix = !r.list.length && r.suggest.filter(function (x) { return x.fix; })[0];
      if (fix) r = search(fix.q);
      return r.list.map(function (x) { return x.o; });
    }
    if (st.state) return pool({ state: st.state, district: st.district });
    return pool();
  }
  function csvCell(v) {
    v = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;  // never a spreadsheet formula
    return /[",\r\n]/.test(v) ? "\"" + v.replace(/"/g, "\"\"") + "\"" : v;
  }
  // +91 numbers as dialled inside India (0 and the number), so spreadsheets keep them as text.
  function phoneOut(p) { return /^\+91[\s-]?/.test(p) ? "0" + p.replace(/^\+91[\s-]?/, "") : p; }
  function downloadCsv() {
    var list = currentList();
    if (!list.length) { toast("Nothing to download here."); return; }
    var rows = [["Name", "Also known as", "Type", "Phone", "Other phones", "Email", "Other emails", "Website", "Social pages",
      "Address", "Town or area", "District", "State", "Who runs it", "AWBI code", "AWBI valid till", "Verified by the federation",
      "Found only by web search", "Notes", "Map", "Sources"]];
    list.forEach(function (o) {
      rows.push([o.n, o.k.join("; "), o.c.map(function (c) { return TYPE_LABEL[c]; }).join("; "),
        o.p[0] ? phoneOut(o.p[0]) : "", o.p.slice(1).map(phoneOut).join("; "), o.e[0] || "", o.e.slice(1).join("; "),
        o.w || "", o.s.join("; "), o.ad || o.ra || "", o.a || "", o.d === "Unknown" ? "" : o.d, o.st === "Unknown" ? "" : o.st,
        o.pp.map(function (x) { return x.n + (x.r ? " (" + x.r + ")" : ""); }).join("; "), o.ac || "", o.av || "",
        VERIFIED[o._id] ? "Yes" : "", o.u ? "Yes" : "", o.nt.join(". "), o.m || mapsSearch(o), o.sr.join(" ")]);
    });
    var text = "\ufeff" + rows.map(function (r) { return r.map(csvCell).join(","); }).join("\r\n") + "\r\n";
    var where = st.q ? "search " + st.q : st.district ? st.district + " " + st.state : st.state || "india";
    var name = "animal-ngos-" + slugify(where + (st.cat !== "all" ? " " + st.cat : "")) + ".csv";
    var url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    var a = el("a", { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    toast("Downloaded " + plural(list.length, "group") + " (" + name + ")");
  }

  // ---------------------------------------------------------- dashboard bits
  function card(cls, kids) { return el("section", { cls: "card " + (cls || "") }, kids); }
  function corner(label, fn) {
    var b = el("button", { cls: "round corner", type: "button", "aria-label": label, title: label }, [icon("i-arrow")]);
    return on(b, fn);
  }
  function rankRows(items, total, limit, onPick, moreLabel) {
    // items: [{name, n, go, zero}]
    var wrap = el("div", { cls: "rows" });
    var max = items.reduce(function (m, x) { return Math.max(m, x.n); }, 0) || 1;
    function rowFor(x, i) {
      var fill = el("div", { cls: "fill" });
      fill.style.width = (x.n ? Math.max(100 * x.n / max, 3) : 0) + "%";
      var b = el("button", { cls: "rank" + (x.n ? "" : " zero"), type: "button" }, [
        el("span", { cls: "r", text: (i < 9 ? "0" : "") + (i + 1) }),
        el("span", { cls: "nm", text: x.name, title: x.title || x.name }),
        el("div", { cls: "track" }, [fill]),
        el("span", { cls: "ct", text: fmt(x.n), title: plural(x.n, "group") }),
        el("span", { cls: "pc", text: pct(x.n, total) + "%" })
      ]);
      return on(b, x.go);
    }
    items.slice(0, limit).forEach(function (x, i) { wrap.appendChild(rowFor(x, i)); });
    var frag = el("div", null, [wrap]);
    if (items.length > limit) {
      var rest = items.length - limit;
      var t = el("button", { cls: "more-toggle", type: "button", "aria-expanded": "false" },
        [el("span", { cls: "plusdot" }, [plusIcon()]), el("span", { text: moreLabel ? moreLabel(rest) : rest + " more" })]);
      on(t, function () {
        if (onPick) { onPick(); return; }
        items.slice(limit).forEach(function (x, i) { wrap.appendChild(rowFor(x, i + limit)); });
        t.remove();
      });
      frag.appendChild(t);
    }
    return frag;
  }
  function plusIcon() {
    var s = sv("svg", { "class": "icon", viewBox: "0 0 24 24", "aria-hidden": "true" });
    s.appendChild(sv("path", { d: "M12 5v14M5 12h14" }));
    return s;
  }
  function typeBars(list) {
    var counts = { animal: 0, wildlife: 0, cattle: 0, none: 0 };
    list.forEach(function (o) { if (!o.c.length) counts.none++; o.c.forEach(function (c) { counts[c]++; }); });
    var keys = ["animal", "wildlife", "cattle"].concat(counts.none ? ["none"] : []);
    var max = Math.max.apply(null, keys.map(function (k) { return counts[k]; })) || 1;
    var bars = el("div", { cls: "bars" });
    keys.forEach(function (k) {
      var b = el("div", { cls: "bar" + (counts[k] === max ? " stripe" : "") });
      b.style.height = Math.max(100 * counts[k] / max, 10) + "%";
      b.appendChild(el("span", { cls: "barbadge", text: fmt(counts[k]) }));
      var col = el("button", { cls: "barcol", type: "button", "aria-pressed": String(st.cat === k),
        "aria-label": (TYPE_LABEL[k] || "Type not clear") + ", " + plural(counts[k], "group") },
        [b, el("small", { text: TYPE_LABEL[k] || "Not clear" })]);
      if (k === "none") col.disabled = true;
      else on(col, function () { setType(st.cat === k ? "all" : k); });
      bars.appendChild(col);
    });
    return card("", [el("div", { cls: "label", text: "By type" }), el("div", { cls: "number", text: fmt(list.length) }),
      el("div", { cls: "caption", text: "Tap a bar to filter" }), bars]);
  }
  function quality(list) {
    var named = list.filter(function (o) { return o.pp.length; }).length;
    function stat(label, n) {
      var f = el("div", { cls: "fill" }); f.style.width = pct(n, list.length) + "%";
      return el("div", { cls: "stat" }, [el("span", { text: label }), el("span", { cls: "muted", text: fmt(n) }),
        el("div", { cls: "track" }, [f])]);
    }
    return card("", [
      el("div", { cls: "label", text: "Who runs it known" }),
      el("div", { cls: "headline" }, [el("div", { cls: "number", text: fmt(named) }),
        el("div", null, [el("span", { cls: "badge", text: pct(named, list.length) + "%" }), el("small", { text: "of groups listed" })])]),
      el("div", { cls: "stats" }, [
        stat("Phone or email", list.filter(function (o) { return o.p.length || o.e.length; }).length),
        stat("AWBI recognised", list.filter(function (o) { return o.ac; }).length),
        stat("Website", list.filter(function (o) { return o.w; }).length)
      ])
    ]);
  }
  function stateItems(list, withZero) {
    var counts = countBy(list, function (o) { return o.st; });
    var names = Object.keys(GEO).concat(counts.Unknown ? ["Unknown"] : []);
    return names.filter(function (s) { return withZero || counts[s]; }).map(function (s) {
      return { name: sName(s), n: counts[s] || 0, go: function () { go({ state: s }); } };
    }).sort(function (a, b) { return b.n - a.n || a.name.localeCompare(b.name); });
  }
  function districtItems(list, state, withZero) {
    var counts = countBy(list, function (o) { return o.st + "|" + o.d; });
    var names = [];
    Object.keys(GEO).forEach(function (s) {
      if (state && s !== state) return;
      GEO[s].forEach(function (d) { names.push([s, d[0]]); });
    });
    Object.keys(counts).forEach(function (k) {
      var p = k.split("|");
      if (p[1] === "Unknown" && (!state || p[0] === state)) names.push(p);
    });
    return names.filter(function (x) { return withZero || counts[x[0] + "|" + x[1]]; }).map(function (x) {
      return { name: dName(x[1]), title: dName(x[1]) + ", " + sName(x[0]), n: counts[x[0] + "|" + x[1]] || 0,
        go: function () { go({ state: x[0], district: x[1] }); } };
    }).sort(function (a, b) { return b.n - a.n || a.name.localeCompare(b.name); });
  }

  // ------------------------------------------------------------------ views
  function setHeader(crumbs, title, sub) {
    var c = $("crumbs"); c.textContent = "";
    crumbs.forEach(function (x) {
      c.appendChild(on(el("button", { cls: "crumb", type: "button" }, [icon("i-back"), x[0]]), x[1]));
    });
    $("title").textContent = title;
    $("sub").textContent = sub;
    document.title = (title === SITE ? title : title + " | " + SITE) + SUFFIX;
  }
  function railOn() {
    var which = st.q ? "search" : st.v === "needs" ? "needs" : (st.v || st.state) ? "states" : "home";
    Array.prototype.forEach.call(scope().querySelectorAll("[data-go]"), function (b) {
      b.classList.toggle("on", b.getAttribute("data-go") === which);
    });
  }

  function render() {
    view.textContent = "";
    railOn();
    if ($("finderSlot")) showFinder();
    if (st.q) renderSearch();
    else if (st.v === "states") renderStates();
    else if (st.v === "needs" && FED) FED.needsView(view, { setHeader: setHeader, go: go });
    else if (st.state && st.district) renderDistrict();
    else if (st.state) renderState();
    else renderHome();
  }

  function renderHome() {
    var list = pool();
    var places = districtItems(list, null, false);
    var states = stateItems(list, false);
    setHeader([], "Animal NGOs of India", plural(list.length, "group") + " in " + plural(states.length, "state") +
      (META.date ? ". Updated " + META.date + "." : "."));
    if (!$("finderSlot")) showFinder();
    var map = card("mapcard", [
      el("div", { cls: "label", text: "Groups on the map" }),
      el("div", { cls: "number", text: fmt(list.length) }),
      el("div", { cls: "caption", text: "in " + plural(places.filter(function (p) { return p.name !== "District not known"; }).length, "district") }),
      corner("All states", function () { go({ v: "states" }); }),
      drawMap([6.2, 67.9, 37.3, 97.6], districtSpots(list).filter(function (s) { return s.n; }), null,
        { counts: countBy(list, function (o) { return o.st; }) }),
      el("div", { cls: "maptip", text: "Tap a state or a blue dot" })
    ]);
    var topStates = card("", [el("div", { cls: "label", text: "Top states" }), el("div", { cls: "number", text: fmt(states.length) }),
      el("div", { cls: "caption", text: "with groups listed" }), corner("All states", function () { go({ v: "states" }); }),
      rankRows(states, list.length, TOP, function () { go({ v: "states" }); }, function () { return "All states"; })]);
    var topPlaces = card("", [el("div", { cls: "label", text: "Top districts" }), el("div", { cls: "number", text: fmt(places.filter(function (p) { return p.name !== "District not known"; }).length) }),
      el("div", { cls: "caption", text: "with groups listed" }),
      rankRows(places, list.length, TOP, null, function (n) { return plural(n, "more district"); })]);
    view.appendChild(el("div", { cls: "dash" }, [map, typeBars(list), quality(list), el("div", { cls: "wide" }, [topStates, topPlaces])]));
  }

  function renderStates() {
    var list = pool(), items = stateItems(list, true);
    setHeader([["India", function () { go({}); }]], "All states",
      plural(items.filter(function (x) { return x.n; }).length, "state") + " and union territories with groups, of " + fmt(Object.keys(GEO).length));
    view.appendChild(card("", [el("div", { cls: "label", text: "States and union territories" }),
      rankRows(items, list.length, items.length)]));
  }

  function renderState() {
    var s = st.state, list = pool({ state: s });
    var all = (GEO[s] || []).length, items = districtItems(list, s, true);
    var withGroups = items.filter(function (x) { return x.n; });
    setHeader([["India", function () { go({}); }]], sName(s),
      plural(list.length, "group") + (all ? " in " + fmt(withGroups.filter(function (x) { return x.name !== "District not known"; }).length) + " of " + plural(all, "district") : "") + ".");
    if (!$("finderSlot")) showFinder();
    var spots = districtSpots(list, s);
    var bbox = bboxOf(spots);
    var kids = [];
    if (bbox) {
      kids.push(card("mapcard", [el("div", { cls: "label", text: "Districts with groups" }),
        el("div", { cls: "number", text: fmt(withGroups.length) }), el("div", { cls: "caption", text: "of " + fmt(all) }),
        drawMap(bbox, spots.filter(function (x) { return x.n; }), spots.filter(function (x) { return !x.n; }), { focus: s }),
        el("div", { cls: "maptip", text: "Blue: has groups. White: none listed yet." })]));
    }
    kids.push(card("", [el("div", { cls: "label", text: "Districts" }),
      rankRows(items, list.length, 6, null, function (n) { return plural(n, "more district"); })]));
    kids.push(quality(list));
    view.appendChild(el("div", { cls: "dash state" }, kids));
    st.shown = Math.min(st.shown, 12);
    results(list, "All groups in " + sName(s), true);
  }
  function bboxOf(spots) {
    if (!spots.length) return null;
    var b = [90, 180, -90, -180];
    spots.forEach(function (x) { b = [Math.min(b[0], x.lat), Math.min(b[1], x.lon), Math.max(b[2], x.lat), Math.max(b[3], x.lon)]; });
    var cy = (b[0] + b[2]) / 2, cx = (b[1] + b[3]) / 2;
    var h = Math.max(b[2] - b[0] + 1.6, 3), w = Math.max(b[3] - b[1] + 1.6, 3);
    return [cy - h / 2, cx - w / 2, cy + h / 2, cx + w / 2];
  }

  function renderDistrict() {
    var list = pool({ state: st.state, district: st.district });
    setHeader([["India", function () { go({}); }], [sName(st.state), function () { go({ state: st.state }); }]],
      dName(st.district), plural(list.length, "group") + " in " + dName(st.district) + ", " + sName(st.state) + ".");
    if (!$("finderSlot")) showFinder();
    results(list, null, false);
  }

  function renderSearch() {
    var r = search(st.q);
    var crumbs = [["India", function () { go({}); }]];
    setHeader(crumbs, "Results for " + st.q, r.list.length
      ? plural(r.list.length, "group") + " across India."
      : "No group matches every word.");
    var places = placeHits(r.terms);
    if (places.length) {
      var chips = el("div", { cls: "places" }, [el("span", { cls: "muted", text: "Places" })]);
      places.forEach(function (p) { chips.appendChild(on(el("button", { cls: "crumb", type: "button", text: p.label }), p.go)); });
      view.appendChild(chips);
    }
    // A likely typo with a clear fix: show the fixed search, and say so.
    var fixed = !r.list.length && r.suggest.filter(function (x) { return x.fix; })[0];
    if (fixed) {
      var asked = st.q;
      r = search(fixed.q);
      setHeader(crumbs, "Results for " + fixed.q, plural(r.list.length, "group") + " across India.");
      view.appendChild(el("p", { cls: "note" }, ["Nothing matches \"" + asked + "\", so this shows ",
        el("b", { text: fixed.q }), " instead."]));
    }
    if (!r.list.length) {
      var box = el("div", { cls: "empty card" }, [el("div", { text: "Nothing matches \"" + st.q + "\"." })]);
      if (r.suggest.length) {
        var fix = r.suggest.filter(function (x) { return x.fix; }), words = r.suggest.filter(function (x) { return !x.fix; });
        [[fix, "Did you mean"], [words, "Search one word"]].forEach(function (g) {
          if (!g[0].length) return;
          var row = el("div", { cls: "places" }, [el("span", { cls: "muted", text: g[1] })]);
          g[0].forEach(function (x) { row.appendChild(on(el("button", { cls: "crumb", type: "button", text: x.q }), function () { go({ q: x.q }); })); });
          box.appendChild(row);
        });
      } else box.appendChild(el("div", { cls: "muted", text: "Try fewer words, a town or district, or a short name like PFA." }));
      if (st.cat !== "all" || st.contact || st.people || st.awbi || st.verified || st.fedOnly) {
        box.appendChild(on(el("button", { cls: "pill", type: "button", text: "Clear filters" }), resetAll));
      }
      view.appendChild(box);
      return;
    }
    r.list.forEach(function (x) { x.o._hit = x.words; });
    results(r.list.map(function (x) { return x.o; }), null, true, null);
  }

  function contactRank(o) { return o.p.length ? 0 : o.e.length ? 1 : (o.w || o.s.length) ? 2 : 3; }
  function results(list, heading, showDistrict, extra) {
    if (!st.q) list = list.slice().sort(function (a, b) { return contactRank(a) - contactRank(b); });
    if (heading || extra) {
      view.appendChild(el("div", { cls: "resultbar" }, [
        el("div", null, [heading ? el("h2", { text: heading }) : null, heading ? el("div", { cls: "muted", text: plural(list.length, "group") }) : null]),
        extra
      ]));
    }
    if (!list.length) {
      var e = el("div", { cls: "empty card" }, [
        el("div", { text: st.q ? "Nothing matches \"" + st.q + "\"." : "No groups here with these filters." }),
        el("div", { cls: "muted", text: "Try a town name, a short name like PFA, fewer words, or a different type." })
      ]);
      e.appendChild(on(el("button", { cls: "pill", type: "button", text: "Clear search and filters" }), resetAll));
      view.appendChild(e);
      return;
    }
    var ul = el("ul", { cls: "list" });
    view.appendChild(ul);
    function page() {
      list.slice(ul.children.length, st.shown).forEach(function (o) { ul.appendChild(row(o, showDistrict)); });
    }
    page();
    if (list.length > st.shown) {
      var more = el("button", { cls: "pill showmore", type: "button" });
      var label = function () { more.textContent = "Show " + Math.min(PAGE, list.length - st.shown) + " more (" + fmt(list.length - st.shown) + " left)"; };
      label();
      on(more, function () {
        st.shown = Math.max(st.shown, ul.children.length) + PAGE; page();
        if (list.length > st.shown) label(); else more.remove();
      });
      view.appendChild(more);
    }
  }

  function resetAll() {
    st.cat = "all"; st.contact = st.people = st.awbi = st.verified = false;
    st.fedOnly = false;
    ["fContact", "fPeople", "fAwbi", "fVerified", "fFed"].forEach(function (id) { $(id).checked = false; });
    syncTypes(); syncFilterDot();
    go({ state: st.state, district: st.district });
  }

  var rowId = 0;
  function row(o, showDistrict) {
    var li = el("li", { cls: "item" });
    var id = "g" + (++rowId);
    var place = [o.a];
    if (showDistrict) place.push(dName(o.d));
    if (!st.state) place.push(sName(o.st));
    place = place.filter(function (v, i, a) { return v && a.indexOf(v) === i && v !== "District not known"; }).join(", ");
    var meta = el("div", { cls: "meta" }, [
      el("span", { cls: "chip", text: o.c.map(function (c) { return TYPE_LABEL[c]; }).join(", ") || "Type not clear" }),
      o.ac ? el("span", { cls: "chip awbi", title: "Recognised by the Animal Welfare Board of India", text: "AWBI" }) : null,
      VERIFIED[o._id] ? el("span", { cls: "chip fed", title: "Documents checked, vouched for by the federation", text: "Verified" }) : null,
      o.u ? el("span", { cls: "chip flag", text: "Not verified" }) : null,
      place ? el("span", { text: place }) : null
    ]);
    var bare = function (x) { return x.toLowerCase().replace(/[^a-z0-9]/g, ""); };
    var alt = o.k.filter(function (k) { return bare(o.n).indexOf(bare(k)) < 0 && bare(k).indexOf(bare(o.n)) < 0; })[0];
    var runby = null;
    if (o.pp.length) {
      var lead = o.pp[0];
      runby = el("div", { cls: "runby" }, ["Run by ", el("b", { text: lead.n }),
        lead.r ? ", " + lead.r.charAt(0).toLowerCase() + lead.r.slice(1) : "",
        o.pp.length > 1 ? " +" + (o.pp.length - 1) + " more" : ""]);
    }
    var words = st.q && o._hit ? o._hit : null;
    var nameEl = el("div", { cls: "nm" }, [words ? marked(o.n, words) : o.n]);
    var hitEl = null;
    if (words && !wordsOf(o.n).some(function (w) { return words.indexOf(w) >= 0; })) {
      var where = whereMatched(o, words);
      if (where) hitEl = el("div", { cls: "hit" }, [el("span", { cls: "muted", text: "Matched in " + where.label.toLowerCase() + ": " }), marked(where.text, words)]);
    }
    var head = el("button", { cls: "head", type: "button", "aria-expanded": "false", "aria-controls": id }, [
      el("div", { cls: "body" }, [nameEl, alt ? el("div", { cls: "aka", text: "Also known as " + alt }) : null, meta, runby, hitEl]),
      el("span", { cls: "plus", "aria-hidden": "true" }, [plusIcon()])
    ]);
    var detail = el("div", { cls: "detail", id: id });
    var built = false;
    on(head, function () {
      var open = !li.classList.contains("open");
      if (open && !built) { fillDetail(detail, o); built = true; }
      li.classList.toggle("open", open);
      head.setAttribute("aria-expanded", String(open));
    });
    li.appendChild(head);
    var quick = quickContacts(o);
    if (quick) li.appendChild(quick);
    li.appendChild(detail);
    return li;
  }

  function telOf(p) { return "tel:" + p.replace(/[^\d+]/g, ""); }
  function socialName(u) { return /instagram/i.test(u) ? "Instagram" : /facebook/i.test(u) ? "Facebook" : /youtube/i.test(u) ? "YouTube" : /twitter|x\.com/i.test(u) ? "X" : "Social page"; }
  function mapsSearch(o) {
    return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent([o.n, o.ad || o.a, o.d !== "Unknown" ? o.d : "", o.st].filter(Boolean).join(", "));
  }
  function findNumber(o) {
    return "https://www.google.com/search?q=" + encodeURIComponent("\"" + o.n + "\" " + (o.d !== "Unknown" ? o.d : o.st) + " contact number");
  }
  // Reach them without opening the group: first number, email, website.
  function quickContacts(o) {
    var kids = [];
    if (o.p[0]) kids.push(el("a", { cls: "qc call", href: telOf(o.p[0]), "aria-label": "Call " + o.n + " on " + o.p[0] }, [icon("i-phone"), o.p[0]]));
    if (o.e[0]) kids.push(el("a", { cls: "qc", href: "mailto:" + o.e[0], text: "Email" }));
    var w = safe(o.w) || safe(o.s[0]);
    if (w) kids.push(el("a", { cls: "qc", href: w, target: "_blank", rel: "noopener", text: o.w ? "Website" : socialName(o.s[0]) }));
    return kids.length ? el("div", { cls: "quick" }, kids) : null;
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
    d.appendChild(el("div", { cls: "sec", text: "Contact" }));
    var acts = el("div", { cls: "actions" });
    if (o.p.length || o.e.length) {
      o.p.slice(0, 2).forEach(function (x, i) { add(acts, [act("Call " + x, telOf(x), i === 0)]); });
      if (o.e[0]) add(acts, [act("Email " + o.e[0], "mailto:" + o.e[0], !o.p.length)]);
      add(acts, [act("Website", o.w), o.s[0] ? act(socialName(o.s[0]), o.s[0]) : null, act("Directions", o.m || mapsSearch(o))]);
    } else {
      d.appendChild(el("p", { cls: "none", text: "No phone or email listed yet. One tap usually finds it:" }));
      add(acts, [act("Find their number", findNumber(o), true), act("Find on Google Maps", mapsSearch(o)),
        act("Website", o.w), o.s[0] ? act(socialName(o.s[0]), o.s[0]) : null]);
    }
    d.appendChild(acts);
    if (o.ad || o.ra) d.appendChild(el("p", { cls: "addr", text: o.ad || o.ra }));
    var said = el("div", { cls: "said" });
    d.appendChild(said);
    if (FED && FED.feedback) FED.feedback(said, o);
    else said.appendChild(el("p", { cls: "fbq" }, ["Number not working, or the group has closed? ",
      el("a", { href: "mailto:ask@rapid-response.in?subject=" + encodeURIComponent("NGO directory: " + o.n) +
        "&body=" + encodeURIComponent("Group: " + o.n + "\nPlace: " + [o.d, o.st].join(", ") + "\nId: " + o._id + "\n\nWhat did not work, or what should change:\n"),
        text: "Tell us" })]));

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
      [el("span", { cls: "plusdot" }, [plusIcon()]), el("span", { text: "More details" })]);
    var more = el("div", { cls: "more" });
    var dl = el("dl");
    function line(k, v) { if (v) { dl.appendChild(el("dt", { text: k })); dl.appendChild(typeof v === "string" ? el("dd", { text: v }) : el("dd", null, [v])); } }
    if (o.k.length) line("Also known as", o.k.join(", "));
    if (o.ad && o.ra && o.ad !== o.ra) line("Other address", o.ra);
    line("Area", [o.a, o.d !== "Unknown" ? o.d : "", o.st !== "Unknown" ? o.st : ""].filter(Boolean).join(", "));
    line("Phones", linkList(o.p, telOf));
    line("Emails", linkList(o.e, function (x) { return "mailto:" + x; }));
    line("Website", linkList(o.w ? [o.w] : [], function (x) { return x; }));
    line("Social", linkList(o.s, function (x) { return x; }));
    if (o.ac) line("AWBI", "Recognised, code " + o.ac + (o.av ? ", valid till " + o.av : ""));
    if (o.u) line("Check", "Found only by web search. Confirm it is an active NGO before relying on it.");
    if (o.nt.length) line("Notes", o.nt.join(". "));
    line("Sources", linkList(o.sr, function (x) { return x; }, host));
    if (o.src.indexOf("Ola Maps") >= 0) line("Listing", "Ola Maps (Open Database License)");
    more.appendChild(dl);
    on(tog, function () {
      var open = !more.classList.contains("open");
      more.classList.toggle("open", open); tog.setAttribute("aria-expanded", String(open));
      tog.lastChild.textContent = open ? "Fewer details" : "More details";
    });
    d.appendChild(tog); d.appendChild(more);
    if (FED) FED.detail(d, o);
  }

  // ---------------------------------------------------------------- wiring
  var types, q, box;
  function syncTypes() {
    Array.prototype.forEach.call(types.children, function (x) { x.setAttribute("aria-pressed", String(x.getAttribute("data-t") === st.cat)); });
  }
  function setType(t) { st.cat = t; st.shown = PAGE; syncTypes(); sync(false); render(); }
  function syncFilterDot() { $("filterDot").classList.toggle("on", st.contact || st.people || st.awbi || st.verified || st.fedOnly); }
  function toggleFilters(force) {
    var f = $("filters"), open = force != null ? force : f.hidden;
    f.hidden = !open; $("filterBtn").setAttribute("aria-expanded", String(open));
    if (open) { toTop(); $("fContact").focus(); }
  }

  // Same id as fed/common.js gidOf: claims, profiles and needs attach to it.
  function slugify(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  }
  function gidOf(o) { return o.ac ? "awbi-" + slugify(o.ac) : slugify(o.n) + "--" + slugify(o.d) + "--" + slugify(o.st); }

  // Verified badges, needs and claim links come from the federation backend, if it is set up.
  function loadFederation() {
    if (!/^https?:$/.test(location.protocol)) return;
    import(BASE + "fed/public.js")
      .then(function (m) { return m.attach(); })
      .then(function (fed) {
        if (!fed) return;
        FED = fed; VERIFIED = fed.verified || {};
        var b = $("needsBtn"); if (b) b.hidden = false;
        var f = $("fFed"); if (f) { f.parentNode.hidden = false; f.checked = !!st.fedOnly; }
        render();
      })
      .catch(function () { /* directory works without it */ });
  }

  function uniqPhones(list) {
    var seen = {};
    return list.filter(function (p) {
      var k = p.replace(/\D/g, "").slice(-10);
      if (!k || seen[k]) return false;
      seen[k] = 1; return true;
    });
  }
  function boot(DB) {
    META = DB.meta || {};
    GEO = META.states || {};
    SHAPES = META.shapes || {};
    ORGS = DB.orgs || [];
    ORGS.forEach(function (o) {
      o.k = o.k || []; o.sr = o.sr || []; o.st = o.st || "Unknown";
      o.pp.sort(function (a, b) { return roleRank(a.r) - roleRank(b.r); });
      o.p = uniqPhones(o.p || []); o.e = o.e || []; o.s = o.s || []; o.nt = o.nt || []; o.src = o.src || [];
      o._id = gidOf(o);
    });


    types = $("types");
    TYPES.forEach(function (t) {
      var b = el("button", { cls: "pill", type: "button", "data-t": t[0], "aria-pressed": "false" }, [icon(t[2]), t[1]]);
      types.appendChild(on(b, function () { setType(t[0]); }));
    });

    on($("filterBtn"), function () { toggleFilters(); });
    [["fContact", "contact"], ["fPeople", "people"], ["fAwbi", "awbi"], ["fVerified", "verified"], ["fFed", "fedOnly"]].forEach(function (p) {
      $(p[0]).addEventListener("change", function (e) { st[p[1]] = e.target.checked; st.shown = PAGE; syncFilterDot(); render(); });
    });
    on($("share"), copyLink);
    if ($("csv")) on($("csv"), downloadCsv);

    Array.prototype.forEach.call(scope().querySelectorAll("[data-go]"), function (b) {
      on(b, function () {
        var g = b.getAttribute("data-go");
        if (g === "home") go({});
        else if (g === "states") go({ v: "states" });
        else if (g === "needs") go({ v: "needs" });
        else if (g === "search") { toTop(); q.focus(); }
        else if (g === "filters") toggleFilters();
        else if (g === "share") copyLink();
        else if (g === "csv") downloadCsv();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll(".shell .logo, .shell .brand"), function (logo) {
      on(logo, function (e) { e.preventDefault(); go({}); });
    });

    q = $("q"); box = $("searchbox");
    var timer, typing = false;
    q.addEventListener("input", function () {
      clearTimeout(timer);
      box.classList.toggle("has", !!q.value);
      timer = setTimeout(function () {
        var was = !!st.q;
        st.q = q.value.trim(); st.v = ""; st.shown = PAGE;
        sync(!was && !!st.q && !typing); typing = !!st.q;
        render();
      }, 140);
    });
    on($("clear"), function () { q.value = ""; st.q = ""; typing = false; box.classList.remove("has"); sync(false); render(); q.focus(); });

    view = $("view");
    function fromHash() {
      readHash();
      q.value = st.q; box.classList.toggle("has", !!st.q);
      syncTypes();
      render();
    }
    window.addEventListener("hashchange", fromHash);
    window.addEventListener("popstate", fromHash);
    fromHash();
    loadFederation();
  }

  function fail(msg) {
    var v = $("view"); v.textContent = "";
    v.appendChild(el("div", { cls: "err", text: msg }));
    $("sub").textContent = "";
  }

  function start() {
    mount();
    var inline = document.getElementById("data");
    if (inline && /^\s*\{/.test(inline.textContent)) {
      try { boot(JSON.parse(inline.textContent)); } catch (e) { fail("The directory data could not be read."); }
      return;
    }
    // The map outlines are a separate file; the directory still works without them.
    var shapes = fetch(BASE + "data/india-map.json").then(function (r) { return r.ok ? r.json() : {}; }, function () { return {}; });
    fetch(BASE + "data/ngos.json", { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (db) {
        return shapes.then(function (m) {
          db.meta = db.meta || {};
          if (m && m.shapes) { db.meta.shapes = m.shapes; db.meta.map_credit = m.credit || m.map_credit; }
          return db;
        });
      })
      .then(boot)
      .catch(function () { fail("The directory could not be loaded. Check your connection and refresh the page."); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
