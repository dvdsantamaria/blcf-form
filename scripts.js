let currentStep = 0;
const steps = document.querySelectorAll(".step");
const submitBtn = document.getElementById("submitBtn");

function showStep(n) {
  steps.forEach((s, i) => s.classList.toggle("active", i === n));
  document.querySelector('button[onclick="nextStep(-1)"]').style.display =
    n === 0 ? "none" : "inline-block";
  document.querySelector('button[onclick="nextStep(1)"]').style.display =
    n === steps.length - 1 ? "none" : "inline-block";
  submitBtn.style.display = n === steps.length - 1 ? "inline-block" : "none";
}
function nextStep(n) {
  currentStep += n;
  if (currentStep >= 0 && currentStep < steps.length) showStep(currentStep);
}
showStep(currentStep);
