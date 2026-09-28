/* site-auth.js — header auth widget + per-account resume writer.
 * Included on every page.
 *
 * Auth widget: logged out → "Sign in" button. Logged in → circular
 * initial-avatar with a dropdown ("My account" → account.html, "Sign out").
 * Driven by session. Safe no-op when Supabase isn't configured (shows
 * "Sign in" → account.html, which explains local mode).
 *
 * Resume writer: on every page load except account.html, records
 * { page, title, at, setupId, setupName } to profiles.resume_state for
 * logged-in users ("where you left off", cross-device). Guests keep it in
 * localStorage fra_last_page. Writes only when the page/setup changed or
 * the last write is over an hour old, to avoid write spam. The simulator
 * stashes setup info in sessionStorage fra_resume_setup when it loads a
 * setup (sim-save.js runs before this module — its script tag is earlier —
 * so the stash is in place before this write). */
import { getUser, signOut, onAuthChange } from './sb.c957517c.js';
import { logActivity, saveResumeState } from './db.fd18dc7a.js';

function mount() {
  const nav = document.querySelector(".main-nav");
  if (!nav || document.getElementById("fra-auth-area")) return;
  const area = document.createElement("span");
  area.id = "fra-auth-area";
  area.style.cssText = "display:inline-flex;gap:8px;align-items:center;margin-left:8px;position:relative";
  nav.appendChild(area);
  // Same clear-then-append race as account.js boot(): a superseded render
  // bails so concurrent auth events can't duplicate the nav links.
  let renderSeq = 0;
  let outsideCloser = null;
  let escCloser = null;
  const teardownClosers = () => {
    if (outsideCloser) { document.removeEventListener("click", outsideCloser); outsideCloser = null; }
    if (escCloser) { document.removeEventListener("keydown", escCloser); escCloser = null; }
  };

  const closeDropdown = () => {
    const dd = area.querySelector(".fra-dropdown");
    if (dd) dd.hidden = true;
    const av = area.querySelector(".fra-avatar");
    if (av) av.setAttribute("aria-expanded", "false");
  };
  const render = async () => {
    const my = ++renderSeq;
    const user = await getUser();
    if (my !== renderSeq) return;
    teardownClosers();
    if (user) {
      const initial = String((user.email || "?")[0] || "?").toUpperCase();
      area.innerHTML = "";
      const av = document.createElement("button");
      av.type = "button";
      av.className = "fra-avatar";
      av.textContent = initial;
      av.title = "Signed in as " + (user.email || "your account");
      av.setAttribute("aria-label", "Account menu — signed in as " + (user.email || "your account"));
      av.setAttribute("aria-expanded", "false");
      av.setAttribute("aria-haspopup", "true");
      const dd = document.createElement("div");
      dd.className = "fra-dropdown";
      dd.hidden = true;
      const myAcct = document.createElement("a");
      myAcct.href = "account.html";
      myAcct.textContent = "My account";
      const out = document.createElement("button");
      out.type = "button";
      out.textContent = "Sign out";
      out.className = "fra-dropdown-signout";
      dd.append(myAcct, out);
      area.append(av, dd);
      av.addEventListener("click", (e) => {
        e.stopPropagation();
        const open = dd.hidden;
        dd.hidden = !open;
        av.setAttribute("aria-expanded", String(open));
      });
      out.addEventListener("click", async () => { await signOut(); render(); });
      // One document-level closer per render; removed on the next render.
      outsideCloser = (e) => {
        if (!area.contains(e.target)) closeDropdown();
      };
      document.addEventListener("click", outsideCloser);
      escCloser = (e) => { if (e.key === "Escape") closeDropdown(); };
      document.addEventListener("keydown", escCloser);
    } else {
      area.innerHTML = "";
      const a = document.createElement("a");
      a.href = "account.html"; a.textContent = "Sign in";
      a.className = "btn auth-cta"; a.style.cssText = "padding:8px 16px;font-size:.9rem";
      area.appendChild(a);
    }
  };
  render();
  // Single auth subscriber: render on every event, plus a once-per-tab
  // sign-in analytics event (SIGNED_IN fires per real sign-in; the
  // sessionStorage guard keeps multi-tab storage syncs from double counting).
  onAuthChange((event) => {
    if (event === "SIGNED_IN") {
      try {
        if (!sessionStorage.getItem("fra_signin_logged")) {
          sessionStorage.setItem("fra_signin_logged", "1");
          logActivity("auth.sign_in", "Signed in");
        }
      } catch (e) { /* storage may be blocked; still render */ }
    }
    render();
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
    document.addEventListener("DOMContentLoaded", writeResume);
  } else {
    mount();
    writeResume();
  }
}

/* "Where you left off" — per-account resume state, cross-device.
 * Never writes for account.html itself (the dashboard card must never point
 * at itself). */
async function writeResume() {
  try {
    const page = (location.pathname.split("/").pop() || "index.html").toLowerCase();
    if (page === "account.html") return;
    const title = (document.title || "").split("—")[0].trim() || page;
    const at = new Date().toISOString();
    let setupId = null, setupName = null;
    try {
      const st = JSON.parse(sessionStorage.getItem("fra_resume_setup") || "null");
      if (st) { setupId = st.setupId || null; setupName = st.setupName || null; }
    } catch (e) {}
    const user = await getUser().catch(() => null);
    if (!user) {
      try {
        localStorage.setItem("fra_last_page",
          JSON.stringify({ page, title, at, setupId, setupName }));
      } catch (e) {}
      return;
    }
    // Skip the write when nothing meaningful changed (page + setup match
    // and the last write is under an hour old).
    let cache = null;
    try { cache = JSON.parse(localStorage.getItem("fra_resume_cache") || "null"); } catch (e) {}
    if (cache && cache.page === page && cache.setupId === setupId &&
        cache.at && (Date.now() - new Date(cache.at).getTime()) < 3600000) return;
    const ok = await saveResumeState({ page, title, at, setupId, setupName });
    if (ok) {
      try { localStorage.setItem("fra_resume_cache", JSON.stringify({ page, setupId, at })); }
      catch (e) {}
    }
  } catch (e) { /* resume is best-effort; never break the page */ }
}
