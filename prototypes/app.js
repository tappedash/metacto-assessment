// Shared prototype behaviour: URL-backed views (deep links + browser back), multi-step
// flows, triage resolve/undo, autosave and an aria-live toast.

const navButtons = () => [...document.querySelectorAll(".nav [data-view]")];
const isNav = (id) => navButtons().some((b) => b.dataset.view === id);
// Views the user walked through in this page (detail views can chain: Ticket -> Need -> back).
let stack = [document.querySelector(".view.active")?.id].filter(Boolean);

function labelOf(id) {
  const nav = navButtons().find((b) => b.dataset.view === id);
  if (nav) return nav.querySelector(".label").textContent;
  const view = document.getElementById(id);
  return view?.dataset.label || view?.querySelector("h1")?.textContent || "Back";
}

// Detail views (not in the nav) declare a default parent with data-nav; the nav highlights
// the nearest list the user came from.
function showView(id, { push = true } = {}) {
  const view = document.getElementById(id);
  if (!view || !view.classList.contains("view")) return;
  if (push && stack[stack.length - 1] !== id) {
    stack.push(id);
    history.pushState({ view: id }, "", "#" + id);
  }
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v === view));
  const origin = [...stack].reverse().find(isNav);
  const navId = view.dataset.nav ? origin || view.dataset.nav : id;
  navButtons().forEach((b) => {
    if (b.dataset.view === navId) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  // Back links say where they go.
  const backLabel = view.querySelector(".back .back-label");
  if (backLabel) {
    const prev = stack.length > 1 ? stack[stack.length - 2] : view.querySelector("[data-back]")?.dataset.back;
    backLabel.textContent = labelOf(prev);
  }
  window.scrollTo({ top: 0 });
  const heading = view.querySelector("h1");
  if (heading) {
    heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: true });
  }
}

addEventListener("popstate", () => {
  const id = location.hash.slice(1) || document.querySelector(".view")?.id;
  if (stack.length > 1 && stack[stack.length - 2] === id) stack.pop();
  else stack = [id];
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
    if (stack.length > 1) history.back();
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
    stack = [id];
    showView(id, { push: false });
    addEventListener("load", () => window.scrollTo({ top: 0 }));
  }
}
