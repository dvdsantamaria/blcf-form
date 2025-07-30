const API_BASE = "/api/admin";

function getAdminToken() {
  return localStorage.getItem("adminToken") || "";
}
function setAdminToken(v) {
  localStorage.setItem("adminToken", v || "");
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

document.getElementById("saveToken").addEventListener("click", () => {
  const v = document.getElementById("adminToken").value.trim();
  setAdminToken(v);
  loadList();
});
document.getElementById("adminToken").value = getAdminToken();

async function loadList() {
  try {
    const data = await api("/submissions");
    const tbody = document.getElementById("tbody");
    tbody.innerHTML = "";
    (data.items || []).forEach((row) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${row.submissionId}</td>
        <td>${row.status || ""}</td>
        <td>${
          row.createdAt ? new Date(row.createdAt).toLocaleString() : ""
        }</td>
        <td>${
          row.lastActivityAt
            ? new Date(row.lastActivityAt).toLocaleString()
            : ""
        }</td>
        <td>${row.email || ""}</td>
        <td><button data-token="${row.submissionId}">Ver</button></td>
      `;
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll("button[data-token]").forEach((btn) => {
      btn.addEventListener("click", () => showDetail(btn.dataset.token));
    });
  } catch (e) {
    alert("Error cargando submissions: " + e.message);
    console.error(e);
  }
}

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

loadList();
