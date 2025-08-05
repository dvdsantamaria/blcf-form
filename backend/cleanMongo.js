import mongoose from "mongoose";
import Submission from "./models/Submission.js"; // asegurate de tener este modelo

await mongoose.connect(process.env.MONGO_URI);
await Submission.deleteMany({});
await mongoose.disconnect();
console.log("MongoDB submissions collection cleaned.");
