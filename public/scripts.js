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
  // Updated to match new flow (keep legacy optional where harmless)
  const OPTIONAL_FIELDS = new Set([
    // New optional files
    "docs.diagnosisLetter",
    "docs.additionalLetterOptional",

    // Legacy optional flags/notes (safe to keep)
    "ndis.moreSupportWhy",

    // Parent two full block
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

    // Household extras
    "dependents.ages",
    "dependents.withDisabilityCount",
    "otherConditions.details",
  ]);

  /* -------------------- Required fields by step -------------------- */
  // Step 2 is now dynamic (see validateStep)
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
      "child.phone",
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
      "ndis.participantEligible", // dynamic extras added in validateStep
      "therapy.toBeFunded",
      "therapy.frequencyOrEquipment",
      "therapy.noGrantImpact",
      // NOTE: removed legacy requireds:
      // "docs.ndisCommunication",
      // "docs.supportLetterHealthProfessional",
      // "therapy.goals",
      // "docs.diagnosisLetter",
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

  async function trySaveDraft(payloadObj) {
    const endpoints = [`${API_BASE}/save-draft`, `/api/form/save-draft`, `/save-draft`];
  
    // Build a FormData version as fallback
    const fd = new FormData();
    Object.entries(payloadObj).forEach(([k, v]) => fd.append(k, v));
  
    let lastErr;
  
    for (const url of endpoints) {
      // 1) JSON first
      try {
        const r1 = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payloadObj),
        });
        if (r1.ok) return { url, json: await r1.json() };
  
        // 404/415 → probamos FormData
        if (r1.status === 404 || r1.status === 415) {
          const r2 = await fetch(url, { method: "POST", body: fd });
          if (r2.ok) return { url, json: await r2.json() };
          lastErr = new Error(`save-draft ${r2.status} @ ${url}`);
        } else {
          lastErr = new Error(`save-draft ${r1.status} @ ${url}`);
        }
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("save-draft failed");
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
      // Parent one
      "parent1.relationshipToChild": "Relationship to the child",
      "parent1.firstName": "Parent one first name",
      "parent1.lastName": "Parent one last name",
      "parent1.mobile": "Parent one mobile",
      "parent1.email": "Parent one email",
      "parent1.employmentStatus": "Employment status",
      "parent1.occupation": "Occupation",
      "parent1.centrelinkPayments": "Centrelink payments",
      "parent1.livingArrangements": "Living arrangements",
      // Child block
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
      "child.mainLanguage": "Main language",
      "child.diagnosis": "Diagnosis",
      "child.impactDailyLife": "Impact daily life",
      "child.currentSupports": "Current supports",
      "child.impactFamily": "Impact family",
      "child.currentTherapies": "Current therapies",
      // NDIS (legacy + new)
      "ndis.participantEligible": "NDIS participant or eligible",
      "docs.ndisCommunication": "NDIS communication file",
      "docs.supportLetterHealthProfessional": "Support letter file",
      "therapy.toBeFunded": "Therapies to be funded",
      "therapy.frequencyOrEquipment": "Frequency or equipment",
      "therapy.goals": "Child’s therapy goals",
      "therapy.noGrantImpact": "Impact if no grant",
      "docs.diagnosisLetter": "Diagnosis letter file",
      "docs.ndisPlanOrGoals": "Ndis plan or goals",
      "ndis.notEligibleReason": "Reason not eligible",
      // Consent
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
      if (!label && el.id)
        label = document.querySelector(`label[for="${el.id}"]`);
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
        if (!label && el.id)
          label = document.querySelector(`label[for="${el.id}"]`);
        if (label && !/\*\s*$/.test(label.textContent))
          label.innerHTML = `${label.innerHTML} <span class="text-danger">*</span>`;
      });
    });
  })();

  /* -------------------- NDIS show/hide -------------------- */
  function initNdisToggle() {
    const ndisSelect = document.getElementById("ndisEligible");
    if (!ndisSelect) return;

    const toggle = () => {
      const val = ndisSelect.value;
      const showYes = val === "Yes";
      const showNo = val === "No";

      document
        .querySelectorAll(".yes-only")
        .forEach((el) => (el.style.display = showYes ? "block" : "none"));
      document
        .querySelectorAll(".no-only")
        .forEach((el) => (el.style.display = showNo ? "block" : "none"));
    };

    ndisSelect.addEventListener("change", toggle);
    ndisSelect.addEventListener("input", toggle);
    toggle();
  }

  /* -------------------- Age autofill -------------------- */
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
    ageEl.readOnly = true;
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

    // clone because we'll push dynamic requirements
    const required = STEP_REQUIRED[idx] ? [...STEP_REQUIRED[idx]] : [];

    // Dynamic NDIS requirements for step 2
    if (idx === 2) {
      const yes = elFor("ndis.participantEligible")?.value === "Yes";
      if (yes) {
        required.push("therapy.goals", "docs.ndisPlanOrGoals");
      } else {
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
      if (!el) return;

      if (isCheckbox(name)) {
        if (!el.checked) {
          missing.push(readableName(name));
          markInvalid(el);
          firstInvalid ||= el;
        }
        return;
      }

      if (isFile(name)) {
        if (!el.dataset.s3key) {
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

  /* -------------------- Reader mode -------------------- */
  function showAllReaderMode() {
    steps.forEach((s) => s.classList.add("active"));
    const prevBtn = document.querySelector('button[onclick="nextStep(-1)"]');
    const nextBtn = document.querySelector('button[onclick="nextStep(1)"]');
    if (prevBtn) prevBtn.style.display = "none";
    if (nextBtn) nextBtn.style.display = "none";
    if (submitBtn) submitBtn.style.display = "none";
    if (saveBtn) saveBtn.style.display = "none";
  }

  /* -------------------- Reader: run after DOM ready -------------------- */
  async function loadForReader() {
    try {
      const qs = new URLSearchParams(location.search);
      const token = qs.get("token");
      if (!token) return;

      const res = await fetch(
        `/api/form/view?token=${encodeURIComponent(token)}`
      );
      if (!res.ok) return;

      const payload = await res.json();
      const data = payload?.data || {};

      // Hydrate text/checkbox/radio fields (skip file inputs!)
      Object.entries(data).forEach(([name, value]) => {
        const input = elFor(name);
        if (!input) return;

        switch (input.type) {
          case "checkbox":
            input.checked = !!value;
            break;
          case "radio": {
            const radio = document.querySelector(
              `input[name="${name}"][value="${value}"]`
            );
            if (radio) radio.checked = true;
            break;
          }
          case "file":
            // never set value on file inputs
            break;
          default:
            input.value = value ?? "";
        }
      });

      // 1) Replace ALL file inputs with a placeholder
      const placeholders = new Map();
      document.querySelectorAll('input[type="file"][name]').forEach((input) => {
        const ph = document.createElement("span");
        ph.className = "form-control-plaintext text-muted d-block";
        ph.textContent = "No file uploaded";
        ph.dataset.field = input.name;
        placeholders.set(input.name, ph);
        input.replaceWith(ph);
      });

      // 2) For each uploaded file, swap placeholder with a signed link
      const files = Array.isArray(payload?.fileKeys) ? payload.fileKeys : [];
      for (const { field, key } of files) {
        if (!field || !key) continue;

        const fn = (key || "").split("/").pop() || readableName(field);
        const a = document.createElement("a");
        a.textContent = fn;
        a.target = "_blank";
        a.rel = "noopener";
        a.className = "form-control-plaintext d-block";

        try {
          const r = await fetch(
            `${API_BASE}/form/file-url?key=${encodeURIComponent(key)}`
          );
          const j = await r.json();
          if (j?.ok && j.url) a.href = j.url;
        } catch {
          // keep text without href if presign fails
        }

        const ph = placeholders.get(field);
        if (ph) {
          ph.replaceWith(a);
        } else {
          const near = elFor(field);
          if (near && near.parentElement) near.parentElement.appendChild(a);
        }
      }

      showToast(
        payload.type === "submitted" ? "Viewing submission." : "Viewing draft."
      );
    } catch (err) {
      console.error("Error loading reader form:", err);
    }
  }

  /* -------------------- Form submit blocker in reader -------------------- */
  grantForm?.addEventListener("submit", (e) => {
    if (isReader) {
      e.preventDefault();
      showToast("Viewing only.");
    }
  });

  /* -------------------- Draft logic (edit mode) -------------------- */
  if (!isReader) {
    async function ensureToken() {
      let token = localStorage.getItem("draftToken");
      if (token) return token;
    
      const base = { step: currentStep };
      try {
        const { json } = await trySaveDraft(base);
        token = json?.token;
        if (token) localStorage.setItem("draftToken", token);
        return token;
      } catch (err) {
        console.error("ensureToken error:", err);
        throw err;
      }
    }

    function validateDraftMin() {
      const missing = [];
      let firstInvalid = null;
      DRAFT_MIN_REQUIRED.forEach((name) => {
        const el = elFor(name);
        if (!el) return;
        const val = (el.value || "").trim();
        const ok = name === "parent1.email" ? isEmail(val) : val.length > 0;
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

    // File upload handling
    document.querySelectorAll('input[type="file"]').forEach((input) => {
      input.addEventListener("change", async () => {
        const file = input.files[0];
        delete input.dataset.s3key;
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
          if (!res.ok) throw new Error("Signed URL failed");
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

    // Draft save
    window.saveStep = async function saveStep() {
      clearAllInvalid?.(); // si existe en tu archivo
    
      // validación mínima para permitir guardar
      const DRAFT_MIN_REQUIRED = ["parent1.firstName", "parent1.mobile", "parent1.email"];
      const missing = [];
      let firstInvalid = null;
      DRAFT_MIN_REQUIRED.forEach((name) => {
        const el = document.querySelector(`[name="${name}"]`);
        if (!el) return;
        const val = (el.value || "").trim();
        const ok = name === "parent1.email" ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val) : !!val;
        if (!ok) {
          missing.push(name);
          if (!firstInvalid) firstInvalid = el;
          el.classList?.add("is-invalid");
        }
      });
      if (missing.length) {
        showToast(`Please complete: ${missing.join(", ")} to save your draft.`);
        firstInvalid?.scrollIntoView({ behavior: "smooth", block: "center" });
        firstInvalid?.focus();
        return;
      }
    
      // construimos payload: campos + s3keys de file inputs
      const formData = new FormData(grantForm);
      document.querySelectorAll('input[type="file"]').forEach((input) => {
        if (formData.has(input.name)) formData.delete(input.name);
        if (input.dataset.s3key) formData.append(input.name, input.dataset.s3key);
      });
    
      // lo convertimos a objeto plano para poder enviar JSON o FormData
      const payload = {};
      formData.forEach((v, k) => (payload[k] = v));
      payload.step = currentStep;
    
      // si ya tenemos token, incluirlo
      const existingToken = localStorage.getItem("draftToken");
      if (existingToken) payload.token = existingToken;
    
      try {
        const { json } = await trySaveDraft(payload); // ← usa helper con fallbacks
    
        // guardar/actualizar token
        const tokenFromResp = json?.token || existingToken;
        if (json?.token) localStorage.setItem("draftToken", json.token);
    
        console.log("✅ Draft saved:", tokenFromResp);
        showToast("Draft saved.");
      } catch (err) {
        console.error("save-draft error:", err);
        showToast("Save draft failed.");
      }
    };

    // Final submit
    grantForm?.addEventListener("submit", async (e) => {
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
        if (!res.ok) throw new Error("Submit failed");
        localStorage.removeItem("draftToken");
        Object.keys(localStorage)
          .filter((k) => k.startsWith("resumeSent:"))
          .forEach((k) => localStorage.removeItem(k));
        currentStep = steps.length - 1; // thank you page
        showStep(currentStep);
        showToast("Submission received.");
      } catch (err) {
        console.error(err);
        showToast("Submission failed.");
      }
    });
  } else {
    // Reader stub
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
      // reader-only setup after DOM is ready
      if (submitBtn) submitBtn.style.display = "none";
      if (saveBtn) saveBtn.style.display = "none";
      document
        .querySelectorAll("input, textarea, select")
        .forEach((el) => (el.disabled = true));
      showAllReaderMode();
      await loadForReader();
      return;
    }

    // edit mode: if we just resumed, hydrate draft (cookie sent automatically)
    const params = new URLSearchParams(location.search);
    if (params.get("resumed")) {
      try {
        const res = await fetch(`${API_BASE}/resume/get-draft`, {
          method: "GET",
          credentials: "include",
        });
        if (!res.ok) throw new Error(`get-draft ${res.status}`);
        const payload = await res.json();

        // flatten nested data into dot-notation keys
        const flatten = (obj, prefix = "", res = {}) => {
          for (const [k, v] of Object.entries(obj)) {
            const key = prefix ? `${prefix}.${k}` : k;
            if (v && typeof v === "object" && !Array.isArray(v)) {
              flatten(v, key, res);
            } else {
              res[key] = v;
            }
          }
          return res;
        };
        const flat = flatten(payload);

        Object.entries(flat).forEach(([name, value]) => {
          const input = elFor(name);
          if (!input) return;
          if (input.type === "checkbox") {
            input.checked = Boolean(value);
          } else {
            input.value = value ?? "";
          }
        });

        if (typeof flat.step === "number") currentStep = flat.step;
      } catch (err) {
        console.error("Error loading draft:", err);
        showToast("Could not load your draft.");
      }
    }

    // Initialize NDIS toggle after any hydration so it reflects current value
    initNdisToggle();
    showStep(currentStep);
  });
})();