// admin.js

const API_BASE = "/api/admin";

// === Token ===
export function getAdminToken() {
  return localStorage.getItem("adminToken") || "";
}

export function setAdminToken(token) {
  localStorage.setItem("adminToken", token || "");
}

async function api(path, opts = {}) {
  const headers = Object.assign({}, opts.headers || {}, {
    "x-admin-token": getAdminToken(),
  });
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  if (!res.ok)
    throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  return res.json();
}

// === Login UI ===
export function renderLoginUI({ selector = "body" } = {}) {
  const container = document.querySelector(selector);
  if (!container) return;

  container.innerHTML = `
    <h4 class="mb-4 text-center">Admin Access</h4>
    <form id="magicLoginForm" class="needs-validation" novalidate>
      <div class="mb-3">
        <label for="adminEmail" class="form-label">Your email</label>
        <input type="email" class="form-control" id="adminEmail" required />
      </div>
      <button type="submit" class="btn btn-primary w-100">Send Magic Link</button>
    </form>
    <p class="text-muted mt-4 small text-center">
      Only approved admin emails can receive access links.
    </p>
  `;

  const form = container.querySelector("#magicLoginForm");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("adminEmail").value.trim();
    if (!email) return;

    try {
      const res = await fetch(`${API_BASE}/request-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error(await res.text());
      alert("Magic link sent! Check your email.");
    } catch (err) {
      alert("Error sending link: " + err.message);
    }
  });
}

// === Verifica si hay token válido y carga la lista ===
export async function checkAuth() {
  const token = getAdminToken();
  if (!token) return false;

  try {
    const res = await api("/submissions");
    if (!res.items) throw new Error("No items");
    loadList(res.items);
    showUserEmail(token);
    return true;
  } catch (err) {
    console.warn("Auth failed:", err.message);
    return false;
  }
}

// === Utilidad para mostrar el email del token ===
function showUserEmail(token) {
  const greet = document.querySelector(".user-greeting");
  if (!greet) return;
  greet.textContent = "";

  try {
    const [, payload] = token.split(".");
    const { sub: email } = JSON.parse(atob(payload));
    greet.textContent = `Logged in as: ${email}`;
    greet.style.cssText =
      "text-align:right; margin:8px 24px 0 0; color:#0b5ed7; font-weight:500;";
  } catch (e) {}
}

// === Tabla de envíos ===
function loadList(items) {
  const tbody = document.getElementById("tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  (items || []).forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.submissionId}</td>
      <td>${row.createdAt || "-"}</td>
      <td>${row.token || "-"}</td>
      <td>
        <button class="btn btn-sm btn-outline-primary btn-open" data-token="${
          row.submissionId
        }">Open</button>
        <button class="btn btn-sm btn-outline-secondary btn-manifest" data-token="${
          row.submissionId
        }">Manifest</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll("button.btn-open").forEach((btn) => {
    btn.addEventListener("click", () => {
      const url = `${location.origin}/?mode=reader&token=${encodeURIComponent(
        btn.dataset.token
      )}`;
      window.open(url, "_blank", "noopener");
    });
  });

  tbody.querySelectorAll("button.btn-manifest").forEach((btn) => {
    btn.addEventListener("click", () => showDetail(btn.dataset.token));
  });
}

// === Detalle ===
async function showDetail(token) {
  try {
    const data = await api(`/submission/${encodeURIComponent(token)}/manifest`);
    document.getElementById("detToken").textContent = token;
    document.getElementById("manifest").textContent = JSON.stringify(
      data.manifest,
      null,
      2
    );
    document.getElementById("detail").classList.remove("hidden");
  } catch (e) {
    alert("Error manifest: " + e.message);
    console.error(e);
  }
}

// === Token manual opcional ===
document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("saveToken");
  const inp = document.getElementById("adminToken");
  if (btn && inp) {
    inp.value = getAdminToken();
    btn.addEventListener("click", () => {
      setAdminToken(inp.value.trim());
      location.reload();
    });
  }
});
