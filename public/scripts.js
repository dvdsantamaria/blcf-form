// public/scripts.js

const API_BASE = "/api";
const isReader = new URLSearchParams(location.search).get("mode") === "reader";

let currentStep = 0;
const steps = document.querySelectorAll(".step");
const submitBtn = document.getElementById("submitBtn");
const saveBtn = document.getElementById("saveDraftBtn");
const grantForm = document.getElementById("grantForm");

// -------------------- OPCIONALES (los ÚNICOS 6) --------------------
const OPTIONAL_FIELDS = new Set([
  "ndis.notEligibleReason",
  "ndis.moreSupportWhy",
  // Todo Parent/Carer 2:
  "parent2.relationshipToChild",
  "parent2.firstName",
  "parent2.lastName",
  "parent2.mobile",
  "parent2.email",
  "parent2.employmentStatus",
  "parent2.occupation",
  "parent2.centrelinkPayments",
  "parent2.livingArrangements",
  "parent2.relationshipToParent1",
  // Adicionales:
  "dependents.ages",
  "dependents.withDisabilityCount",
  "otherConditions.details",
]);

// -------------------- REQUERIDOS POR PASO --------------------
// Paso 0: Parent/Carer 1 + How did you hear about us?
const STEP_REQUIRED = {
  0: [
    "referral.source",
    "parent1.relationshipToChild",
    "parent1.financialResponsible", // checkbox: debe estar tildado
    "parent1.firstName",
    "parent1.lastName",
    "parent1.mobile",
    "parent1.email",
    "parent1.employmentStatus",
    "parent1.occupation",
    "parent1.centrelinkPayments",
    "parent1.livingArrangements",
  ],
  // Paso 1: Child's Details
  1: [
    "child.firstName",
    "child.lastName",
    "child.dob",
    "child.age",
    "child.gender",
    "child.phone",
    "child.streetNumber",
    "child.suburb",
    "child.state",
    "child.postcode",
    // refugee / indigenous son checkboxes; si querés que no sean forzados, comentá las dos siguientes líneas:
    "child.refugee",
    "child.indigenous",
    "child.mainLanguage",
    "child.diagnosis",
    "child.impactDailyLife",
    "child.currentSupports",
    "child.impactFamily",
    "child.currentTherapies",
  ],
  // Paso 2: NDIS and Therapy
  2: [
    "ndis.participantEligible",
    // opcional: "ndis.notEligibleReason",
    "docs.ndisCommunication", // archivo requerido
    // opcional: "ndis.moreSupportWhy",
    "docs.supportLetterHealthProfessional", // archivo requerido
    "therapy.toBeFunded",
    "therapy.frequencyOrEquipment",
    "therapy.goals",
    "therapy.noGrantImpact",
    "docs.diagnosisLetter", // archivo requerido
    "docs.additionalLetterOptional", // -> OJO: tu consigna dijo "resto son obligatorios". Si querés que NO sea requerido, quitá esta línea.
  ],
  // Paso 3: Household & Additional Details (Parent/Carer 2 todo opcional)
  3: [
    "household.sameHousehold",
    "dependents.countUnder18",
    // opcionales:
    // "dependents.ages",
    // "dependents.withDisabilityCount",
    // "otherConditions.details",
  ],
  // Paso 4: Consent (mailUpdates es opcional)
  4: ["consent.terms", "consent.truth", "consent.report", "consent.media"],
};

// Requisitos mínimos para guardar borrador
const DRAFT_MIN_REQUIRED = [
  "parent1.firstName",
  "parent1.mobile",
  "parent1.email",
];

// -------------------- Utils --------------------
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

function readableName(name) {
  const map = {
    "referral.source": "How did you hear about us",
    // Parent/Carer 1
    "parent1.relationshipToChild": "Relationship to the child",
    "parent1.financialResponsible": "Financially responsible for the child",
    "parent1.firstName": "Parent/Carer 1 first name",
    "parent1.lastName": "Parent/Carer 1 last name",
    "parent1.mobile": "Parent/Carer 1 mobile",
    "parent1.email": "Parent/Carer 1 email",
    "parent1.employmentStatus": "Employment status",
    "parent1.occupation": "Occupation",
    "parent1.centrelinkPayments": "Receiving Centrelink payments",
    "parent1.livingArrangements": "Current living arrangements",

    // Child
    "child.firstName": "Child first name",
    "child.lastName": "Child last name",
    "child.dob": "Date of birth",
    "child.age": "Age",
    "child.gender": "Gender",
    "child.phone": "Child phone number",
    "child.streetNumber": "Street and number",
    "child.suburb": "Suburb",
    "child.state": "State",
    "child.postcode": "Postcode",
    "child.refugee": "Is the child a refugee?",
    "child.indigenous": "Aboriginal or Torres Strait Islander heritage",
    "child.mainLanguage": "Main language spoken at home",
    "child.diagnosis": "Diagnosis or condition",
    "child.impactDailyLife": "Impact on daily life",
    "child.currentSupports": "Current supports",
    "child.impactFamily": "Impact on family",
    "child.currentTherapies": "Current therapies",

    // NDIS & Therapy
    "ndis.participantEligible": "NDIS participant or eligible",
    "ndis.notEligibleReason": "If NO, why not?",
    "docs.ndisCommunication": "NDIS communication (file)",
    "ndis.moreSupportWhy": "If YES but more support is needed, why?",
    "docs.supportLetterHealthProfessional":
      "Support letter (health professional) (file)",
    "therapy.toBeFunded": "Therapy/therapies to be funded",
    "therapy.frequencyOrEquipment": "Therapy frequency or equipment required",
    "therapy.goals": "Child's therapy goals",
    "therapy.noGrantImpact": "Impact if grant is not received",
    "docs.diagnosisLetter": "Diagnosis letter (file)",
    "docs.additionalLetterOptional": "Additional letter (file)",

    // Household & additional
    "household.sameHousehold":
      "Do both parents/carers live in the same household?",
    "dependents.countUnder18": "Number of dependents under 18",
    "dependents.ages": "Ages of dependents",
    "dependents.withDisabilityCount": "How many with disability?",
    "otherConditions.details": "Details of other conditions/disabilities",

    // Consent
    "consent.mailUpdates": "Receive news updates",
    "consent.terms": "I agree to the privacy policy and terms",
    "consent.truth": "I declare the information is correct",
    "consent.report": "I agree to complete the final survey/report",
    "consent.media": "I give permission for image use",
  };
  return map[name] || name;
}

function isCheckbox(name) {
  const el = document.querySelector(`[name="${name}"]`);
  return el && el.type === "checkbox";
}
function isFile(name) {
  const el = document.querySelector(`[name="${name}"]`);
  return el && el.type === "file";
}
function elFor(name) {
  return document.querySelector(`[name="${name}"]`);
}

// Añadir indicador visual (required / optional)
(function decorateLabels() {
  // Primero, marcar opcionales
  OPTIONAL_FIELDS.forEach((name) => {
    const el = elFor(name);
    if (!el) return;
    let label =
      el.previousElementSibling?.tagName === "LABEL"
        ? el.previousElementSibling
        : null;
    if (!label && el.id)
      label = document.querySelector(`label[for="${el.id}"]`);
    if (label && !/\(optional\)/i.test(label.textContent)) {
      label.innerHTML = `${label.innerHTML} <span class="text-muted">(optional)</span>`;
    }
  });

  // Luego, marcar requeridos por paso con asterisco
  Object.keys(STEP_REQUIRED).forEach((k) => {
    STEP_REQUIRED[k].forEach((name) => {
      if (OPTIONAL_FIELDS.has(name)) return; // por si acaso
      const el = elFor(name);
      if (!el) return;
      let label =
        el.previousElementSibling?.tagName === "LABEL"
          ? el.previousElementSibling
          : null;
      if (!label && el.id)
        label = document.querySelector(`label[for="${el.id}"]`);
      if (label && !/\*\s*$/.test(label.textContent)) {
        label.innerHTML = `${label.innerHTML} <span class="text-danger">*</span>`;
      }
    });
  });
})();

// -------------------- Modo reader --------------------
if (isReader) {
  if (submitBtn) submitBtn.style.display = "none";
  if (saveBtn) saveBtn.style.display = "none";
  document.querySelectorAll("input, textarea, select").forEach((el) => {
    el.disabled = true;
  });
}

// -------------------- Age desde DOB --------------------
function calcAgeYears(dobStr) {
  const d = dobStr ? new Date(dobStr) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  const today = new Date();
  let years = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) years--;
  return years >= 0 ? String(years) : "";
}
(function wireAgeAutofill() {
  const dobEl = document.querySelector('[name="child.dob"]');
  const ageEl = document.querySelector('[name="child.age"]');
  if (!dobEl || !ageEl) return;
  function updateAge() {
    const years = calcAgeYears(dobEl.value);
    ageEl.placeholder = years || "";
    ageEl.value = years || "";
  }
  dobEl.addEventListener("change", updateAge);
  dobEl.addEventListener("input", updateAge);
  updateAge();
})();

// -------------------- Validación --------------------
function validateStep(idx) {
  const required = STEP_REQUIRED[idx] || [];
  const container = steps[idx];
  clearInvalid(container);

  const missing = [];
  let firstInvalid = null;

  required.forEach((name) => {
    // Si por diseño marcaste algún requerido que sea opcional, lo saltamos
    if (OPTIONAL_FIELDS.has(name)) return;
    const el = elFor(name);
    if (!el) return;

    // Checkboxes
    if (isCheckbox(name)) {
      const checked = el.checked;
      if (!checked) {
        missing.push(readableName(name));
        markInvalid(el);
        firstInvalid ||= el;
      }
      return;
    }

    // Archivos
    if (isFile(name)) {
      if (!el.dataset.s3key) {
        missing.push(readableName(name));
        markInvalid(el);
        firstInvalid ||= el;
      }
      return;
    }

    // Email
    if (name === "parent1.email") {
      if (!isEmail((el.value || "").trim())) {
        missing.push(readableName(name));
        markInvalid(el);
        firstInvalid ||= el;
      }
      return;
    }

    // General
    const val = (el.value || "").trim();
    if (!val) {
      missing.push(readableName(name));
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

function validateAllBeforeSubmit() {
  for (let i = 0; i < steps.length - 1; i++) {
    if (!validateStep(i)) {
      currentStep = i;
      showStep(currentStep);
      return false;
    }
  }
  return true;
}

// -------------------- Navegación --------------------
function showStep(n) {
  steps.forEach((s, i) => s.classList.toggle("active", i === n));

  const prevBtn = document.querySelector('button[onclick="nextStep(-1)"]');
  const nextBtn = document.querySelector('button[onclick="nextStep(1)"]');

  if (prevBtn)
    prevBtn.style.display =
      n === 0 || n === steps.length - 1 ? "none" : "inline-block";
  if (nextBtn)
    nextBtn.style.display = n >= steps.length - 2 ? "none" : "inline-block";

  if (submitBtn)
    submitBtn.style.display =
      n === steps.length - 2 && !isReader ? "inline-block" : "none";
  if (saveBtn)
    saveBtn.style.display =
      n < steps.length - 2 && !isReader ? "inline-block" : "none";
}

function nextStep(n) {
  // En reader no validamos al avanzar, pero sí navegamos
  if (!isReader && n === 1 && !validateStep(currentStep)) return;
  currentStep += n;
  if (currentStep >= 0 && currentStep < steps.length) showStep(currentStep);
}
showStep(currentStep);

// Bloquear submit en reader
if (grantForm) {
  grantForm.addEventListener("submit", (e) => {
    if (isReader) {
      e.preventDefault();
      showToast("Viewing only.");
    }
  });
}

// -------------------- Carga de datos en modo reader --------------------
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
      const input = elFor(name);
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

    // Recalcular Age si vino DOB
    const dobEl = elFor("child.dob");
    const ageEl = elFor("child.age");
    if (dobEl && ageEl) {
      const years = calcAgeYears(dobEl.value);
      ageEl.placeholder = years || "";
      ageEl.value = years || "";
    }

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

// -------------------- Modo edición --------------------
if (!isReader) {
  // ensureToken para uploads/primer guardado
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

  // Validación mínima para guardar draft
  function validateDraftMin() {
    const missing = [];
    let firstInvalid = null;
    DRAFT_MIN_REQUIRED.forEach((name) => {
      const el = elFor(name);
      if (!el) return;
      let ok = (el.value || "").trim().length > 0;
      if (name === "parent1.email") ok = isEmail((el.value || "").trim());
      if (!ok) {
        missing.push(readableName(name));
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

  // Upload de archivos (presigned URL)
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

  // Guardado de borrador
  window.saveStep = async function saveStep() {
    clearAllInvalid();
    if (!validateDraftMin()) return;

    const formData = new FormData(grantForm);
    document.querySelectorAll('input[type="file"]').forEach((input) => {
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
      const tokenFromResp = json.token || existingToken || "";
      if (json.token) localStorage.setItem("draftToken", json.token);

      // Enviar link para retomar (una vez por token)
      const emailEl = elFor("parent1.email");
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

  // Submit final
  if (grantForm) {
    grantForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!validateAllBeforeSubmit()) return;

      const formData = new FormData(grantForm);
      document.querySelectorAll('input[type="file"]').forEach((input) => {
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
  // En reader no se guarda
  window.saveStep = function () {};
}

// -------------------- Navegación inicial --------------------
showStep(currentStep);

// Helper dev
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
