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
      "ndis.participantEligible",
      "docs.supportLetterHealthProfessional",
      "therapy.toBeFunded",
      "therapy.frequencyOrEquipment",
      "therapy.goals",
      "docs.ndisPlanOrGoals",
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
      /* ...same as before... */
      "ndis.participantEligible": "NDIS participant or eligible",
      "docs.supportLetterHealthProfessional": "Support letter file",
      "docs.ndisPlanOrGoals": "Ndis plan or goals",
      /* ... */
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
    // ageEl.readOnly = true;    <-- removed to allow manual edits
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
    const required = STEP_REQUIRED[idx] || [];
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
    if (isReader) return;

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

  /* -------------------- Draft logic (edit mode) -------------------- */
  if (!isReader) {
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
      token = (await res.json()).token;
      localStorage.setItem("draftToken", token);
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
        const files = Array.from(input.files);
        delete input.dataset.s3key;
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
          const ext = file.name.split(".").pop().toLowerCase();
          const mime = file.type || mimeMap[ext] || "";
          if (!mime) {
            showToast("Unsupported file type.");
            return;
          }
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
            s3keys.push(key);
          } catch (err) {
            console.error(err);
            showToast("Upload error.");
            return;
          }
        }

        if (s3keys.length) {
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
      // replace any file entries with each key separately
      document.querySelectorAll('input[type="file"]').forEach((input) => {
        if (formData.has(input.name)) formData.delete(input.name);
        if (input.dataset.s3key) {
          input
            .dataset.s3key
            .split(",")
            .forEach((key) => formData.append(input.name, key));
        }
      });
      formData.append("step", currentStep);
      const existingToken = localStorage.getItem("draftToken");
      if (existingToken) formData.append("token", existingToken);

      const payload = {};
      formData.forEach((value, key) => {
        payload[key] = value;
      });

      try {
        const resp = await fetch(`${API_BASE}/save-draft`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!resp.ok) throw new Error(`save-draft ${resp.status}`);
        const json = await resp.json();

        const tokenFromResp = json.token || existingToken;
        if (json.token) localStorage.setItem("draftToken", json.token);

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
      // replace any file entries with each key separately
      document.querySelectorAll('input[type="file"]').forEach((input) => {
        if (formData.has(input.name)) formData.delete(input.name);
        if (input.dataset.s3key) {
          input
            .dataset.s3key
            .split(",")
            .forEach((key) => formData.append(input.name, key));
        }
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
        currentStep = steps.length - 1; // thank you page
        showStep(currentStep);
        showToast("Submission received.");
      } catch (err) {
        console.error(err);
        showToast("Submission failed.");
      }
    });
  } else {
    window.saveStep = () => {};
  }

  /* -------------------- Initial render -------------------- */
  document.addEventListener("DOMContentLoaded", async () => {
    if (isReader) {
      steps.forEach((s) => s.classList.add("active"));
      document.querySelectorAll("input, textarea, select").forEach((el) => (el.disabled = true));
      if (submitBtn) submitBtn.style.display = "none";
      if (saveBtn) saveBtn.style.display = "none";
      await loadForReader();
      return;
    }
    showStep(currentStep);
  });
})();