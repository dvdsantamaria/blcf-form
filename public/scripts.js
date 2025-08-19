// public/scripts.js (refactor Aug-2025)
// All logic in one IIFE. Comments concise, English, no fancy punctuation.

(() => {
  "use strict";

  /* -------------------- Globals -------------------- */
  const API_BASE = "/api";
  const isReader =
    new URLSearchParams(location.search).get("mode") === "reader";

  let currentStep = 0;
  const steps = document.querySelectorAll(".step");
  const submitBtn = document.getElementById("submitBtn");
  const saveBtn = document.getElementById("saveDraftBtn");
  const grantForm = document.getElementById("grantForm");

  /* -------------------- Optional fields -------------------- */
const OPTIONAL_FIELDS = new Set([
  "docs.diagnosisLetter",
  "docs.additionalLetterOptional",
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
  "dependents.ages",
  "dependents.withDisabilityCount",
  "otherConditions.details",
]);

  /* -------------------- Required fields by step -------------------- */
  const STEP_REQUIRED = {
    0: [
      "referral.source",
      "parent1.relationshipToChild",
      "parent1.firstName",
      "parent1.lastName",
      "parent1.mobile",
      "parent1.email",
      "parent1.employmentStatus",
      "parent1.occupation",
      "parent1.centrelinkPayments",
      "parent1.livingArrangements",
    ],
    1: [
      "child.firstName",
      "child.lastName",
      "child.dob",
      "child.age",
      "child.gender",
      "child.streetNumber",
      "child.suburb",
      "child.state",
      "child.postcode",
      "child.mainLanguage",
      "child.diagnosis",
      "child.impactDailyLife",
      "child.currentSupports",
      "child.impactFamily",
      "child.currentTherapies",
    ],
    2: [
      // dynamic requirements are added in validateStep for this step
      "ndis.participantEligible",
      "therapy.toBeFunded",
      "therapy.frequencyOrEquipment",
      "therapy.noGrantImpact",
    ],
    3: ["household.sameHousehold", "dependents.countUnder18"],
    4: ["consent.terms", "consent.truth", "consent.report", "consent.media"],
  };

  const DRAFT_MIN_REQUIRED = [
    "parent1.firstName",
    "parent1.mobile",
    "parent1.email",
  ];

  /* -------------------- Helpers -------------------- */
  const isEmail = (v) => !!v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

  function showToast(msg) {
    let node = document.getElementById("toast");
    if (!node) {
      node = document.createElement("div");
      node.id = "toast";
      node.setAttribute("role", "status");
      node.setAttribute("aria-live", "polite");
      Object.assign(node.style, {
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
      document.body.appendChild(node);
    }
    node.textContent = msg;
    node.style.opacity = "1";
    clearTimeout(node._h);
    node._h = setTimeout(() => (node.style.opacity = "0"), 3000);
  }

  const clearAllInvalid = () =>
    document.querySelectorAll(".is-invalid").forEach((el) => {
      el.classList.remove("is-invalid");
      el.removeAttribute("aria-invalid");
    });

  const clearInvalid = (container) =>
    container.querySelectorAll(".is-invalid").forEach((el) => {
      el.classList.remove("is-invalid");
      el.removeAttribute("aria-invalid");
    });

  const markInvalid = (el) => {
    el.classList.add("is-invalid");
    el.setAttribute("aria-invalid", "true");
    const remove = () => el.classList.remove("is-invalid");
    el.addEventListener("input", remove, { once: true });
    el.addEventListener("change", remove, { once: true });
  };

  const readableName = (name) => {
    const map = {
      "referral.source": "How did you hear about us",
      "parent1.relationshipToChild": "Relationship to the child",
      "parent1.firstName": "Parent one first name",
      "parent1.lastName": "Parent one last name",
      "parent1.mobile": "Parent one mobile",
      "parent1.email": "Parent one email",
      "parent1.employmentStatus": "Employment status",
      "parent1.occupation": "Occupation",
      "parent1.centrelinkPayments": "Centrelink payments",
      "parent1.livingArrangements": "Living arrangements",
      "child.firstName": "Child first name",
      "child.lastName": "Child last name",
      "child.dob": "Date of birth",
      "child.age": "Age",
      "child.gender": "Gender",
      "child.streetNumber": "Street and number",
      "child.suburb": "Suburb",
      "child.state": "State",
      "child.postcode": "Postcode",
      "child.mainLanguage": "Main language",
      "child.diagnosis": "Diagnosis",
      "child.impactDailyLife": "Impact daily life",
      "child.currentSupports": "Current supports",
      "child.impactFamily": "Impact family",
      "child.currentTherapies": "Current therapies",
      "ndis.participantEligible": "NDIS participant or eligible",
      "docs.ndisPlanOrGoals": "Ndis plan or goals",
      "therapy.goals": "Child’s therapy goals",
      "ndis.notEligibleReason": "Reason not eligible",
      "therapy.toBeFunded": "Therapies to be funded",
      "therapy.frequencyOrEquipment": "Therapy frequency or equipment",
      "therapy.noGrantImpact": "Impact if no grant",
      "docs.diagnosisLetter": "Diagnosis letter",
      "docs.additionalLetterOptional": "Additional documentation",
      "consent.terms": "Privacy and terms",
      "consent.truth": "Information correct",
      "consent.report": "Final report",
      "consent.media": "Image permission",
    };
    return map[name] || name;
  };

  /* -------------------- Label decoration -------------------- */
const elFor = (name) => document.querySelector(`[name="${name}"]`);

(function decorateLabels() {
  OPTIONAL_FIELDS.forEach((name) => {
    const el = elFor(name);
    if (!el) return;
    let label =
      el.previousElementSibling?.tagName === "LABEL"
        ? el.previousElementSibling
        : null;
    if (!label && el.id) label = document.querySelector(`label[for="${el.id}"]`);
    if (label && !/(optional)/i.test(label.textContent))
      label.innerHTML = `${label.innerHTML} <span class="text-muted">(optional)</span>`;
  });

  Object.keys(STEP_REQUIRED).forEach((k) => {
    STEP_REQUIRED[k].forEach((name) => {
      if (OPTIONAL_FIELDS.has(name)) return;
      const el = elFor(name);
      if (!el) return;
      let label =
        el.previousElementSibling?.tagName === "LABEL"
          ? el.previousElementSibling
          : null;
      if (!label && el.id) label = document.querySelector(`label[for="${el.id}"]`);
      if (label && !/\*\s*$/.test(label.textContent))
        label.innerHTML = `${label.innerHTML} <span class="text-danger">*</span>`;
    });
  });

  // --- Fix: asegurar que el label de "If NO, why not?" NO muestre "(optional)"
  (function fixNotEligibleLabel() {
    const el = elFor("ndis.notEligibleReason");
    if (!el) return;
    let label =
      el.previousElementSibling?.tagName === "LABEL"
        ? el.previousElementSibling
        : (el.id ? document.querySelector(`label[for="${el.id}"]`) : null);
    if (!label) return;
    label.innerHTML = label.innerHTML.replace(/\s*\(optional\)\s*/i, "");
    })();
})();

/* -------------------- NDIS show/hide -------------------- */
function initNdisToggle() {
  const ndisSelect = document.getElementById("ndisEligible");
  if (!ndisSelect) return;

  const apply = () => {
    const val = (ndisSelect.value || "").trim();
    const showYes = val === "Yes";
    const showNo  = val === "No";

    // Importante: usar "block" para sobreescribir el CSS .yes-only/.no-only { display:none }
    document.querySelectorAll(".yes-only")
      .forEach((el) => (el.style.display = showYes ? "block" : "none"));
    document.querySelectorAll(".no-only")
      .forEach((el) => (el.style.display = showNo ? "block" : "none"));
  };

  ndisSelect.addEventListener("change", apply);
  apply(); // estado inicial
}
  /* -------------------- Age autofill (editable) -------------------- */
  const parseYMD = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  };

  const calcAge = (d) => {
    if (!(d instanceof Date) || isNaN(d)) return "";
    const t = new Date();
    let y = t.getFullYear() - d.getFullYear();
    const m = t.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && t.getDate() < d.getDate())) y--;
    return y >= 0 ? String(y) : "";
  };

  const ensureAgeFromDob = () => {
    const dobEl = elFor("child.dob");
    const ageEl = elFor("child.age");
    if (!dobEl || !ageEl) return;
    const years = calcAge(parseYMD(dobEl.value));
    ageEl.value = years;
    ageEl.placeholder = years;
  };

  (function wireAgeAutofill() {
    const dobEl = elFor("child.dob");
    const ageEl = elFor("child.age");
    if (!dobEl || !ageEl) return;
    // Age remains editable
    ["input", "change", "blur"].forEach((evt) =>
      dobEl.addEventListener(evt, ensureAgeFromDob)
    );
    ensureAgeFromDob();
  })();

  /* -------------------- Validation -------------------- */
  function isCheckbox(name) {
    const el = elFor(name);
    return el && el.type === "checkbox";
  }
  function isFile(name) {
    const el = elFor(name);
    return el && el.type === "file";
  }

  function validateStep(idx) {
    ensureAgeFromDob();

    // clone because we may append dynamically
    const required = STEP_REQUIRED[idx] ? [...STEP_REQUIRED[idx]] : [];

    // dynamic rules for NDIS step
    if (idx === 2) {
      const v = elFor("ndis.participantEligible")?.value;
      if (v === "Yes") {
        required.push("therapy.goals", "docs.ndisPlanOrGoals");
      } else if (v === "No") {
        required.push("ndis.notEligibleReason"); 
      }
    }

    const container = steps[idx];
    clearInvalid(container);

    const missing = [];
    let firstInvalid = null;

    required.forEach((name) => {
      if (OPTIONAL_FIELDS.has(name)) return;
      const el = elFor(name);
      // ignore hidden fields (e.g., inside .yes-only/.no-only)
      if (!el || !el.offsetParent) return;

      if (isCheckbox(name)) {
        if (!el.checked) {
          missing.push(readableName(name));
          markInvalid(el);
          firstInvalid ||= el;
        }
        return;
      }

      if (isFile(name)) {
        // file inputs validated by presence of s3 keys
        if (!el.dataset.s3key && !el.dataset.s3keys) {
          missing.push(readableName(name));
          markInvalid(el);
          firstInvalid ||= el;
        }
        return;
      }

      const val = (el.value || "").trim();
      if (name === "parent1.email" ? !isEmail(val) : !val) {
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

  const validateAllBeforeSubmit = () => {
    for (let i = 0; i < steps.length - 1; i++) {
      if (!validateStep(i)) {
        currentStep = i;
        showStep(currentStep);
        return false;
      }
    }
    return true;
  };

  /* -------------------- Navigation -------------------- */
  function showStep(n) {
    if (isReader) return; // reader shows all

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
        n === steps.length - 2 ? "inline-block" : "none";
    if (saveBtn)
      saveBtn.style.display = n < steps.length - 2 ? "inline-block" : "none";
  }

  window.nextStep = function nextStep(dir) {
    if (!isReader && dir === 1 && !validateStep(currentStep)) return;
    currentStep += dir;
    if (currentStep >= 0 && currentStep < steps.length) showStep(currentStep);
  };

  /* -------------------- Reader mode helpers -------------------- */
  function showAllReaderMode() {
    steps.forEach((s) => s.classList.add("active"));
    const prevBtn = document.querySelector('button[onclick="nextStep(-1)"]');
    const nextBtn = document.querySelector('button[onclick="nextStep(1)"]');
    if (prevBtn) prevBtn.style.display = "none";
    if (nextBtn) nextBtn.style.display = "none";
    if (submitBtn) submitBtn.style.display = "none";
    if (saveBtn) saveBtn.style.display = "none";
  }

  /* -------------------- Reader: load & hydrate form -------------------- */
  /* -------------------- Reader: load & hydrate form -------------------- */
async function loadForReader() {
  try {
    const qs = new URLSearchParams(location.search);
    const token = qs.get("token");
    if (!token) return;

    const res = await fetch(
      `${API_BASE}/form/view?token=${encodeURIComponent(token)}`,
      { credentials: "include" }
    );
    if (!res.ok) { console.warn("reader view failed", res.status); return; }

    const payload = await res.json().catch(() => ({}));
    const data =
      payload?.data ??
      payload?.fields ??
      payload?.form ??
      payload?.record ??
      (typeof payload === "object" ? payload : {}) ?? {};

    // Escalares (skip file)
    Object.entries(data).forEach(([name, value]) => {
      const input = document.querySelector(`[name="${name}"]`);
      if (!input || input.type === "file") return;

      if (input.type === "checkbox") {
        input.checked = Boolean(value);
      } else if (input.type === "radio") {
        const radio = document.querySelector(`input[name="${name}"][value="${value}"]`);
        if (radio) radio.checked = true;
      } else {
        input.value = value ?? "";
      }
    });

    // Placeholders para archivos
    const placeholders = new Map();
    document.querySelectorAll('input[type="file"][name]').forEach((input) => {
      const holder = document.createElement("div");
      holder.className = "d-block";
      holder.dataset.field = input.name;
      holder.textContent = "No file uploaded";
      placeholders.set(input.name, holder);
      input.replaceWith(holder);
    });

    // Links firmados
    const files = Array.isArray(payload?.fileKeys) ? payload.fileKeys : [];
    const byField = {};
    files.forEach(({ field, key }) => {
      if (!field || !key) return;
      (byField[field] ||= []).push(key);
    });

    for (const [field, keys] of Object.entries(byField)) {
      const holder = placeholders.get(field);
      if (!holder) continue;
      holder.innerHTML = "";
      for (const key of keys) {
        const fileName = key.split("/").pop() || "file";
        const link = document.createElement("a");
        link.textContent = fileName;
        link.target = "_blank";
        link.rel = "noopener";
        link.className = "d-block";
        try {
          const r = await fetch(
            `${API_BASE}/form/file-url?key=${encodeURIComponent(key)}`,
            { credentials: "include" }
          );
          const j = await r.json().catch(() => ({}));
          link.href = j?.ok && j.url ? j.url : "#";
          if (!j?.ok) link.textContent = `${fileName} (unavailable)`;
        } catch {
          link.textContent = `${fileName} (error)`;
        }
        holder.appendChild(link);
      }
    }

    showToast(
      payload.type === "submitted" ? "Viewing submission." : "Viewing draft."
    );
  } catch (err) {
    console.error("Error loading reader form:", err);
    showToast("Could not load submission.");
  }
}

  // block submission in reader
  grantForm?.addEventListener("submit", (e) => {
    if (isReader) {
      e.preventDefault();
      showToast("Viewing only.");
    }
  });
/* ---------- util: aplanar objetos anidados a notación con puntos ---------- */
function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      !(v instanceof File)
    ) {
      flatten(v, key, out);
    } else {
      out[key] = v;
    }
  }
  return out;
}
/* ---------- resume-exchange → hydrate ---------- */
async function resumeExchangeAndHydrate(rt) {
  if (!rt) return;

  try {
    // 1) canjea el rt por un token normal
    const url = `${API_BASE}/resume/exchange?rt=${encodeURIComponent(rt)}`;
    const res  = await fetch(url, { credentials: "include" });
    if (!res.ok) {
      console.warn("resume exchange failed", res.status);
      showToast("Could not resume draft.");
      return;
    }
    const j = await res.json().catch(() => ({}));
    const token = j?.token || j?.draftToken || j?.id;
    if (!token) {
      console.warn("exchange response without token", j);
      showToast("Invalid resume link.");
      return;
    }

    // 2) guarda y llama al hidrator clásico
    localStorage.setItem("draftToken", token);
    await hydrateFromTokenEdit(token);

    // 3) limpia la URL (sin recargar la página)
    const clean = new URL(location.href);
    clean.searchParams.delete("rt");
    history.replaceState({}, "", clean.toString());
  } catch (e) {
    console.error("resume exchange error", e);
    showToast("Resume link error.");
  }
}

/* ---------- Edit-mode: hidratar formulario usando el token ---------- */
async function hydrateFromTokenEdit(token) {
  const qs = `token=${encodeURIComponent(token)}`;
  const urls = [
    `${API_BASE}/form/view?${qs}`,
    `/api/form/view?${qs}`,
    `/form/view?${qs}`,
  ];

  let payload = null;
  for (const url of urls) {
    try {
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) {
        console.warn("resume view failed", r.status, url);
        continue;
      }
      payload = (await r.json().catch(() => ({}))) || {};
      break;
    } catch (e) {
      console.warn("resume view error", e);
    }
  }
  if (!payload) {
    console.warn("resume view not available");
    return;
  }

  // admite varios shapes y aplana
  const raw =
    payload?.data ??
    payload?.fields ??
    payload?.form ??
    payload?.record ??
    payload;
  const data = flatten(raw);

  /* ----------- hidratar campos escalares ----------- */
  Object.entries(data).forEach(([name, value]) => {
    const input = document.querySelector(`[name="${name}"]`);
    if (!input || input.type === "file") return;

    switch (input.type) {
      case "checkbox":
        input.checked = Boolean(value);
        break;
      case "radio": {
        const radio = document.querySelector(
          `input[name="${name}"][value="${value}"]`
        );
        if (radio) radio.checked = true;
        break;
      }
      default:
        input.value = value ?? "";
    }
  });

  /* ----------- hidratar archivos (mantener input editable) ----------- */
  const files = Array.isArray(payload?.fileKeys) ? payload.fileKeys : [];
  const byField = {};
  files.forEach(({ field, key }) => {
    if (!field || !key) return;
    (byField[field] ||= []).push(key);
  });
  Object.entries(byField).forEach(([field, keys]) => {
    const input = document.querySelector(`input[type="file"][name="${field}"]`);
    if (!input) return;
    const joined = keys.join(",");
    input.dataset.s3keys = joined;
    input.dataset.s3key = joined; // compat
  });

  /* ----------- volver a aplicar el toggle de NDIS ----------- */
  document
    .getElementById("ndisEligible")
    ?.dispatchEvent(new Event("change", { bubbles: true }));
}

  /* -------------------- Draft logic (edit mode) -------------------- */
if (!isReader) {
  // Endpoints CONSISTENTES (prioritarios)
  const ENDPOINTS = {
    saveDraft: `${API_BASE}/form/save-draft`,
    submit: `${API_BASE}/form/submit-form`,
    uploadUrl: `${API_BASE}/form/generate-upload-url`,
  };

  // Fallbacks conocidos
  const SAVE_DRAFT_FALLBACKS = [
    ENDPOINTS.saveDraft,
    `${API_BASE}/save-draft`,
    `/api/form/save-draft`,
    `/save-draft`,
  ];
  const UPLOAD_URL_FALLBACKS_GET = [
    ENDPOINTS.uploadUrl,
    `${API_BASE}/generate-upload-url`,
    `/api/form/generate-upload-url`,
    `/form/generate-upload-url`,
  ];
  const SUBMIT_FALLBACKS = [
    ENDPOINTS.submit,
    `${API_BASE}/submit-form`,
    `/api/form/submit-form`,
    `/submit-form`,
  ];

  const isEmail = (v) => !!v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

  function formDataToJSON(fd) {
    const obj = {};
    fd.forEach((v, k) => {
      if (obj[k] === undefined) obj[k] = v;
      else if (Array.isArray(obj[k])) obj[k].push(v);
      else obj[k] = [obj[k], v];
    });
    return obj;
  }

  // Saver flexible: intenta JSON y luego FormData, con fallbacks
  async function trySaveDraftFlexible(payload) {
    const fd = payload instanceof FormData ? payload : (() => {
      const f = new FormData();
      Object.entries(payload || {}).forEach(([k, v]) => {
        if (Array.isArray(v)) v.forEach((x) => f.append(k, x));
        else f.append(k, v ?? "");
      });
      return f;
    })();
    const json = payload instanceof FormData ? formDataToJSON(fd) : payload;

    let lastErr;
    for (const url of SAVE_DRAFT_FALLBACKS) {
      // 1) JSON (si no venía como FormData)
      if (!(payload instanceof FormData)) {
        try {
          const r1 = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(json),
          });
          if (r1.ok) return { url, json: await r1.json() };
          if (![400, 404, 415].includes(r1.status)) {
            lastErr = new Error(`save-draft ${r1.status} @ ${url}`);
            continue;
          }
        } catch (e) { lastErr = e; }
      }
      // 2) FormData
      try {
        const r2 = await fetch(url, { method: "POST", body: fd });
        if (r2.ok) return { url, json: await r2.json() };
        lastErr = new Error(`save-draft ${r2.status} @ ${url}`);
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error("save-draft failed");
  }

  // Presigner flexible: GET con query y POST JSON a fallbacks
  async function getSignedUrlFlexible(field, token, mime) {
    const qs = `field=${encodeURIComponent(field)}&token=${encodeURIComponent(token)}&type=${encodeURIComponent(mime)}`;

    // 1) GET con query
    for (const base of UPLOAD_URL_FALLBACKS_GET) {
      try {
        const r = await fetch(`${base}?${qs}`, { method: "GET" });
        if (r.ok) return await r.json(); // { url, key }
      } catch {}
    }
    // 2) POST JSON
    for (const base of UPLOAD_URL_FALLBACKS_GET) {
      try {
        const r = await fetch(base, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ field, token, type: mime }),
        });
        if (r.ok) return await r.json();
      } catch {}
    }
    throw new Error("Signed URL failed");
  }
  // ---- Enviar link de reanudación por mail (una sola vez por email) ----
// ---- Enviar link de reanudación por mail (una sola vez por email) ----
async function sendResumeEmailOnce(email, token) {
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !valid.test(String(email).trim())) return;
  if (!token) return;

  const cleanEmail = String(email).trim();
  const key = `resumeSent:${cleanEmail}`;
  if (localStorage.getItem(key)) return; // dedupe

  const resumeUrlStr =
    `${location.origin}${location.pathname}?token=${encodeURIComponent(token)}`;

  // 1) Endpoints dedicados (si existen)
  const dedicated = [
    `${API_BASE}/resume/send`,
    `${API_BASE}/form/resume-send`,
    `/api/resume/send`,
    `/resume/send`,
    // extras habituales
    `${API_BASE}/form/send-resume`,
    `${API_BASE}/form/send-draft-link`,
  ];

  const jsonPayload = { email: cleanEmail, token, resumeUrl: resumeUrlStr };
  const fdPayload = new FormData();
  fdPayload.append("email", cleanEmail);
  fdPayload.append("token", token);
  fdPayload.append("resumeUrl", resumeUrlStr);

  for (const url of dedicated) {
    try {
      const r1 = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(jsonPayload),
      });
      if (r1.ok) { localStorage.setItem(key, String(Date.now())); return; }
    } catch {}
    try {
      const r2 = await fetch(url, { method: "POST", body: fdPayload });
      if (r2.ok) { localStorage.setItem(key, String(Date.now())); return; }
    } catch {}
  }

  // 2) Fallback: piggyback sobre save-draft (algunos backends mandan mail si ven estos flags)
  const saveDraftLike = [
    `${API_BASE}/form/save-draft`,
    `${API_BASE}/save-draft`,
    `/api/form/save-draft`,
    `/save-draft`,
  ];

  for (const url of saveDraftLike) {
    // a) JSON
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: cleanEmail,
          token,
          step: currentStep,
          resumeEmail: cleanEmail,
          resumeUrl: resumeUrlStr,
          sendEmail: true,
          notify: true,
          sendResumeEmail: true,
        }),
      });
      if (r.ok) { localStorage.setItem(key, String(Date.now())); return; }
    } catch {}

    // b) FormData
    try {
      const fd = new FormData();
      fd.append("email", cleanEmail);
      fd.append("token", token);
      fd.append("step", String(currentStep));
      fd.append("resumeEmail", cleanEmail);
      fd.append("resumeUrl", resumeUrlStr);
      fd.append("sendEmail", "1");
      fd.append("notify", "1");
      fd.append("sendResumeEmail", "1");
      const r = await fetch(url, { method: "POST", body: fd });
      if (r.ok) { localStorage.setItem(key, String(Date.now())); return; }
    } catch {}
  }

  // 3) Último recurso: copiar el link al portapapeles para el usuario
  try {
    await navigator.clipboard.writeText(resumeUrlStr);
    showToast("Resume link copied to clipboard.");
  } catch {}
}

  async function ensureToken() {
    let token = localStorage.getItem("draftToken");
    if (token) return token;

    // intento directo al endpoint consistente
    const fd = new FormData();
    fd.append("step", currentStep);
    try {
      const res = await fetch(ENDPOINTS.saveDraft, { method: "POST", body: fd });
      if (res.ok) {
        token = (await res.json()).token;
        if (token) localStorage.setItem("draftToken", token);
        return token;
      }
    } catch {}

    // fallback flexible
    const { json } = await trySaveDraftFlexible(fd);
    token = json?.token;
    if (token) localStorage.setItem("draftToken", token);
    return token;
  }

  function validateDraftMin() {
    const missing = [];
    let firstInvalid = null;
    ["parent1.firstName", "parent1.mobile", "parent1.email"].forEach((name) => {
      const el = document.querySelector(`[name="${name}"]`);
      if (!el) return;
      const v = (el.value || "").trim();
      const ok = name === "parent1.email" ? isEmail(v) : v.length > 0;
      if (!ok) {
        missing.push(name);
        el.classList.add("is-invalid");
        firstInvalid ||= el;
      }
    });
    if (missing.length) {
      showToast("Please complete: First name, Mobile, Email to save your draft.");
      firstInvalid?.focus();
      return false;
    }
    return true;
  }

  // --- Upload multi-archivo (hasta 5) ---
  document.querySelectorAll('input[type="file"]').forEach((input) => {
    input.addEventListener("change", async () => {
      const files = Array.from(input.files || []);
      delete input.dataset.s3key;
      delete input.dataset.s3keys;
      if (!files.length) return;
      if (files.length > 5) {
        showToast("You can upload up to 5 files only.");
        input.value = "";
        return;
      }

      const fieldName = input.name;
      const mimeMap = {
        pdf: "application/pdf",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        webp: "image/webp",
        heic: "image/heic",
        heif: "image/heic",
      };
      const s3keys = [];

      for (const file of files) {
        const ext = (file.name.split(".").pop() || "").toLowerCase();
        const mime = file.type || mimeMap[ext] || "";
        if (!mime) { showToast("Unsupported file type."); return; }

        try {
          const token = await ensureToken();

          // intento consistente primero
          let presign;
          try {
            const r = await fetch(
              `${ENDPOINTS.uploadUrl}?field=${encodeURIComponent(fieldName)}&token=${encodeURIComponent(token)}&type=${encodeURIComponent(mime)}`
            );
            if (r.ok) presign = await r.json();
          } catch {}

          // si falla, uso flexible
          if (!presign || !presign.url || !presign.key) {
            presign = await getSignedUrlFlexible(fieldName, token, mime);
          }

          const up = await fetch(presign.url, {
            method: "PUT",
            headers: { "Content-Type": mime },
            body: file,
          });
          if (!up.ok) throw new Error("Upload failed");
          s3keys.push(presign.key);
        } catch (err) {
          console.error(err);
          showToast("Upload error.");
          return;
        }
      }

      if (s3keys.length) {
        // guardamos en ambos por compatibilidad
        input.dataset.s3keys = s3keys.join(",");
        input.dataset.s3key = s3keys.join(",");
        showToast("Files uploaded.");
      }
    });
  });

  // --- Guardar borrador ---
  // --- Guardar borrador ---
window.saveStep = async function saveStep() {
  if (!validateDraftMin()) return;

  const formEl = document.getElementById("grantForm");
  const formData = new FormData(formEl);

  // reemplaza Files por sus S3 keys (una entrada por key)
  document.querySelectorAll('input[type="file"]').forEach((input) => {
    if (formData.has(input.name)) formData.delete(input.name);
    const keys = (input.dataset.s3keys || input.dataset.s3key || "")
      .split(",").map((s) => s.trim()).filter(Boolean);
    keys.forEach((k) => formData.append(input.name, k));
  });

  formData.append("step", currentStep);
  const existingToken = localStorage.getItem("draftToken");
  if (existingToken) formData.append("token", existingToken);

  let tokenForEmail = existingToken || null;

  // 1) intento directo al endpoint principal
  try {
    const res = await fetch(`${API_BASE}/form/save-draft`, {
      method: "POST",
      body: formData
    });
    if (res.ok) {
      const j = await res.json();
      if (j.token) {
        localStorage.setItem("draftToken", j.token);
        tokenForEmail = j.token;
      }
      showToast("Draft saved.");
    } else {
      throw new Error(`save-draft ${res.status}`);
    }
  } catch {
    // 2) fallbacks flexibles (JSON/FormData + rutas alternativas)
    try {
      const { json } = await trySaveDraftFlexible(formData);
      if (json?.token) {
        localStorage.setItem("draftToken", json.token);
        tokenForEmail = json.token;
      }
      showToast("Draft saved.");
    } catch (err) {
      console.error("save-draft error:", err);
      showToast("Save draft failed.");
      return;
    }
  }

  // ---- Enviar mail una sola vez por email (si hay email válido)
  const emailVal = (document.querySelector('[name="parent1.email"]')?.value || "").trim();
  await sendResumeEmailOnce(emailVal, tokenForEmail || localStorage.getItem("draftToken"));
};

  // --- Envío final ---
  document.getElementById("grantForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!validateAllBeforeSubmit()) return;

    const formEl = document.getElementById("grantForm");
    const formData = new FormData(formEl);

    document.querySelectorAll('input[type="file"]').forEach((input) => {
      if (formData.has(input.name)) formData.delete(input.name);
      const keys = (input.dataset.s3keys || input.dataset.s3key || "")
        .split(",").map((s) => s.trim()).filter(Boolean);
      keys.forEach((k) => formData.append(input.name, k));
    });

    const existingToken = localStorage.getItem("draftToken");
    if (existingToken) formData.append("token", existingToken);

    // 1) directo
    try {
      const res = await fetch(ENDPOINTS.submit, { method: "POST", body: formData });
      if (res.ok) {
        localStorage.removeItem("draftToken");
        currentStep = steps.length - 1;
        showStep(currentStep);
        showToast("Submission received.");
        return;
      }
    } catch {}

    // 2) fallbacks
    let lastErr;
    for (const url of SUBMIT_FALLBACKS) {
      try {
        const r = await fetch(url, { method: "POST", body: formData });
        if (r.ok) {
          localStorage.removeItem("draftToken");
          currentStep = steps.length - 1;
          showStep(currentStep);
          showToast("Submission received.");
          return;
        }
        lastErr = new Error(`submit ${r.status} @ ${url}`);
      } catch (e) { lastErr = e; }
    }
    console.error(lastErr);
    showToast("Submission failed.");
  });
} else {
  window.saveStep = () => {};
}




  /* -------------------- Dev helper -------------------- */
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


/* -------------------- Initial render -------------------- */
document.addEventListener("DOMContentLoaded", async () => {
  if (isReader) {
    showAllReaderMode();
    document
      .querySelectorAll("input, textarea, select")
      .forEach((el) => (el.disabled = true));
    await loadForReader();
    return;
  }

  const params = new URLSearchParams(location.search);

  // 1) ¿viene un rt= ?  → canje + hydrate
  const rt = params.get("rt");
  if (rt) {
    await resumeExchangeAndHydrate(rt);
  } else {
    // 2) ¿viene un token= ?  → hydrate directo
    const tokenParam = params.get("token");
    if (tokenParam) {
      localStorage.setItem("draftToken", tokenParam);
      await hydrateFromTokenEdit(tokenParam);
    }
  }

  // 3) init UI
  initNdisToggle();
  showStep(currentStep);
});
})();