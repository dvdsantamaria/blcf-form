// frontend/scripts.js
const API_BASE = "/api";

let currentStep = 0;
const steps = document.querySelectorAll(".step");
const submitBtn = document.getElementById("submitBtn");
const saveBtn = document.getElementById("saveDraftBtn");

// Human-readable labels for errors
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

// Per-step required fields
const STEP_RULES = {
  0: { required: ["child.firstName", "child.lastName", "child.dob"] },
  1: { required: ["therapy.toBeFunded"] },
  2: { required: ["parent1.firstName", "parent1.lastName", "parent1.email"] },
  3: { requiredChecks: ["consent.terms", "consent.truth"] },
  4: {}, // Thank you
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

// Mark/unmark invalid fields
function clearInvalid(container) {
  container.querySelectorAll(".is-invalid").forEach((el) => {
    el.classList.remove("is-invalid");
    el.removeAttribute("aria-invalid");
  });
}
function markInvalid(el) {
  el.classList.add("is-invalid");
  el.setAttribute("aria-invalid", "true");
  const remove = () => {
    el.classList.remove("is-invalid");
  };
  el.addEventListener("input", remove, { once: true });
  el.addEventListener("change", remove, { once: true });
}

// Validate current step
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

// Step navigation
function showStep(n) {
  steps.forEach((s, i) => s.classList.toggle("active", i === n));
  document.querySelector('button[onclick="nextStep(-1)"]').style.display =
    n === 0 || n === steps.length - 1 ? "none" : "inline-block";
  document.querySelector('button[onclick="nextStep(1)"]').style.display =
    n >= steps.length - 2 ? "none" : "inline-block";
  submitBtn.style.display = n === steps.length - 2 ? "inline-block" : "none";
  // Hide Save on last step
  saveBtn.style.display = n === steps.length - 1 ? "none" : "inline-block";
}
function nextStep(n) {
  if (n === 1 && !validateStep(currentStep)) return;
  currentStep += n;
  if (currentStep >= 0 && currentStep < steps.length) showStep(currentStep);
}
showStep(currentStep);

// Ensure draft token exists
async function ensureToken() {
  let token = localStorage.getItem("draftToken");
  if (token) return token;
  const fd = new FormData();
  fd.append("step", currentStep);
  const res = await fetch(`${API_BASE}/save-draft`, {
    method: "POST",
    body: fd,
  });
  if (!res.ok) throw new Error(`save-draft ${res.status}: ${await res.text()}`);
  const j = await res.json();
  token = j.token;
  if (!token) throw new Error("No token returned by save-draft");
  localStorage.setItem("draftToken", token);
  return token;
}

// Save draft handler
async function saveStep() {
  const form = document.getElementById("grantForm");
  const formData = new FormData(form);

  // Remove any File blobs so multer doesn’t choke
  document.querySelectorAll('input[type="file"]').forEach((input) => {
    if (formData.has(input.name)) {
      formData.delete(input.name);
    }
  });

  // Append only S3 keys
  document.querySelectorAll('input[type="file"]').forEach((input) => {
    const key = input.dataset.s3key;
    if (key) formData.append(input.name, key);
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
    if (json.token) localStorage.setItem("draftToken", json.token);
    showToast("Draft saved.");
  } catch (err) {
    console.error(err);
    showToast("Error saving draft.");
  }
}

// File upload wiring
document.querySelectorAll('input[type="file"]').forEach((input) => {
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
        )}&type=${encodeURIComponent(mime)}&token=${encodeURIComponent(token)}`
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

// Final submit
document.getElementById("grantForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!validateStep(currentStep)) return;

  const form = e.target;
  const formData = new FormData(form);

  // Strip blobs, append only keys
  document.querySelectorAll('input[type="file"]').forEach((input) => {
    if (formData.has(input.name)) formData.delete(input.name);
    const key = input.dataset.s3key;
    if (key) formData.append(input.name, key);
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
      console.error("Submit failed:", await res.text());
      showToast("Submission failed.");
    }
  } catch (err) {
    console.error(err);
    showToast("Submission failed.");
  }
});
