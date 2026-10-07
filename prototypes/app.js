// Shared prototype behaviour: URL-backed views (deep links + browser back), multi-step
// flows, triage resolve/undo, autosave and an aria-live toast.

const navButtons = () => [...document.querySelectorAll(".nav [data-view]")];
let currentView = document.querySelector(".view.active")?.id;
let previousView = null;

// Detail views (not in the nav) declare their default parent with data-nav and
// highlight whichever list they were opened from.
function showView(id, { push = true } = {}) {
  const view = document.getElementById(id);
  if (!view || !view.classList.contains("view")) return;
  if (id !== currentView) {
    previousView = currentView;
    currentView = id;
  }
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v === view));
  const navIds = navButtons().map((b) => b.dataset.view);
  const navId = view.dataset.nav ? (navIds.includes(previousView) ? previousView : view.dataset.nav) : id;
  navButtons().forEach((b) => {
    if (b.dataset.view === navId) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  // Back links say where they go.
  const backLabel = view.querySelector(".back .back-label");
  if (backLabel) {
    const origin = navButtons().find((b) => b.dataset.view === navId);
    backLabel.textContent = origin ? origin.querySelector(".label").textContent : "Back";
  }
  if (push && location.hash !== "#" + id) history.pushState({ view: id }, "", "#" + id);
  window.scrollTo({ top: 0 });
  const heading = view.querySelector("h1");
  if (heading) {
    heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: true });
  }
}

addEventListener("popstate", () => {
  const id = location.hash.slice(1) || document.querySelector(".view")?.id;
  showView(id, { push: false });
});

// Multi-step flows: <div data-flow="x"> with children [data-step="1"], buttons data-goto-step="x:2".
// Steps past the last indicator label (alternative outcomes) all count as the final step.
function showStep(flow, n) {
  const root = document.querySelector(`[data-flow="${flow}"]`);
  root.querySelectorAll("[data-step]").forEach((s) => s.classList.toggle("hidden", s.dataset.step !== String(n)));
  const labels = root.querySelectorAll(".steps li");
  const idx = Math.min(Number(n), labels.length);
  labels.forEach((li, i) => {
    li.classList.toggle("done", i + 1 < idx);
    if (i + 1 === idx) li.setAttribute("aria-current", "step");
    else li.removeAttribute("aria-current");
  });
  const focusTarget = root.querySelector(`[data-step="${n}"] h2`);
  if (focusTarget) {
    focusTarget.setAttribute("tabindex", "-1");
    focusTarget.focus({ preventScroll: true });
  }
}

const live = document.createElement("div");
live.className = "toast";
live.setAttribute("role", "status");
live.setAttribute("aria-live", "polite");
document.body.appendChild(live);

function toast(msg) {
  live.textContent = msg;
  live.classList.add("show");
  clearTimeout(live._t);
  live._t = setTimeout(() => live.classList.remove("show"), 3500);
}

// Triage: resolving an item collapses it with an Undo; counts and the empty state follow.
function updateTriageCount() {
  const open = document.querySelectorAll("#triage article.item:not(.is-resolved)").length;
  document.querySelectorAll("[data-count]").forEach((el) => {
    el.textContent = open;
    el.classList.toggle("hidden", open === 0);
  });
  const title = document.getElementById("h-triage");
  if (title) title.textContent = open ? `${open} item${open === 1 ? " needs" : "s need"} your judgment` : "All caught up";
  document.getElementById("triage-empty")?.classList.toggle("hidden", open !== 0);
}

function resolveItem(btn) {
  const item = btn.closest("article.item");
  item.dataset.original = item.innerHTML;
  item.classList.add("is-resolved");
  item.innerHTML = `<div class="resolved"><span class="done-mark">${btn.dataset.resolve}</span>
    <button class="btn btn-ghost btn-sm" data-undo>Undo</button></div>`;
  item.querySelector("[data-undo]").focus();
  toast(btn.dataset.resolve);
  updateTriageCount();
}

function undoItem(btn) {
  const item = btn.closest("article.item");
  item.innerHTML = item.dataset.original;
  item.classList.remove("is-resolved");
  toast("Undone");
  updateTriageCount();
}

document.addEventListener("click", (e) => {
  const nav = e.target.closest(".nav [data-view]");
  if (nav) showView(nav.dataset.view);
  const back = e.target.closest("[data-back]");
  if (back) {
    // Use browser history when we navigated here inside the page; otherwise the declared parent.
    if (previousView && history.state && history.state.view) history.back();
    else showView(back.dataset.back);
    return;
  }
  const go = e.target.closest("[data-go]");
  if (go) {
    e.preventDefault();
    showView(go.dataset.go);
  }
  const step = e.target.closest("[data-goto-step]");
  if (step) {
    const [flow, n] = step.dataset.gotoStep.split(":");
    showStep(flow, n);
  }
  const resolve = e.target.closest("[data-resolve]");
  if (resolve) return resolveItem(resolve);
  const undo = e.target.closest("[data-undo]");
  if (undo) return undoItem(undo);
  const t = e.target.closest("[data-toast]");
  if (t) toast(t.dataset.toast);
});

// Settings that save on change (no separate Save click).
document.addEventListener("change", (e) => {
  const el = e.target.closest("[data-autosave]");
  if (el) toast(`Saved: ${el.dataset.autosave} ${el.type === "checkbox" ? (el.checked ? "added" : "removed") : "updated"}`);
});

// Open a view directly from the URL, e.g. pm.html#need
if (location.hash) {
  const id = location.hash.slice(1);
  if (document.getElementById(id)?.classList.contains("view")) {
    history.replaceState({ view: id }, "", "#" + id);
    showView(id, { push: false });
    addEventListener("load", () => window.scrollTo({ top: 0 }));
  }
}
