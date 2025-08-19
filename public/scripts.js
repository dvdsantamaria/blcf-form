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
    "ndis.notEligibleReason",
    "docs.diagnosisLetter",
    "docs.additionalLetterOptional",
    // Parent two full block (optional)
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

  const elFor = (name) => document.querySelector(`[name="${name}"]`);

  /* -------------------- Label decoration -------------------- */
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
      const yes = ndisSelect.value === "Yes";
      document
        .querySelectorAll(".yes-only")
        .forEach((el) => (el.style.display = yes ? "block" : "none"));
      document
        .querySelectorAll(".no-only")
        .forEach((el) => (el.style.display = yes ? "none" : "block"));
    };
  
    ndisSelect.addEventListener("change", toggle);
    toggle(); // estado inicial
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
  async function loadForReader() {
    try {
      const qs = new URLSearchParams(location.search);
      const token = qs.get("token");
      if (!token) return;

      const res = await fetch(
        `${API_BASE}/form/view?token=${encodeURIComponent(token)}`
      );
      if (!res.ok) return;

      const payload = await res.json();
      const data = payload?.data || {};

      // hydrate scalar fields (skip file)
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

      // replace each file input with a placeholder
      const placeholders = new Map();
      document.querySelectorAll('input[type="file"][name]').forEach((input) => {
        const holder = document.createElement("div");
        holder.className = "d-block";
        holder.dataset.field = input.name;
        holder.textContent = "No file uploaded";
        placeholders.set(input.name, holder);
        input.replaceWith(holder);
      });

      // inject signed links for uploaded files
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
              `${API_BASE}/form/file-url?key=${encodeURIComponent(key)}`
            );
            const j = await r.json();
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

  /* -------------------- Draft/Submit logic (edit mode) -------------------- */

  // flexible saver: tries multiple endpoints and formats
  async function trySaveDraft(payloadObj) {
    const endpoints = [
      `${API_BASE}/save-draft`,
      `${API_BASE}/form/save-draft`,
      `/api/form/save-draft`,
      `/save-draft`,
    ];

    // FormData fallback
    const fd = new FormData();
    Object.entries(payloadObj).forEach(([k, v]) => fd.append(k, v));

    let lastErr;

    for (const url of endpoints) {
      // try JSON
      try {
        const r1 = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payloadObj),
        });
        if (r1.ok) return { url, json: await r1.json() };

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

  // flexible presigner for uploads (GET with query or POST JSON) and endpoint fallbacks
  async function getSignedUrl(field, token, mime) {
    const qs = `field=${encodeURIComponent(field)}&token=${encodeURIComponent(
      token
    )}&type=${encodeURIComponent(mime)}`;

    const endpoints = [
      `${API_BASE}/generate-upload-url?${qs}`,
      `${API_BASE}/form/generate-upload-url?${qs}`,
      `/api/form/generate-upload-url?${qs}`,
      `/form/generate-upload-url?${qs}`,
    ];

    // also try POST JSON form for servers that require it
    const payload = { field, token, type: mime };

    // 1) try GETs
    for (const url of endpoints) {
      try {
        const r = await fetch(url, { method: "GET" });
        if (r.ok) return await r.json(); // { url, key }
      } catch {}
    }

    // 2) try POST JSON to same endpoints (drop query)
    for (const base of [
      `${API_BASE}/generate-upload-url`,
      `${API_BASE}/form/generate-upload-url`,
      `/api/form/generate-upload-url`,
      `/form/generate-upload-url`,
    ]) {
      try {
        const r = await fetch(base, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (r.ok) return await r.json();
      } catch {}
    }

    throw new Error("Signed URL failed");
  }

  if (!isReader) {
    async function ensureToken() {
      let token = localStorage.getItem("draftToken");
      if (token) return token;
      const base = { step: currentStep };
      const { json } = await trySaveDraft(base);
      token = json?.token;
      if (token) localStorage.setItem("draftToken", token);
      return token;
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

    // File upload handling (multi-file, max 5)
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
          if (!mime) {
            showToast("Unsupported file type.");
            return;
          }
          try {
            const token = await ensureToken();
            const { url, key } = await getSignedUrl(fieldName, token, mime);
            if (!url || !key) throw new Error("Signed URL failed");
            const up = await fetch(url, {
              method: "PUT",
              headers: { "Content-Type": mime },
              body: file,
            });
            if (!up.ok) throw new Error("Upload failed");
            s3keys.push(key);
          } catch (err) {
            console.error(err);
            showToast("Upload error.");
            return;
          }
        }

        if (s3keys.length) {
          // store both for compatibility
          input.dataset.s3keys = s3keys.join(",");
          input.dataset.s3key = s3keys.join(",");
          showToast("Files uploaded.");
        }
      });
    });

    // Draft save
    window.saveStep = async function saveStep() {
      clearAllInvalid();
      if (!validateDraftMin()) return;

      const formData = new FormData(grantForm);

      // replace file inputs with uploaded S3 keys (each as repeated field)
      document.querySelectorAll('input[type="file"]').forEach((input) => {
        if (formData.has(input.name)) formData.delete(input.name);
        const keys =
          (input.dataset.s3keys || input.dataset.s3key || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        keys.forEach((key) => formData.append(input.name, key));
      });

      formData.append("step", currentStep);
      const existingToken = localStorage.getItem("draftToken");
      if (existingToken) formData.append("token", existingToken);

      // send with flexible saver
      const payloadObj = {};
      formData.forEach((v, k) => {
        // allow multiple values per name by repeating; the saver handles FormData
        if (payloadObj[k] !== undefined) {
          if (Array.isArray(payloadObj[k])) payloadObj[k].push(v);
          else payloadObj[k] = [payloadObj[k], v];
        } else {
          payloadObj[k] = v;
        }
      });
      try {
        const { json } = await trySaveDraft(payloadObj);
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

      // attach each S3 key individually instead of File
      document.querySelectorAll('input[type="file"]').forEach((input) => {
        if (formData.has(input.name)) formData.delete(input.name);
        const keys =
          (input.dataset.s3keys || input.dataset.s3key || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        keys.forEach((key) => formData.append(input.name, key));
      });

      const existingToken = localStorage.getItem("draftToken");
      if (existingToken) formData.append("token", existingToken);

      try {
        const res = await fetch(`${API_BASE}/form/submit-form`, {
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
      showAllReaderMode();
      document
        .querySelectorAll("input, textarea, select")
        .forEach((el) => (el.disabled = true));
      await loadForReader();
      return;
    }
    initNdisToggle();
    showStep(currentStep);
  });
})();