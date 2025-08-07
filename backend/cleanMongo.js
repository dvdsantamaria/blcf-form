// backend/cleanMongo.js
import "dotenv/config";
import mongoose from "mongoose";
import FormSubmission from "./models/FormSubmission.js";

await mongoose.connect(process.env.MONGO_URI);
await FormSubmission.deleteMany({});
console.log("🧨 Submissions wiped");
process.exit(0);
