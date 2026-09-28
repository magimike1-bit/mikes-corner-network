/* site-auth.js — header auth widget. Included on every page.
 * Injects "Sign in / My account" + sign-out into .main-nav, driven by session.
 * Safe no-op when Supabase isn't configured (shows "Sign in" → account.html,
 * which explains local mode). */
import { isConfigured, getUser, signOut, onAuthChange } from "./sb.js";

function mount() {
  const nav = document.querySelector(".main-nav");
  if (!nav || document.getElementById("fra-auth-area")) return;
  const area = document.createElement("span");
  area.id = "fra-auth-area";
  area.style.cssText = "display:inline-flex;gap:8px;align-items:center;margin-left:8px";
  nav.appendChild(area);
  const render = async () => {
    const user = await getUser();
    if (user) {
      area.innerHTML = "";
      const a = document.createElement("a");
      a.href = "account.html"; a.textContent = "My account"; a.className = "auth-link";
      const out = document.createElement("button");
      out.type = "button"; out.textContent = "Sign out"; out.className = "auth-btn";
      out.addEventListener("click", async () => { await signOut(); render(); });
      area.append(a, out);
    } else {
      area.innerHTML = "";
      const a = document.createElement("a");
      a.href = "account.html"; a.textContent = isConfigured() ? "Sign in" : "Sign in";
      a.className = "btn auth-cta"; a.style.cssText = "padding:8px 16px;font-size:.9rem";
      area.appendChild(a);
    }
  };
  render();
  onAuthChange(() => render());
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
}
