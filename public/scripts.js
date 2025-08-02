// public/scripts.js

const API_BASE = "/api";
const isReader = new URLSearchParams(location.search).get("mode") === "reader";

let currentStep = 0;
const steps = document.querySelectorAll(".step");
const submitBtn = document.getElementById("submitBtn");
const saveBtn = document.getElementById("saveDraftBtn");
const grantForm = document.getElementById("grantForm");

// ---------- Opcionales (únicos) ----------
const OPTIONAL_FIELDS = new Set([
  "ndis.notEligibleReason",
  "ndis.moreSupportWhy",
  // Todo Parent/Carer 2
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
  // Adicionales
  "dependents.ages",
  "dependents.withDisabilityCount",
  "otherConditions.details",
]);

// Checkboxes de consentimiento requeridos
const CONSENT_REQUIRED_CHECKS = new Set([
  "consent.terms",
  "consent.truth",
  "consent.report",
  "consent.media",
]);

// Archivos requeridos (no listados como opcionales)
const REQUIRED_FILE_FIELDS = new Set([
  "docs.ndisCommunication",
  "docs.supportLetterHealthProfessional",
  "docs.diagnosisLetter",
  "docs.additionalLetterOptional", // OJO: pedido explícito de que SOLO 6 sean opcionales
]);

// Requisitos mínimos para guardar borrador:
const DRAFT_MIN_REQUIRED = [
  "parent1.firstName",
  "parent1.mobile",
  "parent1.email",
];

// ---------- Utilidades ----------
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

// Añadir “(optional)” a labels de campos opcionales
(function annotateOptionalLabels() {
  OPTIONAL_FIELDS.forEach((name) => {
    const el = document.querySelector(`[name="${name}"]`);
    if (!el) return;

    // Caso 1: hay label inmediatamente antes
    let label =
      el.previousElementSibling && el.previousElementSibling.tagName === "LABEL"
        ? el.previousElementSibling
        : null;

    // Caso 2: hay label con atributo for (menos frecuente en este HTML)
    if (!label && el.id) {
      const byFor = document.querySelector(`label[for="${el.id}"]`);
      if (byFor) label = byFor;
    }

    // Si no hay label, insertamos un pequeño texto al lado
    if (label) {
      if (!/optional\)/i.test(label.textContent)) {
        label.innerHTML = `${label.innerHTML} <span class="text-muted">(optional)</span>`;
      }
    } else {
      const small = document.createElement("small");
      small.className = "text-muted ms-1";
      small.textContent = "(optional)";
      el.insertAdjacentElement("afterend", small);
    }
  });
})();

// Desactivar edición en modo reader
if (isReader) {
  if (submitBtn) submitBtn.style.display = "none";
  if (saveBtn) saveBtn.style.display = "none";
  document.querySelectorAll("input, textarea, select").forEach((el) => {
    el.disabled = true;
  });
}

// ---------- Cálculo automático de Age ----------
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
    if (years !== "") {
      ageEl.placeholder = years;
      // Completar valor para cumplir requisito
      ageEl.value = years;
    } else {
      ageEl.placeholder = "";
      // no sobreescribimos valor si el usuario puso algo
      if (!ageEl.value) ageEl.value = "";
    }
  }

  dobEl.addEventListener("change", updateAge);
  dobEl.addEventListener("input", updateAge);

  // Inicial si ya hay DOB seteado
  updateAge();
})();

// ---------- Validación dinámica ----------
function isRequiredField(elName) {
  if (!elName) return false;
  // Excluir opcionales
  if (OPTIONAL_FIELDS.has(elName)) return false;

  // Checkboxes no-consent no se exigen
  const checkbox = document.querySelector(`[name="${elName}"]`);
  if (checkbox && checkbox.type === "checkbox") {
    return CONSENT_REQUIRED_CHECKS.has(elName);
  }

  // Archivos: sólo los listados en REQUIRED_FILE_FIELDS
  if (REQUIRED_FILE_FIELDS.has(elName)) return true;

  // Por defecto, requerido
  return true;
}

function validateContainer(container) {
  clearInvalid(container);
  const missing = [];
  let firstInvalid = null;

  const fields = container.querySelectorAll("input, select, textarea");
  fields.forEach((el) => {
    if (el.disabled) return;
    const name = el.name;
    if (!name) return;

    // Botones fuera
    if (el.type === "button" || el.type === "submit") return;

    const required = isRequiredField(name);
    if (!required) return;

    // Validación según tipo
    if (el.type === "checkbox") {
      // Sólo consents
      if (!el.checked) {
        missing.push(readableName(name));
        markInvalid(el);
        firstInvalid ||= el;
      }
      return;
    }

    if (el.type === "file") {
      // Validamos por dataset.s3key
      if (!el.dataset.s3key) {
        missing.push(readableName(name));
        markInvalid(el);
        firstInvalid ||= el;
      }
      return;
    }

    let val = (el.value || "").trim();

    if (name === "parent1.email") {
      if (!isEmail(val)) {
        missing.push("Parent/Carer 1 email");
        markInvalid(el);
        firstInvalid ||= el;
      }
      return;
    }

    if (!val) {
      missing.push(readableName(name));
      markInvalid(el);
      firstInvalid ||= el;
    }
  });

  return { ok: missing.length === 0, missing, firstInvalid };
}

function readableName(name) {
  // Etiquetas mínimas amigables; para el resto usamos el name
  const map = {
    "referral.source": "How did you hear about us",
    "parent1.firstName": "Parent/Carer 1 first name",
    "parent1.lastName": "Parent/Carer 1 last name",
    "parent1.mobile": "Parent/Carer 1 mobile",
    "parent1.email": "Parent/Carer 1 email",
    "child.firstName": "Child first name",
    "child.lastName": "Child last name",
    "child.dob": "Date of birth",
    "child.age": "Age",
    "child.gender": "Gender",
    "child.phone": "Child phone",
    "child.streetNumber": "Street and number",
    "child.suburb": "Suburb",
    "child.state": "State",
    "child.postcode": "Postcode",
    "ndis.participantEligible": "NDIS participant or eligible",
    "docs.ndisCommunication": "NDIS communication",
    "docs.supportLetterHealthProfessional":
      "Support letter (health professional)",
    "therapy.toBeFunded": "Therapy to be funded",
    "therapy.frequencyOrEquipment": "Therapy frequency / equipment",
    "therapy.goals": "Therapy goals",
    "therapy.noGrantImpact": "Impact if grant not received",
    "docs.diagnosisLetter": "Diagnosis letter",
    "docs.additionalLetterOptional": "Additional letter",
    "household.sameHousehold":
      "Do both parents/carers live in the same household?",
    "dependents.countUnder18": "Number of dependents under 18",
    "consent.terms": "Agree to privacy & terms",
    "consent.truth": "Declaration is true",
    "consent.report": "Agree to complete the final survey/report",
    "consent.media": "Permission for image use",
  };
  return map[name] || name;
}

// Validación por paso (para “Next”)
function validateStep(idx) {
  const container = steps[idx];
  const { ok, missing, firstInvalid } = validateContainer(container);
  if (!ok) {
    showToast(`Please complete: ${missing.join(", ")}.`);
    firstInvalid?.scrollIntoView({ behavior: "smooth", block: "center" });
    firstInvalid?.focus();
  }
  return ok;
}

// Validación global para Submit
function validateAll() {
  clearAllInvalid();
  for (let i = 0; i < steps.length - 1; i++) {
    const { ok, missing, firstInvalid } = validateContainer(steps[i]);
    if (!ok) {
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

// ---------- Navegación de pasos ----------
function showStep(n) {
  steps.forEach((s, i) => s.classList.toggle("active", i === n));
  const prevBtn = document.querySelector('button[onclick="nextStep(-1)"]');
  const nextBtn = document.querySelector('button[onclick="nextStep(1)"]');

  if (prevBtn)
    prevBtn.style.display =
      n === 0 || n === steps.length - 1 ? "none" : "inline-block";
  if (nextBtn)
    nextBtn.style.display = n >= steps.length - 2 ? "none" : "inline-block";

  // Submit sólo en la pantalla de consentimientos (penúltima)
  if (submitBtn)
    submitBtn.style.display =
      n === steps.length - 2 && !isReader ? "inline-block" : "none";

  // Save en todas menos la de consents y la final
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

// Evitar submit en reader
if (grantForm) {
  grantForm.addEventListener("submit", (e) => {
    if (isReader) {
      e.preventDefault();
      showToast("Viewing only.");
    }
  });
}

// ---------- Carga modo reader (una sola vez) ----------
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

    // Recalcular Age por si viene DOB
    const dobEl = document.querySelector('[name="child.dob"]');
    const ageEl = document.querySelector('[name="child.age"]');
    if (dobEl && ageEl) {
      const years = calcAgeYears(dobEl.value);
      if (years !== "") {
        ageEl.placeholder = years;
        ageEl.value = years;
      }
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

// ---------- Modo edición ----------
if (!isReader) {
  // Asegurar token en primer guardado
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

  // Validación mínima de borrador
  function validateDraftMin() {
    const missing = [];
    let firstInvalid = null;

    DRAFT_MIN_REQUIRED.forEach((name) => {
      const el = document.querySelector(`[name="${name}"]`);
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

  // Subida de archivos (pre-signed S3)
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

  // Guardar borrador
  window.saveStep = async function saveStep() {
    clearAllInvalid();
    if (!validateDraftMin()) return;

    const formData = new FormData(grantForm);

    // Enviar sólo claves S3
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

      const tokenFromResp = json.token || existingToken || "";
      if (json.token) localStorage.setItem("draftToken", json.token);

      // Enviar link de reanudación una sola vez por token si hay email
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

  // Submit final
  if (grantForm) {
    grantForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!validateAll()) return;

      const formData = new FormData(grantForm);

      // Adjuntar sólo claves S3
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
  // No-op si alguien dispara saveStep en modo reader
  window.saveStep = function () {};
}

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
