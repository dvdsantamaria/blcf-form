// public/scripts.js

const API_BASE = "/api";
const isReader = new URLSearchParams(location.search).get("mode") === "reader";

let currentStep = 0;
const steps = document.querySelectorAll(".step");
const submitBtn = document.getElementById("submitBtn");
const saveBtn = document.getElementById("saveDraftBtn");
const grantForm = document.getElementById("grantForm");

// Disable inputs in reader mode and hide action buttons
if (isReader) {
  if (submitBtn) submitBtn.style.display = "none";
  if (saveBtn) saveBtn.style.display = "none";
  document.querySelectorAll("input, textarea, select").forEach((el) => {
    el.disabled = true;
  });
}

// Human-readable labels
const LABEL = {
  "referral.source": "How did you hear about us",
  // Step 1 – Parent/Carer 1
  "parent1.firstName": "Parent/Carer 1 first name",
  "parent1.lastName": "Parent/Carer 1 last name",
  "parent1.email": "Parent/Carer 1 email",
  "parent1.mobile": "Parent/Carer 1 mobile",
  // Step 2 – Child
  "child.firstName": "Child first name",
  "child.lastName": "Child last name",
  "child.dob": "Child date of birth",
  // Step 3 – Therapy
  "therapy.toBeFunded": "Therapy to be funded",
  // Step 5 – Consents
  "consent.terms": "Agree to privacy & terms",
  "consent.truth": "Declaration is true",
};

// Validation rules per step (indices 0..4; 5 = Thank you)
const STEP_RULES = {
  0: { required: ["parent1.firstName", "parent1.lastName", "parent1.email"] },
  1: { required: ["child.firstName", "child.lastName", "child.dob"] },
  2: { required: ["therapy.toBeFunded"] },
  3: {},
  4: { requiredChecks: ["consent.terms", "consent.truth"] },
};

// Minimal fields required to allow saving a draft
const DRAFT_MIN_REQUIRED = [
  "parent1.firstName",
  "parent1.mobile",
  "parent1.email",
];

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
function clearAllInvalid() {
  document.querySelectorAll(".is-invalid").forEach((el) => {
    el.classList.remove("is-invalid");
    el.removeAttribute("aria-invalid");
  });
}
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

function fieldValueOk(name) {
  const el = document.querySelector(`[name="${name}"]`);
  if (!el) return true; // if the field isn't present, don't block
  if (el.type === "checkbox") return el.checked;
  const val = (el.value || "").trim();
  if (name === "parent1.email") return isEmail(val);
  return val.length > 0;
}

// Validate current step only (for "Next")
function validateStep(idx) {
  const rules = STEP_RULES[idx] || {};
  const container = steps[idx];
  clearInvalid(container);

  const missing = [];
  let firstInvalid = null;

  (rules.required || []).forEach((name) => {
    const el = container.querySelector(`[name="${name}"]`);
    if (!el) return;
    const ok =
      name === "parent1.email"
        ? isEmail((el.value || "").trim())
        : (el.value || "").trim().length > 0;
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

// Validate ALL required fields across the form (for final Submit)
function validateAll() {
  clearAllInvalid();
  for (let i = 0; i <= 4; i++) {
    const rules = STEP_RULES[i] || {};
    const container = steps[i];
    const missing = [];
    let firstInvalid = null;

    (rules.required || []).forEach((name) => {
      const el = document.querySelector(`[name="${name}"]`);
      if (!el) return;
      const ok =
        name === "parent1.email"
          ? isEmail((el.value || "").trim())
          : (el.value || "").trim().length > 0;
      if (!ok) {
        missing.push(LABEL[name] || name);
        markInvalid(el);
        firstInvalid ||= el;
      }
    });

    (rules.requiredChecks || []).forEach((name) => {
      const el = document.querySelector(`[name="${name}"]`);
      if (el && !el.checked) {
        missing.push(LABEL[name] || name);
        markInvalid(el);
        firstInvalid ||= el;
      }
    });

    if (missing.length) {
      // Jump to the step that has missing fields
      currentStep = i;
      showStep(currentStep);
      showToast(`Please complete: ${missing.join(", ")}.`);
      firstInvalid?.scrollIntoView({ behavior: "smooth", block: "center" });
      firstInvalid?.focus();
      return false;
    }
  }
  return true;
}

// Step navigation
function showStep(n) {
  steps.forEach((s, i) => s.classList.toggle("active", i === n));
  const prevBtn = document.querySelector('button[onclick="nextStep(-1)"]');
  const nextBtn = document.querySelector('button[onclick="nextStep(1)"]');

  if (prevBtn)
    prevBtn.style.display =
      n === 0 || n === steps.length - 1 ? "none" : "inline-block";
  if (nextBtn)
    nextBtn.style.display = n >= steps.length - 2 ? "none" : "inline-block";

  // Show Submit only on the penultimate step (consents)
  if (submitBtn)
    submitBtn.style.display =
      n === steps.length - 2 && !isReader ? "inline-block" : "none";

  // Show Save on all steps EXCEPT the submit step and the final thank-you
  if (saveBtn)
    saveBtn.style.display =
      n < steps.length - 2 && !isReader ? "inline-block" : "none";
}

function nextStep(n) {
  if (!isReader && n === 1 && !validateStep(currentStep)) return;
  currentStep += n;
  if (currentStep >= 0 && currentStep < steps.length) showStep(currentStep);
}
showStep(currentStep);

// Prevent submit in reader mode
if (grantForm) {
  grantForm.addEventListener("submit", (e) => {
    if (isReader) {
      e.preventDefault();
      showToast("Viewing only.");
    }
  });
}

// Single load for READER MODE (no duplicate calls)
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
    const data = payload?.data || {};

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

// --------------- Editing mode only ---------------
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

  // Minimal validation for draft save
  function validateDraftMin() {
    const missing = [];
    let firstInvalid = null;

    DRAFT_MIN_REQUIRED.forEach((name) => {
      const el = document.querySelector(`[name="${name}"]`);
      if (!el) return;
      let ok = (el.value || "").trim().length > 0;
      if (name === "parent1.email") ok = isEmail((el.value || "").trim());
      if (!ok) {
        missing.push(LABEL[name] || name);
        markInvalid(el);
        firstInvalid ||= el;
      }
    });

    if (missing.length) {
      showToast(`Please complete: ${missing.join(", ")} to save your draft.`);
      firstInvalid?.scrollIntoView({ behavior: "smooth", block: "center" });
      firstInvalid?.focus();
      return false;
    }
    return true;
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

  // Expose saveStep globally (button onclick)
  window.saveStep = async function saveStep() {
    clearAllInvalid();
    if (!validateDraftMin()) return;

    const form = document.getElementById("grantForm");
    const formData = new FormData(form);

    // Strip file blobs, send only S3 keys
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
      if (!resp.ok) throw new Error(`save-draft ${resp.status}`);
      const json = await resp.json();

      // Persist token
      const tokenFromResp =
        json.token || localStorage.getItem("draftToken") || existingToken || "";
      if (json.token) localStorage.setItem("draftToken", json.token);

      // Send resume link once per token (if we have email)
      const emailEl = document.querySelector('[name="parent1.email"]');
      const email = emailEl?.value?.trim();
      const token = tokenFromResp;
      const sentKey = token ? `resumeSent:${token}` : null;

      if (
        email &&
        isEmail(email) &&
        token &&
        (!sentKey || !localStorage.getItem(sentKey))
      ) {
        try {
          const r = await fetch(`${API_BASE}/resume/send-link`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token, email }),
          });
          if (r.ok && sentKey) localStorage.setItem(sentKey, "1");
        } catch (e) {
          console.error("send-link error:", e);
        }
      }

      showToast("Draft saved.");
    } catch (err) {
      console.error(err);
      showToast("Error saving draft.");
    }
  };

  // Final submit
  if (grantForm) {
    grantForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      // Validate the whole form (all required rules)
      if (!validateAll()) return;

      const formData = new FormData(grantForm);

      // Strip blobs, append only S3 keys
      document.querySelectorAll("input[type='file']").forEach((input) => {
        if (formData.has(input.name)) formData.delete(input.name);
        if (input.dataset.s3key)
          formData.append(input.name, input.dataset.s3key);
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
          currentStep = steps.length - 1; // Thank you
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
} else {
  // No-op to avoid errors if someone triggers saveStep in reader
  window.saveStep = function () {};
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
