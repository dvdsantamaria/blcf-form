import mongoose from "mongoose";
import Submission from "./src/models/Submission.js"; // ← ajustá la ruta

await mongoose.connect(process.env.MONGO_URI);
await Submission.deleteMany({});
console.log("Submissions wiped");
process.exit(0);
