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
  var view;

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
    st.v = h.get("v") === "states" && !st.state && !st.q ? "states" : "";
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
    sync(true); render(); window.scrollTo(0, 0);
  }

  function passes(o) {
    if (st.cat !== "all" && o.c.indexOf(st.cat) < 0) return false;
    if (st.contact && !o.p.length && !o.e.length) return false;
    if (st.people && !o.pp.length) return false;
    if (st.awbi && !o.ac) return false;
    if (st.verified && o.u) return false;
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
    var out = {}, tk = pk(t), digits = /^[0-9]+$/.test(t);
    var maxd = t.length >= 8 ? 2 : t.length >= 4 ? 1 : 0;
    IDX.words.forEach(function (w) {
      var lvl = 0, wk = IDX.keys[w];
      if (w === t) lvl = 4;
      else if (w.indexOf(t) === 0) lvl = 3.5;
      else if (wk === tk) lvl = 3;
      else if (tk.length >= 3 && wk.indexOf(tk) === 0) lvl = 2.5;
      else if (t.length >= 4 && w.indexOf(t) > 0) lvl = digits ? 3 : 2;
      else if (maxd && !digits && tk.length >= 4 && wk.length >= 4 && lev(wk, tk, maxd) <= maxd) lvl = 1.5;
      else if (t.length >= 5 && !digits && tk.length >= 4 && wk.length > tk.length && lev(wk.slice(0, tk.length), tk, 1) <= 1) lvl = 1;
      if (lvl) out[w] = lvl;
    });
    return out;
  }
  // [{o, score, words}] for the current query, best first.
  function search(query) {
    if (!IDX) buildIndex();
    var terms = wordsOf(query).filter(function (t, i, a) { return a.indexOf(t) === i; });
    if (!terms.length) return { list: [], terms: [], close: false };
    var per = terms.map(function (t) {
      var scores = {}, words = matchWord(t);
      Object.keys(words).forEach(function (w) {
        var hits = IDX.vocab[w];
        for (var i in hits) {
          var s = words[w] * hits[i];
          if (!scores[i] || scores[i].s < s) scores[i] = { s: s, w: w, lvl: Math.max(words[w], scores[i] ? scores[i].lvl : 0) };
          else if (words[w] > scores[i].lvl) scores[i].lvl = words[w];
        }
      });
      return scores;
    });
    var all = {}, phrase = fold(query).trim();
    per.forEach(function (scores, ti) {
      for (var i in scores) {
        var a = all[i] || (all[i] = { n: 0, s: 0, words: [], weak: 0 });
        a.n++; a.s += scores[i].s; a.words.push(scores[i].w);
        if (scores[i].lvl < 2) a.weak++;
      }
    });
    // Best: every word matched exactly, by its start, by sound or inside a word.
    // Then: every word matched, some only with a typo. Last: some words matched.
    var ids = Object.keys(all);
    var full = ids.filter(function (i) { return all[i].n === terms.length; });
    var strong = full.filter(function (i) { return !all[i].weak; });
    var pick = strong.length ? strong : full.length ? full : ids;
    var close = !strong.length;
    var list = pick.map(function (i) {
      var o = ORGS[i], a = all[i], s = a.s + a.n * 100;
      if (fold(o.n).indexOf(phrase) >= 0) s += 60;
      if (fold(o.n).indexOf(phrase) === 0) s += 30;
      return { o: o, score: s, words: a.words };
    }).filter(function (r) { return passes(r.o); });
    list.sort(function (x, y) { return y.score - x.score || x.o.n.localeCompare(y.o.n); });
    return { list: list, terms: terms, close: close };
  }
  // Where a record matched, for the "Matched in" line.
  function whereMatched(o, words) {
    var set = {};
    words.forEach(function (w) { set[w] = 1; });
    for (var f = 0; f < FIELDS.length; f++) {
      var key = FIELDS[f][0];
      if (key === "n") continue;
      var texts = fieldText(o, key);
      for (var t = 0; t < texts.length; t++) {
        if (wordsOf(texts[t]).some(function (w) { return set[w]; })) {
          return { label: FIELDS[f][1], text: key === "p" ? o.p[t] : texts[t] };
        }
      }
    }
    return null;
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
        return ws.some(function (w) { return w.indexOf(t) === 0 || pk(w) === pk(t) || (t.length >= 5 && lev(pk(w), pk(t), 1) <= 1); });
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
    document.title = title === "Animal NGOs of India" ? title : title + " | Animal NGOs of India";
  }
  function railOn() {
    var which = st.q ? "search" : (st.v || st.state) ? "states" : "home";
    Array.prototype.forEach.call(document.querySelectorAll("[data-go]"), function (b) {
      b.classList.toggle("on", b.getAttribute("data-go") === which);
    });
  }

  function render() {
    view.textContent = "";
    railOn();
    if (st.q) renderSearch();
    else if (st.v === "states") renderStates();
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
    results(list, null, false);
  }

  function renderSearch() {
    var r = search(st.q);
    var crumbs = [["India", function () { go({}); }]];
    setHeader(crumbs, "Results for " + st.q, r.list.length
      ? plural(r.list.length, "group") + (r.close ? " close to your search" : "") + " across India."
      : "Nothing found yet.");
    var places = placeHits(r.terms);
    if (places.length) {
      var chips = el("div", { cls: "places" }, [el("span", { cls: "muted", text: "Places" })]);
      places.forEach(function (p) { chips.appendChild(on(el("button", { cls: "crumb", type: "button", text: p.label }), p.go)); });
      view.appendChild(chips);
    }
    if (r.close && r.list.length) view.appendChild(el("p", { cls: "note", text: "No exact match, so these are the closest spellings." }));
    r.list.forEach(function (x) { x.o._hit = x.words; });
    results(r.list.map(function (x) { return x.o; }), null, true, null);
  }

  function results(list, heading, showDistrict, extra) {
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
    ["fContact", "fPeople", "fAwbi", "fVerified"].forEach(function (id) { $(id).checked = false; });
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
      [el("span", { cls: "plusdot" }, [plusIcon()]), el("span", { text: "More details" })]);
    var more = el("div", { cls: "more" });
    var dl = el("dl");
    function line(k, v) { if (v) { dl.appendChild(el("dt", { text: k })); dl.appendChild(typeof v === "string" ? el("dd", { text: v }) : el("dd", null, [v])); } }
    if (o.k.length) line("Also known as", o.k.join(", "));
    if (o.ad && o.ad !== o.a) line("Address", o.ad);
    if (o.ra && o.ra !== o.ad) line(o.ad ? "Registered address" : "Address", o.ra);
    line("Area", [o.a, o.d !== "Unknown" ? o.d : "", o.st !== "Unknown" ? o.st : ""].filter(Boolean).join(", "));
    line("Phones", linkList(o.p, function (x) { return "tel:" + x.replace(/[^\d+]/g, ""); }));
    line("Emails", linkList(o.e, function (x) { return "mailto:" + x; }));
    line("Website", linkList(o.w ? [o.w] : [], function (x) { return x; }));
    line("Social", linkList(o.s, function (x) { return x; }));
    if (o.ac) line("AWBI", "Recognised, code " + o.ac + (o.av ? ", valid till " + o.av : ""));
    if (o.u) line("Check", "Found only by web search. Confirm it is an active NGO before relying on it.");
    if (o.nt.length) line("Notes", o.nt.join(". "));
    line("Sources", linkList(o.sr, function (x) { return x; }, host));
    more.appendChild(dl);
    on(tog, function () {
      var open = !more.classList.contains("open");
      more.classList.toggle("open", open); tog.setAttribute("aria-expanded", String(open));
      tog.lastChild.textContent = open ? "Fewer details" : "More details";
    });
    d.appendChild(tog); d.appendChild(more);
  }

  // ---------------------------------------------------------------- wiring
  var types, q, box;
  function syncTypes() {
    Array.prototype.forEach.call(types.children, function (x) { x.setAttribute("aria-pressed", String(x.getAttribute("data-t") === st.cat)); });
  }
  function setType(t) { st.cat = t; st.shown = PAGE; syncTypes(); sync(false); render(); }
  function syncFilterDot() { $("filterDot").classList.toggle("on", st.contact || st.people || st.awbi || st.verified); }
  function toggleFilters(force) {
    var f = $("filters"), open = force != null ? force : f.hidden;
    f.hidden = !open; $("filterBtn").setAttribute("aria-expanded", String(open));
    if (open) { window.scrollTo(0, 0); $("fContact").focus(); }
  }

  function boot(DB) {
    META = DB.meta || {};
    GEO = META.states || {};
    SHAPES = META.shapes || {};
    ORGS = DB.orgs || [];
    ORGS.forEach(function (o) {
      o.k = o.k || []; o.sr = o.sr || []; o.st = o.st || "Unknown";
      o.pp.sort(function (a, b) { return roleRank(a.r) - roleRank(b.r); });
      o.p = o.p || []; o.e = o.e || []; o.s = o.s || []; o.nt = o.nt || []; o.src = o.src || [];
    });

    var foot = $("foot");
    foot.hidden = false;
    add(foot, [
      el("p", { text: "Sources: the Animal Welfare Board of India list of recognised organisations" +
        (META.awbi_date ? " (as on " + META.awbi_date + ")" : "") +
        ", the groups' own websites and pages, news reports and NGO directories. Every entry links to where its details come from." }),
      el("p", { text: "Names under \"Who runs it\" are as published by each source; confirm when you get in touch. District locations on the map are approximate." }),
      META.ola ? el("p", { text: "Map listings from Ola Maps. That data is available under the Open Database License." }) : null,
      META.map_credit ? el("p", { text: META.map_credit + ". District locations from India Post PIN codes." }) : null
    ]);

    types = $("types");
    TYPES.forEach(function (t) {
      var b = el("button", { cls: "pill", type: "button", "data-t": t[0], "aria-pressed": "false" }, [icon(t[2]), t[1]]);
      types.appendChild(on(b, function () { setType(t[0]); }));
    });

    on($("filterBtn"), function () { toggleFilters(); });
    [["fContact", "contact"], ["fPeople", "people"], ["fAwbi", "awbi"], ["fVerified", "verified"]].forEach(function (p) {
      $(p[0]).addEventListener("change", function (e) { st[p[1]] = e.target.checked; st.shown = PAGE; syncFilterDot(); render(); });
    });
    on($("share"), copyLink);

    Array.prototype.forEach.call(document.querySelectorAll("[data-go]"), function (b) {
      on(b, function () {
        var g = b.getAttribute("data-go");
        if (g === "home") go({});
        else if (g === "states") go({ v: "states" });
        else if (g === "search") { window.scrollTo(0, 0); q.focus(); }
        else if (g === "filters") toggleFilters();
        else if (g === "share") copyLink();
        else if (g === "about") foot.scrollIntoView({ behavior: "smooth" });
      });
    });
    on(document.querySelector(".logo"), function (e) { e.preventDefault(); go({}); });

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
    // The map outlines are a separate file; the directory still works without them.
    var shapes = fetch("data/india-map.json").then(function (r) { return r.ok ? r.json() : {}; }, function () { return {}; });
    fetch("data/ngos.json", { cache: "no-cache" })
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
