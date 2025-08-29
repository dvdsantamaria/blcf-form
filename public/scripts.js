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

  saveBtn?.setAttribute("type", "button");
submitBtn?.setAttribute("type", "submit");

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

/* -------------------- File helpers (existing uploads UI) -------------------- */
const MAX_FILES_PER_FIELD = 5;
const MAX_FILE_MB = 10;
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;


function getExistingKeys(input) {
  return (input.dataset.s3keys || input.dataset.s3key || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
function setKeys(input, keys) {
  const uniq = [...new Set((keys || []).filter(Boolean))].slice(
    0,
    MAX_FILES_PER_FIELD
  );
  const joined = uniq.join(",");
  input.dataset.s3keys = joined;
  input.dataset.s3key = joined; // compat
  // limpiar selección del input para permitir re-subir mismo nombre luego
  if (input.value) input.value = "";
  renderExistingFiles(input, uniq);
}

function renderExistingFiles(input, keys) {
  let list = input.nextElementSibling;
  if (!list || !list.classList || !list.classList.contains("uploaded-list")) {
    list = document.createElement("div");
    list.className = "uploaded-list mt-1";
    input.insertAdjacentElement("afterend", list);
  }
  list.innerHTML = "";
  if (!Array.isArray(keys) || !keys.length) {
    list.style.display = "none";
    return;
  }
  list.style.display = "block";

  keys.forEach((k) => {
    const wrap = document.createElement("div");
    wrap.className = "d-flex align-items-center gap-2 mb-1";

    const name = document.createElement("span");
    name.className = "badge bg-secondary";
    name.textContent = k.split("/").pop() || "file";

    const view = document.createElement("a");
    view.textContent = "view";
    view.className = "small";
    view.target = "_blank";
    view.rel = "noopener";

    // Intento de link firmado (si falla, simplemente muestra “uploaded”)
    fetch(`${API_BASE}/form/file-url?key=${encodeURIComponent(k)}`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    })
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok && j.url) {
          view.href = j.url;
        } else {
          view.href = "#";
          view.textContent = "uploaded";
          view.removeAttribute("target");
        }
      })
      .catch(() => {
        view.href = "#";
        view.textContent = "uploaded";
        view.removeAttribute("target");
      });

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn btn-sm btn-outline-danger";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => {
      const remain = getExistingKeys(input).filter((x) => x !== k);
      setKeys(input, remain);
      showToast("File removed from draft.");
    });

    wrap.append(name, view, removeBtn);
    list.appendChild(wrap);
  });
}

/* -------------------- File key normalization (resilient) -------------------- */
function looksLikeS3Key(s) {
  return typeof s === "string" && s.trim().length > 0 && /[\/]/.test(s);
}

function normalizeToKeys(val) {
  // Acepta: string ("a/b.pdf" o "a/b.pdf,c/d.png"), array, objeto { key, keys, 0:"",1:"" }
  if (!val) return [];
  if (Array.isArray(val)) {
    return val.flatMap(normalizeToKeys).filter(looksLikeS3Key);
  }
  if (typeof val === "string") {
    return val
      .split(",")
      .map((x) => x.trim())
      .filter(looksLikeS3Key);
  }
  if (typeof val === "object") {
    if (Array.isArray(val.keys)) return normalizeToKeys(val.keys);
    if (typeof val.key === "string") return normalizeToKeys(val.key);
    // objeto tipo {0:"...",1:"..."} o cualquier diccionario
    return Object.values(val).flatMap(normalizeToKeys).filter(looksLikeS3Key);
  }
  return [];
}

/* -------------------- Collect per-field keys from payload + draft -------------------- */
function collectFileKeysByField(payload, flattenedData) {
  const byField = {};

  // 1) Si viene el formato explícito [{field,key}]
  if (Array.isArray(payload?.fileKeys)) {
    payload.fileKeys.forEach(({ field, key }) => {
      if (!field || !key) return;
      (byField[field] ||= []).push(key);
    });
  }

  // 2) También intentar desde el draft "tal cual"
  document.querySelectorAll('input[type="file"][name]').forEach((input) => {
    const name = input.name;
    const val = flattenedData?.[name];
    const keys = normalizeToKeys(val);
    if (keys.length) {
      (byField[name] ||= []).push(...keys);
    }
  });

  // 3) limpiar duplicados y respetar el máximo
  Object.keys(byField).forEach((f) => {
    byField[f] = [...new Set(byField[f])].slice(0, MAX_FILES_PER_FIELD);
  });

  return byField;
}

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
  // mostrar todos menos el último (thank-you)
  steps.forEach((s, i) => {
    const isThankYou = i === steps.length - 1;
    if (isThankYou) {
      s.classList.remove("active");
      s.style.display = "none";
    } else {
      s.classList.add("active");
      s.style.removeProperty("display");
    }
  });

  const prevBtn = document.querySelector('button[onclick="nextStep(-1)"]');
  const nextBtn = document.querySelector('button[onclick="nextStep(1)"]');
  if (prevBtn) prevBtn.style.display = "none";
  if (nextBtn) nextBtn.style.display = "none";
  if (submitBtn) submitBtn.style.display = "none";
  if (saveBtn) saveBtn.style.display = "none";
}
/* Reader: aplica visibilidad de bloques NDIS según dato persistido */
function applyNdisVisibilityForReader(flat) {
  const v = String(flat["ndis.participantEligible"] || "").trim();
  const showYes = v === "Yes";
  const showNo  = v === "No";
  document.querySelectorAll(".yes-only")
    .forEach((el) => (el.style.display = showYes ? "block" : "none"));
  document.querySelectorAll(".no-only")
    .forEach((el) => (el.style.display = showNo ? "block" : "none"));
}

/* -------------------- Reader: load & hydrate form (submission-first) -------------------- */
async function loadForReader() {
  try {
    const token = new URLSearchParams(location.search).get("token");
    if (!token) return;

    const qs = `token=${encodeURIComponent(token)}`;
    const urls = [
      `${API_BASE}/form/view?${qs}`,   // ← submission (principal)
      `/api/form/view?${qs}`,
      `/form/view?${qs}`,
      `${API_BASE}/resume/get-draft?${qs}` // último recurso: draft
    ];

    let payload = null;
    for (const url of urls) {
      try {
        const r = await fetch(url, { credentials: "include", headers: { Accept: "application/json" }});
        if (!r.ok) { console.warn("reader view failed", r.status, url); continue; }
        payload = (await r.json().catch(() => ({}))) || {};
        break;
      } catch (e) {
        console.warn("reader view error", e);
      }
    }
    if (!payload) { showToast("Could not load submission."); return; }

    // tomar el cuerpo real sin importar forma
    const raw =
      payload?.data ??
      payload?.fields ??
      payload?.form ??
      payload?.record ??
      (typeof payload === "object" ? payload : {});

    const flat = flatten(raw);
    console.log("hydrate raw draft:", raw);
    console.log("flattened draft data:", flat);

    // ---- Escalares (skip file) ----
    Object.entries(flat).forEach(([name, value]) => {
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

    // ---- NDIS show/hide en modo reader según dato guardado ----
    applyNdisVisibilityForReader(flat);

    // ---- Archivos: reemplazar input por holder y listar keys ----
    const holders = new Map();
    document.querySelectorAll('input[type="file"][name]').forEach((input) => {
      const holder = document.createElement("div");
      holder.className = "uploaded-list mt-1";
      holder.dataset.field = input.name;
      holder.textContent = "No file uploaded";
      input.replaceWith(holder);        // en reader no queremos el input
      holders.set(input.name, holder);
    });

    // Usa fileKeys explícitos y/o valores crudos del draft (docs.*)
    const byField = collectFileKeysByField(payload, flat);

    for (const [field, keys] of Object.entries(byField)) {
      const holder = holders.get(field);
      if (!holder) continue;

      holder.innerHTML = "";
      if (!keys.length) {
        holder.textContent = "No file uploaded";
        continue;
      }

      for (const key of keys) {
        const fileName = key.split("/").pop() || "file";
        const row = document.createElement("div");
        row.className = "d-flex align-items-center gap-2 mb-1";

        const name = document.createElement("span");
        name.className = "badge bg-secondary";
        name.textContent = fileName;

        const link = document.createElement("a");
        link.className = "small";
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = "view";

        try {
          const r = await fetch(
            `${API_BASE}/form/file-url?key=${encodeURIComponent(key)}`,
            { credentials: "include", headers: { Accept: "application/json" } }
          );
          const j = await r.json().catch(() => ({}));
          if (j?.ok && j.url) {
            link.href = j.url;
          } else {
            link.href = "#";
            link.textContent = "uploaded";
            link.removeAttribute("target");
          }
        } catch {
          link.href = "#";
          link.textContent = "uploaded";
          link.removeAttribute("target");
        }

        row.append(name, link);
        holder.appendChild(row);
      }
    }

    showToast(payload.type === "submitted" ? "Viewing submission." : "Viewing draft.");
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
    const res = await fetch(`${API_BASE}/resume/exchange?rt=${encodeURIComponent(rt)}`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });

    if (res.ok && res.headers.get("content-type")?.includes("json")) {
      const j = await res.json().catch(() => ({}));
      const token = j?.token || j?.draftToken || j?.id;
      if (!token) { showToast("Invalid resume link."); return; }
      localStorage.setItem("draftToken", token);
      await hydrateFromTokenEdit(token);
    } else {
      // Fue redirect → usamos cookie
      const who = await fetch(`${API_BASE}/resume/whoami`, {
        credentials: "include",
        headers: { Accept: "application/json" },
      }).then(r => r.json()).catch(() => ({}));
      const token = who?.token;
      if (!token) { showToast("Could not resume draft."); return; }
      localStorage.setItem("draftToken", token);
      await hydrateFromTokenEdit(token);
    }

    // limpiar rt= de la URL
    const clean = new URL(location.href);
    clean.searchParams.delete("rt");
    history.replaceState({}, "", clean.toString());
  } catch (e) {
    console.error("resume exchange error", e);
    showToast("Resume link error.");
  }
}

async function hydrateFromCookieIfAny() {
  const url = new URL(location.href);
  const allowOnce =
    url.searchParams.get("resumed") === "1" ||
    localStorage.getItem("resume:allowCookieHydrate") === "1";

  if (!allowOnce) return false;

  // one-shot: consumimos el flag si estaba en localStorage
  localStorage.removeItem("resume:allowCookieHydrate");

  try {
    const who = await fetch(`${API_BASE}/resume/whoami`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    }).then((r) => r.json()).catch(() => ({}));

    const token = who?.token;
    if (!token) return false;

    localStorage.setItem("draftToken", token);
    await hydrateFromTokenEdit(token);

    // limpiar el marcador de la URL si vino por query
    if (url.searchParams.has("resumed")) {
      url.searchParams.delete("resumed");
      history.replaceState({}, "", url.toString());
    }
    return true;
  } catch (e) {
    console.warn("hydrateFromCookieIfAny error", e);
    return false;
  }
}
/* ---------- Edit-mode: hidratar formulario usando el token ---------- */
async function hydrateFromTokenEdit(token) {
  const qs = `token=${encodeURIComponent(token)}`;
  const urls = [
    `${API_BASE}/resume/get-draft?${qs}`, // prioridad
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

  // ---- tolerancia a distintos shapes + flatten ----
  const raw =
    payload?.data ??
    payload?.fields ??
    payload?.form ??
    payload?.record ??
    (typeof payload === "object" ? payload : {});

  const flat = (obj, prefix = "", out = {}) => {
    for (const [k, v] of Object.entries(obj || {})) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) flat(v, key, out);
      else out[key] = v;
    }
    return out;
  };
  const data = flat(raw);

  // ---- hidratar escalares ----
  Object.entries(data).forEach(([name, value]) => {
    const input = document.querySelector(`[name="${name}"]`);
    if (!input || input.type === "file") return;
    if (input.type === "checkbox") input.checked = Boolean(value);
    else if (input.type === "radio") {
      const radio = document.querySelector(
        `input[name="${name}"][value="${value}"]`
      );
      if (radio) radio.checked = true;
    } else {
      input.value = value ?? "";
    }
  });

  // ---- hidratar archivos: juntar keys y renderizar UI junto al input ----
  const byField = collectFileKeysByField(payload, data);
  Object.entries(byField).forEach(([field, keys]) => {
    const input = document.querySelector(`input[type="file"][name="${field}"]`);
    if (!input) {
      console.debug("file field not in DOM:", field);
      return;
    }
    setKeys(input, keys); // set dataset + pinta listado + respeta máximo
  });

  // ---- ajustes visuales dependientes de valores ----
  document
    .getElementById("ndisEligible")
    ?.dispatchEvent(new Event("change", { bubbles: true }));
  ensureAgeFromDob();
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
  const key = `resumeSent:${cleanEmail}:${token}`;
    if (localStorage.getItem(key)) return; // dedupe

  const resumeUrlStr =
    `${location.origin}${location.pathname}?token=${encodeURIComponent(token)}`;

   const dedicated = [
       `${API_BASE}/resume/send-link`,     
       `${API_BASE}/resume/send`,            
       `${API_BASE}/form/resume-send`,     
       `/api/resume/send-link`,
       `/api/resume/send`,
       `/resume/send`,
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
let _tokenPromise = null;


async function ensureToken() {
  // 1) si ya hay token, usarlo
  const existing = localStorage.getItem("draftToken");
  if (existing) return existing;

  // 2) si ya hay una creación en curso, esperar esa
  if (_tokenPromise) return _tokenPromise;

  // 3) crear UNA sola vez
  const make = async () => {
    const fd = new FormData();
    fd.append("step", currentStep);

    try {
      const res = await fetch(`${API_BASE}/form/save-draft`, {
        method: "POST",
        body: fd,
      });
      if (res.ok) {
        const j = await res.json().catch(() => ({}));
        if (j?.token) {
          localStorage.setItem("draftToken", j.token);
          return j.token;
        }
      }
    } catch {}

    // fallback flexible
    const { json } = await trySaveDraftFlexible(fd);
    const t = json?.token || null;
    if (t) localStorage.setItem("draftToken", t);
    return t;
  };

  _tokenPromise = make().finally(() => (_tokenPromise = null));
  return _tokenPromise;
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

/* ---- Util: CRC32 -> base64 (formato que espera S3) ---- */
function crc32Base64FromArrayBuffer(buf) {
  const table = (function () {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      t[i] = c >>> 0;
    }
    return t;
  })();
  let crc = 0 ^ (-1);
  const view = new Uint8Array(buf);
  for (let i = 0; i < view.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ view[i]) & 0xFF];
  }
  crc = (crc ^ (-1)) >>> 0;
  // big-endian + base64
  const be = new Uint8Array(4);
  be[0] = (crc >>> 24) & 0xFF;
  be[1] = (crc >>> 16) & 0xFF;
  be[2] = (crc >>> 8) & 0xFF;
  be[3] = crc & 0xFF;
  let bin = "";
  for (let i = 0; i < be.length; i++) bin += String.fromCharCode(be[i]);
  return btoa(bin);
}

/* --- Upload multi-archivo (hasta 5) --- */
document.querySelectorAll('input[type="file"]').forEach((input) => {
  input.addEventListener("change", async () => {
    let files = Array.from(input.files || []);
    if (!files.length) return;

    const existing = getExistingKeys(input);
    const remaining = Math.max(0, MAX_FILES_PER_FIELD - existing.length);
    if (remaining <= 0) {
      showToast(`You already have ${MAX_FILES_PER_FIELD} files uploaded for this field.`);
      input.value = "";
      return;
    }
    if (files.length > remaining) {
      files = files.slice(0, remaining);
      showToast(
        `You can add ${remaining} more file${remaining > 1 ? "s" : ""} (max ${MAX_FILES_PER_FIELD} total).`
      );
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
    const newKeys = [];

    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        showToast(`Each file must be <= ${MAX_FILE_MB} MB.`);
        continue;
      }

      const ext = (file.name.split(".").pop() || "").toLowerCase();
      const mime = file.type || mimeMap[ext] || "";
      if (!mime) {
        showToast("Unsupported file type.");
        input.value = "";
        return;
      }

      try {
        const token = await ensureToken();

        let presign;
        try {
          const r = await fetch(
            `${API_BASE}/form/generate-upload-url?field=${encodeURIComponent(
              fieldName
            )}&token=${encodeURIComponent(token)}&type=${encodeURIComponent(
              mime
            )}`,
            { headers: { Accept: "application/json" } }
          );
          if (r.ok) presign = await r.json();
        } catch {}

        // 2) fall back if needed
        if (!presign || !presign.url || !presign.key) {
          presign = await getSignedUrlFlexible(fieldName, token, mime);
        }

        const up = await fetch(presign.url, {
          method: "PUT",
          headers: { "Content-Type": mime },
          body: file
        });
        if (!up.ok) {
          console.error("S3 upload failed", up.status, await up.text().catch(() => ""));
          throw new Error("Upload failed");
        }
        newKeys.push(presign.key);
      } catch (err) {
        console.error(err);
        showToast("Upload error.");
        input.value = "";
        return;
      }
    }

    if (newKeys.length) {
      setKeys(input, [...existing, ...newKeys]);
      showToast("Files uploaded.");
    }
    input.value = ""; // reset input
  });
});

// --- Guardar borrador (single-flight, sin duplicados) ---
let _savingDraft = false;
let _savingPromise = null;

window.saveStep = async function saveStep() {
  if (_savingDraft) return _savingPromise; // evita doble click / llamadas concurrentes
  if (!validateDraftMin()) return;

  const formEl = document.getElementById("grantForm");
  const saveButton = document.getElementById("saveDraftBtn");
  // lock UI
  let originalText;
  if (saveButton) {
    originalText = saveButton.textContent;
    saveButton.disabled = true;
    saveButton.setAttribute("aria-busy", "true");
    saveButton.textContent = "Saving…";
  }

  const run = async () => {
    // construir FormData
    const formData = new FormData(formEl);

    // reemplaza Files por sus S3 keys (una entrada por key)
    document.querySelectorAll('input[type="file"][name]').forEach((input) => {
      if (formData.has(input.name)) formData.delete(input.name);
      const keys = (input.dataset.s3keys || input.dataset.s3key || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      keys.forEach((k) => formData.append(input.name, k));
    });

    formData.append("step", currentStep);
    const existingToken = localStorage.getItem("draftToken");
    if (existingToken) formData.append("token", existingToken);

    let tokenForEmail = existingToken || null;

    try {
      // 1) intento directo al endpoint principal
      try {
        const res = await fetch(`${API_BASE}/form/save-draft`, {
          method: "POST",
          body: formData,
        });
        if (!res.ok) throw new Error(`save-draft ${res.status}`);
        const j = await res.json().catch(() => ({}));
        if (j?.token) {
          localStorage.setItem("draftToken", j.token);
          tokenForEmail = j.token;
        }
      } catch {
        // 2) fallbacks flexibles (JSON/FormData + rutas alternativas)
        const { json } = await trySaveDraftFlexible(formData);
        if (json?.token) {
          localStorage.setItem("draftToken", json.token);
          tokenForEmail = json.token;
        }
      }

      showToast("Draft saved.");

      // Enviar mail una sola vez por email (dedupe interno por email+token)
      const emailVal =
        (document.querySelector('[name="parent1.email"]')?.value || "").trim();
      await sendResumeEmailOnce(
        emailVal,
        tokenForEmail || localStorage.getItem("draftToken")
      );
    } catch (err) {
      console.error("save-draft error:", err);
      showToast("Save draft failed.");
    } finally {
      // unlock UI
      if (saveButton) {
        saveButton.disabled = false;
        saveButton.removeAttribute("aria-busy");
        if (originalText) saveButton.textContent = originalText;
      }
      _savingDraft = false;
      _savingPromise = null;
    }
  };

  _savingDraft = true;
  _savingPromise = run();
  return _savingPromise;
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
    document.querySelectorAll("input, textarea, select").forEach((el) => (el.disabled = true));
    await loadForReader();
    return;
  }

  const url = new URL(location.href);
  const rt = url.searchParams.get("rt");
  const tokenParam = url.searchParams.get("token");
  const hasResumedMarker = url.searchParams.get("resumed") === "1";

  if (rt) {
    await resumeExchangeAndHydrate(rt);        // JSON exchange → hidrata directo
  } else if (tokenParam) {
    localStorage.setItem("draftToken", tokenParam);
    await hydrateFromTokenEdit(tokenParam);    // resume explícito por token
  } else if (hasResumedMarker || localStorage.getItem("resume:allowCookieHydrate") === "1") {
    // Solo hidratar por cookie si viene del exchange con redirect (?resumed=1)
    await hydrateFromCookieIfAny();
  } // else: NO hidratar nada automáticamente

  initNdisToggle();
  showStep(currentStep);
});



})();