// frontend/scripts.js
const API_BASE = "/api";

let currentStep = 0;
const steps = document.querySelectorAll(".step");
const submitBtn = document.getElementById("submitBtn");

function showStep(n) {
  steps.forEach((s, i) => s.classList.toggle("active", i === n));
  document.querySelector('button[onclick="nextStep(-1)"]').style.display =
    n === 0 || n === steps.length - 1 ? "none" : "inline-block";
  document.querySelector('button[onclick="nextStep(1)"]').style.display =
    n >= steps.length - 2 ? "none" : "inline-block";
  submitBtn.style.display = n === steps.length - 2 ? "inline-block" : "none";
}

function nextStep(n) {
  currentStep += n;
  if (currentStep >= 0 && currentStep < steps.length) showStep(currentStep);
}
showStep(currentStep);

// Asegura token antes de subir archivos
async function ensureToken() {
  let token = localStorage.getItem("draftToken");
  if (token) return token;

  const fd = new FormData();
  fd.append("step", currentStep);

  const r = await fetch(`${API_BASE}/save-draft`, { method: "POST", body: fd });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`save-draft ${r.status}: ${txt}`);
  }
  const j = await r.json();
  token = j?.token;
  if (!token) throw new Error("No token returned by save-draft");
  localStorage.setItem("draftToken", token);
  return token;
}

async function saveStep() {
  const form = document.getElementById("grantForm");
  const formData = new FormData(form);

  document.querySelectorAll('input[type="file"]').forEach((input) => {
    const key = input.dataset.s3key;
    if (key) formData.append(`${input.name || "file"}`, key);
  });

  formData.append("step", currentStep);

  // Reuse token si ya existe
  const existingToken = localStorage.getItem("draftToken");
  if (existingToken) formData.append("token", existingToken);

  try {
    const resp = await fetch(`${API_BASE}/save-draft`, {
      method: "POST",
      body: formData,
    });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`save-draft ${resp.status}: ${txt}`);
    }
    const json = await resp.json();
    if (json?.token) localStorage.setItem("draftToken", json.token);
    alert("Draft saved successfully.");
  } catch (err) {
    console.error(err);
    alert("Error saving draft.");
  }
}

document.querySelectorAll('input[type="file"]').forEach((input) => {
  input.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const label = input.previousElementSibling?.innerText || "file";
    const fieldName = label.toLowerCase().replace(/\s+/g, "_");

    const ext = (file.name.split(".").pop() || "").toLowerCase();
    const mimeFallbackByExt = {
      pdf: "application/pdf",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
      heic: "image/heic",
      heif: "image/heic",
    };
    const mime =
      file.type && file.type.trim() !== ""
        ? file.type
        : mimeFallbackByExt[ext] || "";

    if (!mime) {
      alert("Formato no soportado o desconocido.");
      return;
    }

    try {
      // 1) asegurar token
      const token = await ensureToken();

      // 2) pedir URL firmada con token (path submissions/{token}/uploads/...)
      const res = await fetch(
        `${API_BASE}/generate-upload-url?field=${encodeURIComponent(
          fieldName
        )}&type=${encodeURIComponent(mime)}&token=${encodeURIComponent(token)}`
      );
      if (!res.ok) throw new Error("No se pudo generar la URL firmada");
      const { url, key } = await res.json();

      // 3) subir directo a S3
      const uploadRes = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": mime },
        body: file,
      });
      if (!uploadRes.ok) throw new Error("Upload failed");

      input.dataset.s3key = key; // será enviado luego en save/submit
      console.log(`Uploaded to S3: ${key}`);
    } catch (err) {
      console.error("Upload error:", err);
      alert("Upload error.");
    }
  });
});

document.getElementById("grantForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const formData = new FormData(form);

  document.querySelectorAll('input[type="file"]').forEach((input) => {
    const key = input.dataset.s3key;
    if (key) formData.append(`${input.name || "file"}`, key);
  });

  // Enviar token para finalizar el mismo draft
  const existingToken = localStorage.getItem("draftToken");
  if (existingToken) formData.append("token", existingToken);

  try {
    const res = await fetch(`${API_BASE}/submit-form`, {
      method: "POST",
      body: formData,
    });

    if (res.ok) {
      // limpiar token local tras envío final
      localStorage.removeItem("draftToken");
      currentStep = steps.length - 1;
      showStep(currentStep);
    } else {
      const txt = await res.text();
      console.error("Submit failed:", txt);
      alert("Submission failed.");
    }
  } catch (err) {
    console.error("❌ Submit error:", err);
    alert("Submission failed.");
  }
});
