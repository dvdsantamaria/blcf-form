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

function saveStep() {
  const form = document.getElementById("grantForm");
  const formData = new FormData(form);

  document.querySelectorAll('input[type="file"]').forEach((input) => {
    const key = input.dataset.s3key;
    if (key) {
      formData.append(`${input.name || "file"}`, key);
    }
  });

  formData.append("step", currentStep);

  fetch(`${API_BASE}/save-draft`, {
    method: "POST",
    body: formData,
  })
    .then((res) => res.json())
    .then(() => {
      alert("Draft saved successfully.");
    })
    .catch((err) => {
      console.error(err);
      alert("Error saving draft.");
    });
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
      const res = await fetch(
        `${API_BASE}/generate-upload-url?field=${encodeURIComponent(
          fieldName
        )}&type=${encodeURIComponent(mime)}`
      );
      if (!res.ok) throw new Error("No se pudo generar la URL firmada");
      const { url, key } = await res.json();

      const uploadRes = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": mime },
        body: file,
      });

      if (uploadRes.ok) {
        input.dataset.s3key = key;

        const token = localStorage.getItem("draftToken") || "";
        try {
          await fetch(`${API_BASE}/register-upload`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              key,
              label: fieldName,
              originalName: file.name,
              fileType: mime,
              token,
            }),
          });
        } catch (e) {
          console.warn("Register metadata failed", e);
        }

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
    if (key) {
      formData.append(`${input.name || "file"}`, key);
    }
  });

  try {
    const res = await fetch(`${API_BASE}/submit-form`, {
      method: "POST",
      body: formData,
    });

    if (res.ok) {
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
