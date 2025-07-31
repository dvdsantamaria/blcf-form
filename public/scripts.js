// frontend/scripts.js
const API_BASE = "/api";

let currentStep = 0;
const steps = document.querySelectorAll(".step");
const submitBtn = document.getElementById("submitBtn");

// labels + per-step rules (0-indexed)
const LABEL = {
  "child.firstName": "Child first name",
  "child.lastName": "Child last name",
  "child.dob": "Date of birth",
  "therapy.toBeFunded": "Therapy to be funded",
  "parent1.firstName": "Parent/Carer 1 first name",
  "parent1.lastName": "Parent/Carer 1 last name",
  "parent1.email": "Parent/Carer 1 email",
  "consent.terms": "Agree to privacy & terms",
  "consent.truth": "Declaration is true",
};

const STEP_RULES = {
  0: { required: ["child.firstName", "child.lastName", "child.dob"] }, // Step 1
  1: { required: ["therapy.toBeFunded"] }, // Step 2 (NDIS/Therapy)
  2: { required: ["parent1.firstName", "parent1.lastName", "parent1.email"] }, // Step 3 (Parent)
  3: { requiredChecks: ["consent.terms", "consent.truth"] }, // Step 4 (Consent)
  4: {}, // Step 5 (Thank you)
};

function isEmail(v) {
  return !!v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

function showToast(msg) {
  let t = document.getElementById("toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    t.setAttribute("role", "status");
    t.setAttribute("aria-live", "polite");
    Object.assign(t.style, {
      position: "fixed",
      bottom: "20px",
      left: "50%",
      transform: "translateX(-50%)",
      background: "#222",
      color: "#fff",
      padding: "10px 16px",
      borderRadius: "10px",
      fontSize: "14px",
      boxShadow: "0 6px 18px rgba(0,0,0,.25)",
      zIndex: 9999,
      opacity: 0,
      transition: "opacity .25s",
    });
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = "1";
  clearTimeout(t._h);
  t._h = setTimeout(() => (t.style.opacity = "0"), 3000);
}

function clearInvalid(container) {
  container.querySelectorAll(".is-invalid").forEach((el) => {
    el.classList.remove("is-invalid");
    el.removeAttribute("aria-invalid");
  });
}

function markInvalid(el) {
  if (!el) return;
  el.classList.add("is-invalid");
  el.setAttribute("aria-invalid", "true");
  const remove = () => el.classList.remove("is-invalid");
  el.addEventListener("input", remove, { once: true });
  el.addEventListener("change", remove, { once: true });
}

function validateStep(stepIndex) {
  const rules = STEP_RULES[stepIndex] || {};
  const container = steps[stepIndex];
  if (!container) return true;

  clearInvalid(container);

  const missing = [];
  let firstInvalid = null;

  (rules.required || []).forEach((name) => {
    const el = container.querySelector(`[name="${name}"]`);
    if (!el) return;
    const val = el ? String(el.value ?? "").trim() : "";
    const ok = name === "parent1.email" ? isEmail(val) : val.length > 0;
    if (!ok) {
      missing.push(LABEL[name] || name);
      markInvalid(el);
      if (!firstInvalid) firstInvalid = el;
    }
  });

  (rules.requiredChecks || []).forEach((name) => {
    const el = container.querySelector(`[name="${name}"]`);
    if (!el) return;
    const ok = !!el.checked;
    if (!ok) {
      missing.push(LABEL[name] || name);
      markInvalid(el);
      if (!firstInvalid) firstInvalid = el;
    }
  });

  if (missing.length) {
    showToast(`Please complete: ${missing.join(", ")}.`);
    if (firstInvalid && firstInvalid.scrollIntoView) {
      firstInvalid.scrollIntoView({ behavior: "smooth", block: "center" });
      firstInvalid.focus?.();
    }
    return false;
  }
  return true;
}

function showStep(n) {
  steps.forEach((s, i) => s.classList.toggle("active", i === n));
  document.querySelector('button[onclick="nextStep(-1)"]').style.display =
    n === 0 || n === steps.length - 1 ? "none" : "inline-block";
  document.querySelector('button[onclick="nextStep(1)"]').style.display =
    n >= steps.length - 2 ? "none" : "inline-block";
  submitBtn.style.display = n === steps.length - 2 ? "inline-block" : "none";
}

function nextStep(n) {
  if (n === 1 && !validateStep(currentStep)) return;
  currentStep += n;
  if (currentStep >= 0 && currentStep < steps.length) showStep(currentStep);
}
showStep(currentStep);

// token + draft + uploads
async function ensureToken() {
  let token = localStorage.getItem("draftToken");
  if (token) return token;
  const fd = new FormData();
  fd.append("step", currentStep);
  const r = await fetch(`${API_BASE}/save-draft`, { method: "POST", body: fd });
  if (!r.ok) throw new Error(`save-draft ${r.status}: ${await r.text()}`);
  const j = await r.json();
  token = j?.token;
  if (!token) throw new Error("No token returned by save-draft");
  localStorage.setItem("draftToken", token);
  return token;
}

async function saveStep() {
  const form = document.getElementById("grantForm");
  const formData = new FormData(form);

  // *** FIX: borrar blobs de los inputs file del FormData ***
  document.querySelectorAll('input[type="file"]').forEach((input) => {
    if (formData.has(input.name)) {
      formData.delete(input.name); // elimina TODAS las entradas con ese nombre
    }
  });

  // luego agregamos SOLO la S3 key como string
  document.querySelectorAll('input[type="file"]').forEach((input) => {
    const key = input.dataset.s3key;
    if (key) formData.append(input.name || "file", key);
  });

  formData.append("step", currentStep);
  const existingToken = localStorage.getItem("draftToken");
  if (existingToken) formData.append("token", existingToken);

  try {
    const resp = await fetch(`${API_BASE}/save-draft`, {
      method: "POST",
      body: formData,
    });
    if (!resp.ok)
      throw new Error(`save-draft ${resp.status}: ${await resp.text()}`);
    const json = await resp.json();
    if (json?.token) localStorage.setItem("draftToken", json.token);
    showToast("Draft saved.");
  } catch (err) {
    console.error(err);
    showToast("Error saving draft.");
  }
}

document.querySelectorAll('input[type="file"]').forEach((input) => {
  input.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Usar input.name para mapear 1:1 con el backend
    const fieldName = input.name || "file";

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
      (file.type && file.type.trim()) || mimeFallbackByExt[ext] || "";
    if (!mime) return showToast("Unsupported/unknown file type.");

    try {
      const token = await ensureToken();
      const res = await fetch(
        `${API_BASE}/generate-upload-url?field=${encodeURIComponent(
          fieldName
        )}&type=${encodeURIComponent(mime)}&token=${encodeURIComponent(token)}`
      );
      if (!res.ok) throw new Error("Failed to get signed URL");
      const { url, key } = await res.json();

      const uploadRes = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": mime },
        body: file,
      });
      if (!uploadRes.ok) throw new Error("Upload failed");

      input.dataset.s3key = key;
      showToast("File uploaded.");
    } catch (err) {
      console.error("Upload error:", err);
      showToast("Upload error.");
    }
  });
});

document.getElementById("grantForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!validateStep(currentStep)) return;

  const form = e.target;
  const formData = new FormData(form);

  // *** FIX: borrar blobs de los inputs file del FormData ***
  document.querySelectorAll('input[type="file"]').forEach((input) => {
    if (formData.has(input.name)) {
      formData.delete(input.name);
    }
  });

  // y enviar SOLO las S3 keys
  document.querySelectorAll('input[type="file"]').forEach((input) => {
    const key = input.dataset.s3key;
    if (key) formData.append(input.name || "file", key);
  });

  const existingToken = localStorage.getItem("draftToken");
  if (existingToken) formData.append("token", existingToken);

  try {
    const res = await fetch(`${API_BASE}/submit-form`, {
      method: "POST",
      body: formData,
    });
    if (res.ok) {
      localStorage.removeItem("draftToken");
      currentStep = steps.length - 1;
      showStep(currentStep);
      showToast("Submission received.");
    } else {
      const txt = await res.text();
      console.error("Submit failed:", txt);
      showToast("Submission failed.");
    }
  } catch (err) {
    console.error("Submit error:", err);
    showToast("Submission failed.");
  }
});
