// public/scripts.js (refactor Aug-2025)
// All logic in one IIFE. Comments concise, English, no fancy punctuation.

(() => {
  "use strict";

  /* -------------------- Globals -------------------- */
  const API_BASE = "/api";
  const isReader = new URLSearchParams(location.search).get("mode") === "reader";

  let currentStep = 0;
  const steps = document.querySelectorAll(".step");
  const submitBtn = document.getElementById("submitBtn");
  const saveBtn = document.getElementById("saveDraftBtn");
  const grantForm = document.getElementById("grantForm");

  /* -------------------- Optional fields -------------------- */
  const OPTIONAL_FIELDS = new Set([
    "ndis.notEligibleReason",
    "ndis.moreSupportWhy",
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
      "ndis.participantEligible",
      "docs.ndisCommunication",
      "docs.supportLetterHealthProfessional",
      "therapy.toBeFunded",
      "therapy.frequencyOrEquipment",
      "therapy.goals",
      "therapy.noGrantImpact",
      "docs.diagnosisLetter",
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
  const isEmail = v => !!v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

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
    document.querySelectorAll(".is-invalid").forEach(el => {
      el.classList.remove("is-invalid");
      el.removeAttribute("aria-invalid");
    });
  const clearInvalid = container =>
    container.querySelectorAll(".is-invalid").forEach(el => {
      el.classList.remove("is-invalid");
      el.removeAttribute("aria-invalid");
    });
  const markInvalid = el => {
    el.classList.add("is-invalid");
    el.setAttribute("aria-invalid", "true");
    const remove = () => el.classList.remove("is-invalid");
    el.addEventListener("input", remove, { once: true });
    el.addEventListener("change", remove, { once: true });
  };

  const readableName = name => {
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
      "ndis.participantEligible": "NDIS participant or eligible",
      "docs.ndisCommunication": "NDIS communication file",
      "docs.supportLetterHealthProfessional": "Support letter file",
      "therapy.toBeFunded": "Therapies to be funded",
      "therapy.frequencyOrEquipment": "Frequency or equipment",
      "therapy.goals": "Therapy goals",
      "therapy.noGrantImpact": "Impact if no grant",
      "docs.diagnosisLetter": "Diagnosis letter file",
      "consent.terms": "Privacy and terms",
      "consent.truth": "Information correct",
      "consent.report": "Final report",
      "consent.media": "Image permission",
    };
    return map[name] || name;
  };

  /* -------------------- Label decoration -------------------- */
  const elFor = name => document.querySelector(`[name="${name}"]`);
  (function decorateLabels() {
    OPTIONAL_FIELDS.forEach(name => {
      const el = elFor(name);
      if (!el) return;
      let label = el.previousElementSibling?.tagName === "LABEL"
        ? el.previousElementSibling
        : document.querySelector(`label[for="${el.id}"]`);
      if (label && !/(optional)/i.test(label.textContent))
        label.innerHTML = `${label.innerHTML} <span class="text-muted">(optional)</span>`;
    });
    Object.keys(STEP_REQUIRED).forEach(k => {
      STEP_REQUIRED[k].forEach(name => {
        if (OPTIONAL_FIELDS.has(name)) return;
        const el = elFor(name);
        if (!el) return;
        let label = el.previousElementSibling?.tagName === "LABEL"
          ? el.previousElementSibling
          : document.querySelector(`label[for="${el.id}"]`);
        if (label && !/\*\s*$/.test(label.textContent))
          label.innerHTML = `${label.innerHTML} <span class="text-danger">*</span>`;
      });
    });
  })();

  /* -------------------- Age autofill -------------------- */
  const parseYMD = s => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  };
  const calcAge = d => {
    if (!(d instanceof Date) || isNaN(d)) return "";
    const now = new Date();
    let y = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) y--;
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
    ["input","change","blur"].forEach(evt => dobEl.addEventListener(evt, ensureAgeFromDob));
    ensureAgeFromDob();
  })();

  /* -------------------- Validation -------------------- */
  function isCheckbox(name) {
    const el = elFor(name); return el && el.type === "checkbox";
  }
  function isFile(name) {
    const el = elFor(name); return el && el.type === "file";
  }
  function validateStep(idx) {
    ensureAgeFromDob(); clearInvalid(steps[idx]);
    const missing = []; let firstInvalid = null;
    (STEP_REQUIRED[idx] || []).forEach(name => {
      if (OPTIONAL_FIELDS.has(name)) return;
      const el = elFor(name); if (!el) return;
      if (isCheckbox(name)) {
        if (!el.checked) { missing.push(readableName(name)); markInvalid(el); firstInvalid ||= el; }
        return;
      }
      if (isFile(name)) {
        if (!el.dataset.s3key) { missing.push(readableName(name)); markInvalid(el); firstInvalid ||= el; }
        return;
      }
      const val = (el.value||"").trim();
      if (name==="parent1.email" ? !isEmail(val) : !val) { missing.push(readableName(name)); markInvalid(el); firstInvalid ||= el; }
    });
    if (missing.length) {
      showToast(`Please complete: ${missing.join(', ')}.`);
      firstInvalid?.scrollIntoView({behavior:'smooth',block:'center'}); firstInvalid?.focus();
      return false;
    }
    return true;
  }
  const validateAllBeforeSubmit = () => {
    for (let i=0; i<steps.length-1; i++) if (!validateStep(i)) { currentStep = i; showStep(i); return false; }
    return true;
  };

  /* -------------------- Navigation -------------------- */
  function showStep(n) {
    if (isReader) return;
    steps.forEach((s,i) => s.classList.toggle('active',i===n));
    document.querySelector('button[onclick="nextStep(-1)"]').style.display = n===0||n===steps.length-1?'none':'inline-block';
    document.querySelector('button[onclick="nextStep(1)"]').style.display = n>=steps.length-2?'none':'inline-block';
    submitBtn.style.display = n===steps.length-2?'inline-block':'none';
    saveBtn.style.display = n<steps.length-2?'inline-block':'none';
  }
  window.nextStep = dir => { if (!isReader&&dir===1&&!validateStep(currentStep)) return; currentStep+=dir; showStep(currentStep); };

  /* -------------------- Reader mode -------------------- */
  function showAllReaderMode() {
    steps.forEach(s => s.classList.add('active'));
    ['button[onclick="nextStep(-1)"]','button[onclick="nextStep(1)"]'].forEach(sel => document.querySelector(sel).style.display='none');
    submitBtn.style.display='none'; saveBtn.style.display='none';
  }
  if (isReader) {
    document.querySelectorAll('input,textarea,select').forEach(el=>el.disabled=true); showAllReaderMode();
  }

  /* -------------------- Form submit blocker in reader -------------------- */
  grantForm?.addEventListener('submit',e=>{ if(isReader){ e.preventDefault(); showToast('Viewing only.'); }});

  /* -------------------- Load data for reader -------------------- */
  (async function loadForReader(){
    if(!isReader) return;
    try{
      const qs = new URLSearchParams(location.search);
      const token = qs.get('token'); if(!token) return;
      const res = await fetch(`/api/form/view?token=${encodeURIComponent(token)}`);
      if(!res.ok) return;
      const payload = await res.json(); const data = payload?.data||{};
      Object.entries(data).forEach(([name,value])=>{
        const input = elFor(name); if(!input) return;
        switch(input.type){
          case 'checkbox': input.checked = !!value; break;
          case 'radio': const r=document.querySelector(`input[name="${name}"][value="${value}"]`); if(r) r.checked=true; break;
          default: input.value=value||'';
        }
      });
      showToast(payload.type==='submitted'?'Viewing submission.':'Viewing draft.');
    }catch(err){ console.error('Error loading reader form:',err); }
  })();

  /* -------------------- Draft logic (edit mode) -------------------- */
  if(!isReader){
    async function ensureToken(){
      let token = localStorage.getItem('draftToken'); if(token) return token;
      const fd=new FormData(); fd.append('step',currentStep);
      const r=await fetch(`${API_BASE}/save-draft`,{method:'POST',body:fd}); if(!r.ok) throw new Error(`save-draft ${r.status}`);
      token=(await r.json()).token; localStorage.setItem('draftToken',token); return token;
    }
    function validateDraftMin(){
      const missing=[]; let firstInvalid=null;
      DRAFT_MIN_REQUIRED.forEach(name=>{
        const el=elFor(name); if(!el) return;
        const val=(el.value||'').trim();
        const ok=name==='parent1.email'?isEmail(val):!!val;
        if(!ok){ missing.push(readableName(name)); markInvalid(el); firstInvalid||=el; }
      });
      if(missing.length){ showToast(`Please complete: ${missing.join(', ')} to save your draft.`);
