// public/scripts.js

const API_BASE = "/api";
const isReader = new URLSearchParams(location.search).get("mode") === "reader";
let currentStep = 0;
const steps = document.querySelectorAll(".step");
const submitBtn = document.getElementById("submitBtn");
const saveBtn = document.getElementById("saveDraftBtn");

if (isReader) {
  if (submitBtn) submitBtn.style.display = "none";
  if (saveBtn) saveBtn.style.display = "none";
  // Deshabilitar campos editables, NO los botones
  document.querySelectorAll("input, textarea, select").forEach((el) => {
    // permitimos que radio/checkbox muestren el estado, pero igual los deshabilitamos para evitar edición
    el.disabled = true;
  });
}

// Human-readable labels for validation errors
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

// Per-step rules
const STEP_RULES = {
  0: { required: ["child.firstName", "child.lastName", "child.dob"] },
  1: { required: ["therapy.toBeFunded"] },
  2: { required: ["parent1.firstName", "parent1.lastName", "parent1.email"] },
  3: { requiredChecks: ["consent.terms", "consent.truth"] },
  4: {},
};

function isEmail(v) {
  return !!v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

// Toast helper
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

// Validation helpers
function clearInvalid(container) {
  container.querySelectorAll(".is-invalid").forEach((el) => {
    el.classList.remove("is-invalid");
    el.removeAttribute("aria-invalid");
  });
}
function markInvalid(el) {
  el.classList.add("is-invalid");
  el.setAttribute("aria-invalid", "true");
  const remove = () => el.classList.remove("is-invalid");
  el.addEventListener("input", remove, { once: true });
  el.addEventListener("change", remove, { once: true });
}

// Validate step before advancing
function validateStep(idx) {
  const rules = STEP_RULES[idx] || {};
  const container = steps[idx];
  clearInvalid(container);
  const missing = [];
  let firstInvalid = null;

  (rules.required || []).forEach((name) => {
    const el = container.querySelector(`[name="${name}"]`);
    if (!el) return;
    const val = el.value.trim();
    const ok = name === "parent1.email" ? isEmail(val) : val.length > 0;
    if (!ok) {
      missing.push(LABEL[name] || name);
      markInvalid(el);
      firstInvalid ||= el;
    }
  });

  (rules.requiredChecks || []).forEach((name) => {
    const el = container.querySelector(`[name="${name}"]`);
    if (el && !el.checked) {
      missing.push(LABEL[name] || name);
      markInvalid(el);
      firstInvalid ||= el;
    }
  });

  if (missing.length) {
    showToast(`Please complete: ${missing.join(", ")}.`);
    firstInvalid?.scrollIntoView({ behavior: "smooth", block: "center" });
    firstInvalid?.focus();
    return false;
  }
  return true;
}

function showStep(n) {
  steps.forEach((s, i) => s.classList.toggle("active", i === n));
  // prev/next se mantienen visibles para navegar en reader
  const prevBtn = document.querySelector('button[onclick="nextStep(-1)"]');
  const nextBtn = document.querySelector('button[onclick="nextStep(1)"]');
  if (prevBtn)
    prevBtn.style.display =
      n === 0 || n === steps.length - 1 ? "none" : "inline-block";
  if (nextBtn)
    nextBtn.style.display = n >= steps.length - 2 ? "none" : "inline-block";

  // submit/save solo en modo edición
  if (submitBtn)
    submitBtn.style.display =
      n === steps.length - 2 && !isReader ? "inline-block" : "none";
  if (saveBtn)
    saveBtn.style.display =
      n === steps.length - 1 && !isReader ? "inline-block" : "none";
}

function nextStep(n) {
  // 👉 En reader NO validamos, pero permitimos navegar
  if (!isReader && n === 1 && !validateStep(currentStep)) return;
  currentStep += n;
  if (currentStep >= 0 && currentStep < steps.length) showStep(currentStep);
}
showStep(currentStep);

// Bloquear submit real en reader por seguridad
const grantForm = document.getElementById("grantForm");
if (grantForm) {
  grantForm.addEventListener("submit", (e) => {
    if (isReader) {
      e.preventDefault();
      showToast("Viewing only.");
    }
  });
}

(async function loadForReader() {
  try {
    if (!isReader) return;
    const qs = new URLSearchParams(location.search);
    const token = qs.get("token");
    if (!token) return;

    const res = await fetch(
      `${API_BASE}/form/view?token=${encodeURIComponent(token)}`
    );
    if (!res.ok) return;
    const payload = await res.json();
    const data = payload?.data || {}; // la API devuelve { ok, type, data, ... }

    // Populate inputs
    Object.entries(data).forEach(([name, value]) => {
      const input = document.querySelector(`[name="${name}"]`);
      if (!input) return;
      if (input.type === "checkbox") {
        input.checked = !!value;
      } else if (input.type === "radio") {
        const radio = document.querySelector(
          `input[name="${name}"][value="${value}"]`
        );
        if (radio) radio.checked = true;
      } else {
        input.value = value ?? "";
      }
    });

    // Intentar llevar al step guardado si viene en draft (cuando type==='draft')
    if (typeof payload.step === "number") {
      currentStep = Math.min(Math.max(0, payload.step), steps.length - 1);
      showStep(currentStep);
    }

    showToast(
      payload.type === "submitted" ? "Viewing submission." : "Viewing draft."
    );
  } catch (e) {
    console.error("reader load error:", e);
  }
})();

// LOAD DRAFT or SUBMISSION for reader mode
(async function loadDraftOnInit() {
  try {
    if (!isReader) return;
    const qs = new URLSearchParams(location.search);
    const token = qs.get("token");
    if (!token) return;
    localStorage.setItem("draftToken", token);
    const res = await fetch(
      `${API_BASE}/resume/get-draft?token=${encodeURIComponent(token)}`
    );
    if (!res.ok) return;
    const data = await res.json();
    // Populate fields
    Object.entries(data)
      .filter(([k]) => k !== "step")
      .forEach(([name, value]) => {
        const input = document.querySelector(`[name="${name}"]`);
        if (!input) return;
        if (input.type === "checkbox") {
          input.checked = !!value;
        } else if (input.type === "radio") {
          const radio = document.querySelector(
            `input[name="${name}"][value="${value}"]`
          );
          if (radio) radio.checked = true;
        } else {
          input.value = value ?? "";
        }
      });
    if (typeof data.step === "number") {
      currentStep = Math.min(Math.max(0, data.step), steps.length - 1);
      showStep(currentStep);
    }
    showToast("Viewing submission.");
  } catch (e) {
    console.error("loadDraftOnInit error:", e);
  }
})();

// Only register upload & save logic if not reader
if (!isReader) {
  // Ensure draft token exists on first save
  async function ensureToken() {
    let token = localStorage.getItem("draftToken");
    if (token) return token;
    const fd = new FormData();
    fd.append("step", currentStep);
    const res = await fetch(`${API_BASE}/save-draft`, {
      method: "POST",
      body: fd,
    });
    if (!res.ok) throw new Error(`save-draft ${res.status}`);
    const j = await res.json();
    token = j.token;
    localStorage.setItem("draftToken", token);
    return token;
  }

  // File upload wiring
  document.querySelectorAll("input[type='file']").forEach((input) => {
    input.addEventListener("change", async () => {
      const file = input.files[0];
      if (!file) return;
      const fieldName = input.name;
      const ext = file.name.split(".").pop().toLowerCase();
      const mimeMap = {
        pdf: "application/pdf",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        webp: "image/webp",
        heic: "image/heic",
        heif: "image/heic",
      };
      const mime = file.type || mimeMap[ext] || "";
      if (!mime) return showToast("Unsupported file type.");
      try {
        const token = await ensureToken();
        const res = await fetch(
          `${API_BASE}/generate-upload-url?field=${encodeURIComponent(
            fieldName
          )}&token=${encodeURIComponent(token)}&type=${encodeURIComponent(
            mime
          )}`
        );
        if (!res.ok) throw new Error("Failed to get signed URL");
        const { url, key } = await res.json();
        const up = await fetch(url, {
          method: "PUT",
          headers: { "Content-Type": mime },
          body: file,
        });
        if (!up.ok) throw new Error("Upload failed");
        input.dataset.s3key = key;
        showToast("File uploaded.");
      } catch (err) {
        console.error(err);
        showToast("Upload error.");
      }
    });
  });

  // Save draft handler bound to save button
  window.saveStep = async function saveStep() {
    const form = document.getElementById("grantForm");
    const formData = new FormData(form);
    document.querySelectorAll("input[type='file']").forEach((input) => {
      if (formData.has(input.name)) formData.delete(input.name);
      if (input.dataset.s3key) formData.append(input.name, input.dataset.s3key);
    });
    formData.append("step", currentStep);
    const existingToken = localStorage.getItem("draftToken");
    if (existingToken) formData.append("token", existingToken);
    try {
      const resp = await fetch(`${API_BASE}/save-draft`, {
        method: "POST",
        body: formData,
      });
      const json = await resp.json();
      if (json.token) localStorage.setItem("draftToken", json.token);
      const emailEl = document.querySelector('[name="parent1.email"]');
      const email = emailEl?.value.trim();
      const token = json.token || existingToken;
      if (email && token) {
        const sentKey = `resumeSent:${token}`;
        if (!localStorage.getItem(sentKey)) {
          await fetch(`${API_BASE}/resume/send-link`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token, email }),
          });
          localStorage.setItem(sentKey, "1");
        }
      }
      showToast("Draft saved.");
    } catch (err) {
      console.error(err);
      showToast("Error saving draft.");
    }
  };
}

// Final submit
if (!isReader && grantForm) {
  grantForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!validateStep(currentStep)) return;
    const formData = new FormData(grantForm);
    document.querySelectorAll("input[type='file']").forEach((input) => {
      if (formData.has(input.name)) formData.delete(input.name);
      if (input.dataset.s3key) formData.append(input.name, input.dataset.s3key);
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
        Object.keys(localStorage)
          .filter((k) => k.startsWith("resumeSent:"))
          .forEach((k) => localStorage.removeItem(k));
        currentStep = steps.length - 1;
        showStep(currentStep);
        showToast("Submission received.");
      } else {
        console.error("Submit failed:", await res.text());
        showToast("Submission failed.");
      }
    } catch (err) {
      console.error(err);
      showToast("Submission failed.");
    }
  });
}

// Dev helper to clear session
window.devClearResumeSession = async function () {
  try {
    await fetch(`${API_BASE}/resume/logout`, { method: "POST" });
  } catch {}
  localStorage.removeItem("draftToken");
  Object.keys(localStorage)
    .filter((k) => k.startsWith("resumeSent:"))
    .forEach((k) => localStorage.removeItem(k));
  showToast("Session cleared.");
  setTimeout(() => location.replace("/"), 500);
};
