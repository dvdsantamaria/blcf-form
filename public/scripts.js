const API_BASE = "/api";

let currentStep = 0;
const steps = document.querySelectorAll(".step");
const submitBtn = document.getElementById("submitBtn");

function showStep(n) {
  steps.forEach((s, i) => s.classList.toggle("active", i === n));
  document.querySelector('button[onclick="nextStep(-1)"]').style.display =
    n === 0 || n === steps.length - 1 ? "none" : "inline-block";
  document.querySelector('button[onclick="nextStep(1)"]').style.display =
    n >= steps.length - 2 ? "none" : "inline-block";
  submitBtn.style.display = n === steps.length - 2 ? "inline-block" : "none";
}

function nextStep(n) {
  currentStep += n;
  if (currentStep >= 0 && currentStep < steps.length) showStep(currentStep);
}
showStep(currentStep);

async function saveStep() {
  const form = document.getElementById("grantForm");
  const formData = new FormData(form);

  document.querySelectorAll('input[type="file"]').forEach((input) => {
    const key = input.dataset.s3key;
    if (key) formData.append(`${input.name || "file"}`, key);
  });

  formData.append("step", currentStep);

  // reuse token if exists
  const existingToken = localStorage.getItem("draftToken");
  if (existingToken) formData.append("token", existingToken);

  try {
    const resp = await fetch(`${API_BASE}/save-draft`, {
      method: "POST",
      body: formData,
    });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`save-draft ${resp.status}: ${txt}`);
    }
    const json = await resp.json();
    if (json?.token) localStorage.setItem("draftToken", json.token);
    alert("Draft saved successfully.");
  } catch (err) {
    console.error(err);
    alert("Error saving draft.");
  }
}

document.querySelectorAll('input[type="file"]').forEach((input) => {
  input.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const label = input.previousElementSibling?.innerText || "file";
    const fieldName = label.toLowerCase().replace(/\s+/g, "_");

    const ext = (file.name.split(".").pop() || "").toLowerCase();
    const mimeFallbackByExt = {
      pdf: "application/pdf",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
      heic: "image/heic",
      heif: "image/heic",
    };
    const mime =
      file.type && file.type.trim() !== ""
        ? file.type
        : mimeFallbackByExt[ext] || "";

    if (!mime) {
      alert("Formato no soportado o desconocido.");
      return;
    }

    try {
      // 1) presigned URL
      const res = await fetch(
        `${API_BASE}/generate-upload-url?field=${encodeURIComponent(
          fieldName
        )}&type=${encodeURIComponent(mime)}`
      );
      if (!res.ok) throw new Error("No se pudo generar la URL firmada");
      const { url, key } = await res.json();

      // 2) direct upload to S3
      const uploadRes = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": mime },
        body: file,
      });

      if (uploadRes.ok) {
        input.dataset.s3key = key;
        console.log(`Uploaded to S3: ${key}`);
      } else {
        console.error("Upload failed");
        alert("Upload failed.");
      }
    } catch (err) {
      console.error("Upload error:", err);
      alert("Upload error.");
    }
  });
});

document.getElementById("grantForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const formData = new FormData(form);

  document.querySelectorAll('input[type="file"]').forEach((input) => {
    const key = input.dataset.s3key;
    if (key) formData.append(`${input.name || "file"}`, key);
  });

  // send token so backend finalizes same draft
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
    } else {
      alert("Submission failed.");
    }
  } catch (err) {
    console.error("❌ Submit error:", err);
    alert("Submission failed.");
  }
});
