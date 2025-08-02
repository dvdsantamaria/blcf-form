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
      <td>
        <button data-token="${row.submissionId}" class="btn-open">
          Open
        </button>
        <button data-token="${row.submissionId}" class="btn-manifest">
          Manifest
        </button>
      </td>;

      tbody.querySelectorAll("button.btn-open").forEach((btn) => {
        btn.addEventListener("click", () => {
          const FRONT_BASE = window.FRONT_BASE || location.origin;
          const url = `${FRONT_BASE}/?mode=reader&token=${encodeURIComponent(
            btn.dataset.token
          )}`;
          window.open(url, "_blank", "noopener");
        });
      });
      tbody.querySelectorAll("button.btn-manifest").forEach((btn) => {
        btn.addEventListener("click", () => showDetail(btn.dataset.token));
      });
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
