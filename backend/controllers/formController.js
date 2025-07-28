import FormSubmission from "../models/FormSubmission.js";
import FormDraft from "../models/FormDraft.js";

export const handleFormSubmission = async (req, res) => {
  try {
    const submission = new FormSubmission({
      step: null,
      data: req.body,
    });
    await submission.save();
    res.status(200).json({ message: "Formulario recibido y guardado." });
  } catch (err) {
    console.error("Error al guardar:", err);
    res.status(500).json({ error: "Error al guardar el formulario." });
  }
};

export const saveDraft = async (req, res) => {
  try {
    const draft = new FormDraft({
      data: req.body,
    });
    await draft.save();
    res.status(200).json({ message: "Borrador guardado correctamente." });
  } catch (err) {
    console.error("Error al guardar borrador:", err);
    res.status(500).json({ error: "Error al guardar el borrador." });
  }
};
