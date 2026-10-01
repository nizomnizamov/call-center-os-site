/* Call Center OS — Supabase ulagichi (sayt versiyasi).

   Panel claude.ai artefaktida ishlaganda window.claude.use("db" | "downloads" | "assets")
   ni platforma beradi. Saytda xuddi shu interfeysni shu fayl Supabase ustida beradi —
   panel.html ikkala joyda bir xil ishlaydi.

   Panel foydalanadigan qism (boshqa metod qo'shsangiz — shu yerga ham yozing):
     db.collection(k).orderBy(f, dir).limit(n).onSnapshot(fn, err) → unsubscribe
     db.collection(k).get() | .add(obj) → {id}
     db.doc("k/id").get() | .set(obj) | .delete()
     downloads.save({filename, data})
     assets.upload(blob) → {id, url, sizeBytes, contentType} | assets.delete(id)

   Ma'lumot: public.docs (coll, id, data jsonb). Real vaqt: Supabase Realtime
   postgres_changes — o'zgarish kelganda shu kolleksiyaga obunalar qayta so'raladi. */
(function () {
  "use strict";

  // Paneldagi ☀/☾ tanlovi (localStorage "ccos-tema") kirish, sozlamalar va HR sahifalarida ham amal qiladi.
  try {
    var tema = localStorage.getItem("ccos-tema");
    if (tema === "light" || tema === "dark") document.documentElement.setAttribute("data-theme", tema);
  } catch (e) {}

  var cfg = window.CCOS_CONFIG || {};
  var me0 = document.currentScript && document.currentScript.src || "";
  var BASE = me0 ? me0.replace(/sb\.js(\?.*)?$/, "") : "/";

  var sb = window.supabase.createClient(cfg.url, cfg.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "ccos-auth" }
  });

  var CCOS = window.CCOS = { sb: sb, base: BASE, cfg: cfg };

  /* ---------- xatolar ---------- */

  function err(code, message) { var e = new Error(message || code); e.code = code; return e; }

  // PostgREST / Storage xatosini panel tushunadigan kodga o'giradi.
  function mapErr(e) {
    if (!e) return err("error", "Xato");
    var m = String(e.message || e.error || e);
    var c = String(e.code || e.statusCode || "");
    if (c === "42501" || /row-level security|permission denied|not authorized|Unauthorized/i.test(m)) return err("forbidden", m);
    if (c === "413" || /too large|exceeded the maximum/i.test(m)) return err("too_large", m);
    if (/Failed to fetch|NetworkError|network/i.test(m)) return err("network", m);
    if (/JWT|refresh token|session/i.test(m)) { toLogin(); return err("unauthenticated", m); }
    return err(c || "error", m);
  }
  CCOS.errText = function (e) { return (e && (e.message || e.error_description)) || "Xato yuz berdi."; };

  /* ---------- kirish ---------- */

  function toLogin() {
    var next = location.pathname.replace(new URL(BASE).pathname, "") + location.search;
    location.replace(BASE + "login/?next=" + encodeURIComponent(next));
  }
  CCOS.toLogin = toLogin;

  var meP = null;
  CCOS.me = function (fresh) {
    if (!meP || fresh) {
      meP = sb.auth.getSession().then(function (r) {
        if (!r.data.session) return null;
        return sb.rpc("me").then(function (x) { return x.error ? null : x.data; });
      });
    }
    return meP;
  };

  // Sahifa a'zo bo'lmaganlarga ko'rinmaydi: sessiya yo'q → login, tasdiqlanmagan → xabar.
  CCOS.requireMember = function () {
    return CCOS.me().then(function (m) {
      if (!m) { toLogin(); return new Promise(function () {}); }
      if (!m.isMember) {
        document.body.innerHTML = "";
        var box = document.createElement("div");
        box.style.cssText = "max-width:420px;margin:15vh auto;padding:24px;font:15px/1.5 system-ui,sans-serif";
        box.innerHTML = "<h2 style='margin:0 0 8px'>Hisobingiz hali tasdiqlanmagan</h2>" +
          "<p>Administrator sizga rol bergandan keyin panel ochiladi.</p>";
        var out = document.createElement("button");
        out.textContent = "Chiqish";
        out.onclick = function () { sb.auth.signOut().then(toLogin); };
        box.appendChild(out);
        document.body.appendChild(box);
        return new Promise(function () {});
      }
      return m;
    });
  };

  CCOS.signOut = function () {
    return sb.auth.signOut().catch(function () {}).then(function () { location.replace(BASE + "login/"); });
  };

  // Sessiya boshqa oynada tugasa yoki chiqilsa — shu oyna ham login sahifasiga.
  sb.auth.onAuthStateChange(function (ev) {
    if (ev === "SIGNED_OUT" && !/\/login\/?$/.test(location.pathname)) toLogin();
  });

  /* ---------- edge funksiyalar ---------- */

  function token() {
    return sb.auth.getSession().then(function (r) {
      if (!r.data.session) { toLogin(); throw err("unauthenticated", "Sessiya tugagan"); }
      return r.data.session.access_token;
    });
  }

  CCOS.fn = function (name, body) {
    return token().then(function (t) {
      return fetch(cfg.url + "/functions/v1/" + name, {
        method: "POST",
        headers: { Authorization: "Bearer " + t, apikey: cfg.key, "Content-Type": "application/json" },
        body: JSON.stringify(body || {})
      });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401) { toLogin(); throw err("unauthenticated", j.message); }
        if (!r.ok) throw err(j.code || "http_" + r.status, j.message || "Xato: " + r.status);
        return j;
      });
    });
  };

  // Himoyalangan ilova fayli (panel) — faqat a'zolarga.
  CCOS.loadPrivate = function (name) {
    return token().then(function (t) {
      return fetch(cfg.url + "/functions/v1/app?f=" + encodeURIComponent(name), {
        headers: { Authorization: "Bearer " + t, apikey: cfg.key }, cache: "no-cache"
      });
    }).then(function (r) {
      if (r.status === 401) { toLogin(); throw err("unauthenticated"); }
      if (!r.ok) throw err("http_" + r.status, "Ilova yuklanmadi (" + r.status + ").");
      return r.text();
    });
  };

  // Olingan HTML ni joriy hujjatga o'rnatadi: head elementlari → head, qolgani → body,
  // skriptlar oxirida tartib bilan ishga tushadi (panel skripti DOM tayyorligini kutadi).
  CCOS.mount = function (html) {
    var doc = new DOMParser().parseFromString(html, "text/html");
    var scripts = [];
    Array.prototype.forEach.call(doc.head.childNodes, function (n) {
      if (n.nodeName === "SCRIPT") { scripts.push(n); return; }
      if (n.nodeName === "TITLE") { document.title = n.textContent; return; }
      document.head.appendChild(document.importNode(n, true));
    });
    document.body.textContent = "";
    Array.prototype.forEach.call(doc.body.childNodes, function (n) {
      if (n.nodeName === "SCRIPT") { scripts.push(n); return; }
      document.body.appendChild(document.importNode(n, true));
    });
    scripts.forEach(function (s) {
      var x = document.createElement("script");
      if (s.src) x.src = s.src; else x.textContent = s.textContent;
      document.body.appendChild(x);
    });
  };

  /* ---------- db ---------- */

  var subs = [];
  var pending = {};
  var channel = null;

  function rid() {
    var a = new Uint8Array(9);
    crypto.getRandomValues(a);
    return btoa(String.fromCharCode.apply(null, a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function snapOf(rows) {
    return {
      size: rows.length, empty: !rows.length,
      docs: rows.map(function (r) {
        var raw = JSON.stringify(r.data);
        return { id: r.id, data: function () { return JSON.parse(raw); } };
      })
    };
  }

  // Limit berilmasa — hammasi, 1000 talik sahifalar bilan (Supabase bitta so'rovga 1000 qator beradi).
  function fetchAll(coll, q) {
    var PAGE = 1000, out = [];
    function page(from) {
      var r = sb.from("docs").select("id,data").eq("coll", coll);
      r = q.order ? r.order("data->>" + q.order, { ascending: q.dir !== "desc" }).order("id")
                  : r.order("created_at").order("id");
      var to = q.limit ? Math.min(from + PAGE, q.limit) - 1 : from + PAGE - 1;
      return r.range(from, to).then(function (x) {
        if (x.error) throw mapErr(x.error);
        out = out.concat(x.data || []);
        var want = q.limit ? q.limit : Infinity;
        if ((x.data || []).length === to - from + 1 && out.length < want) return page(to + 1);
        return out;
      });
    }
    return page(0);
  }

  function refresh(s) {
    var n = ++s.seq;
    fetchAll(s.coll, s.q).then(function (rows) {
      if (s.on && n === s.seq) s.fn(snapOf(rows));
    }).catch(function (e) {
      if (s.on && n === s.seq && s.err) s.err(mapErr(e));
    });
  }

  function changed(coll) {
    if (!coll || pending[coll]) return;
    pending[coll] = setTimeout(function () {
      delete pending[coll];
      subs.forEach(function (s) { if (s.coll === coll) refresh(s); });
    }, 150);
  }

  function ensureRealtime() {
    if (channel) return;
    var wasDown = false;
    channel = sb.channel("ccos-docs")
      .on("postgres_changes", { event: "*", schema: "public", table: "docs" }, function (p) {
        changed((p.new && p.new.coll) || (p.old && p.old.coll));
      })
      .subscribe(function (status) {
        if (status === "SUBSCRIBED") {
          // Uzilishdan keyin — o'tkazib yuborilgan o'zgarishlar uchun hammasini yangilash.
          if (wasDown) { wasDown = false; subs.forEach(refresh); }
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          wasDown = true;
        }
      });
  }

  function canWrite() {
    return CCOS.me().then(function (m) {
      if (!m || !m.canWrite) throw err("forbidden", "Sizda o'zgartirish huquqi yo'q.");
    });
  }

  function query(coll, q) {
    return {
      orderBy: function (f, dir) { return query(coll, Object.assign({}, q, { order: f, dir: dir || "asc" })); },
      limit: function (n) { return query(coll, Object.assign({}, q, { limit: n })); },
      onSnapshot: function (fn, errFn) {
        var s = { coll: coll, q: q, fn: fn, err: errFn, on: true, seq: 0 };
        subs.push(s);
        ensureRealtime();
        refresh(s);
        return function () {
          s.on = false;
          var i = subs.indexOf(s);
          if (i !== -1) subs.splice(i, 1);
        };
      },
      get: function () { return fetchAll(coll, q).then(snapOf); },
      add: function (data) {
        var id = rid();
        return canWrite().then(function () {
          return sb.from("docs").insert({ coll: coll, id: id, data: data });
        }).then(function (x) {
          if (x.error) throw mapErr(x.error);
          changed(coll);
          return { id: id };
        });
      }
    };
  }

  function docRef(path) {
    var parts = String(path).split("/");
    var coll = parts[0], id = parts[1] || "";
    return {
      id: id,
      get: function () {
        return sb.from("docs").select("data").eq("coll", coll).eq("id", id).maybeSingle().then(function (x) {
          if (x.error) throw mapErr(x.error);
          return { id: id, exists: !!x.data, data: function () { return x.data ? x.data.data : undefined; } };
        });
      },
      set: function (data) {
        return canWrite().then(function () {
          return sb.from("docs").upsert({ coll: coll, id: id, data: data }, { onConflict: "coll,id" });
        }).then(function (x) {
          if (x.error) throw mapErr(x.error);
          changed(coll);
        });
      },
      delete: function () {
        return canWrite().then(function () {
          return sb.from("docs").delete().eq("coll", coll).eq("id", id);
        }).then(function (x) {
          if (x.error) throw mapErr(x.error);
          changed(coll);
        });
      }
    };
  }

  var db = Object.freeze({ collection: function (c) { return query(c, {}); }, doc: docRef });

  /* ---------- yuklab olish ---------- */

  var TYPES = { json: "application/json", csv: "text/csv", txt: "text/plain", md: "text/markdown", html: "text/html" };
  var downloads = Object.freeze({
    save: function (o) {
      return new Promise(function (resolve, reject) {
        try {
          var name = (o && o.filename) || "fayl";
          var ext = (name.split(".").pop() || "").toLowerCase();
          var blob = o.data instanceof Blob ? o.data
            : new Blob([o.data == null ? "" : o.data], { type: (TYPES[ext] || "application/octet-stream") + ";charset=utf-8" });
          var href = URL.createObjectURL(blob);
          var a = document.createElement("a");
          a.href = href; a.download = name; a.style.display = "none";
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(href); }, 60000);
          resolve({ ok: true });
        } catch (e) { reject(err("failed", "Yuklab bo'lmadi")); }
      });
    }
  });

  /* ---------- fayllar (Storage, yopiq «files» bucket) ---------- */

  function hex(n) {
    var a = new Uint8Array(n);
    crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  }

  var assets = Object.freeze({
    upload: function (blob) {
      var id = hex(16);
      var type = blob.type || "application/octet-stream";
      return canWrite().then(function () {
        return sb.storage.from("files").upload(id, blob, { contentType: type, upsert: false });
      }).then(function (x) {
        if (x.error) throw mapErr(x.error);
        // Nisbiy havola: panel sahifasidan f/ yuklovchisiga olib boradi (u imzolangan havola oladi).
        var url = "f/?id=" + id + (blob.name ? "&n=" + encodeURIComponent(blob.name) : "");
        return { id: id, url: url, sizeBytes: blob.size, contentType: type };
      });
    },
    delete: function (id) {
      return sb.storage.from("files").remove([String(id)]).then(function (x) { if (x.error) throw mapErr(x.error); });
    }
  });

  window.claude = Object.freeze({
    use: function (name) {
      if (name === "db") return Promise.resolve(db);
      if (name === "downloads") return Promise.resolve(downloads);
      // Kuzatuvchi fayl yuklay olmaydi — panel yuklash tugmasini o'zi yashiradi.
      if (name === "assets") return CCOS.me().then(function (m) { return m && m.canWrite ? assets : null; });
      return Promise.resolve(null);
    }
  });

  /* ---------- hisob bloki (panel #acct joyini beradi) ---------- */

  CCOS.fillAccount = function () {
    var host = document.getElementById("acct");
    if (!host) return;
    CCOS.me().then(function (u) {
      if (!u) return;
      host.textContent = "";
      var who = document.createElement("div");
      who.className = "acct-who";
      var b = document.createElement("b"); b.textContent = u.name;
      var s = document.createElement("span"); s.textContent = u.roleLabel + (u.canWrite ? "" : " · faqat ko'rish");
      who.appendChild(b); who.appendChild(s);
      host.appendChild(who);
      // HR — panel menyusida («Ishga olish»), bu yerda faqat sozlamalar.
      [["settings/", "Sozlamalar"]].forEach(function (l) {
        var a = document.createElement("a"); a.href = BASE + l[0]; a.textContent = l[1];
        host.appendChild(a);
      });
      var out = document.createElement("button"); out.type = "button"; out.textContent = "Chiqish";
      out.addEventListener("click", CCOS.signOut);
      host.appendChild(out);
      host.hidden = false;
    });
  };
})();
