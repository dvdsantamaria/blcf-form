// backend/server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";

import formRoutes from "./routes/form.js"; // asegurate que este archivo también use export default
import uploadRoutes from "./routes/upload.js";

dotenv.config();
const app = express();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rutas API
if (formRoutes) app.use("/api", formRoutes);
app.use("/api", uploadRoutes);

// DB + Server
mongoose
  .connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 })
  .then(() => {
    console.log("Connected to MongoDB Atlas");
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`BLCF backend running on port ${PORT}`));
  })
  .catch((err) => {
    console.error("Mongo connection error:", err);
    process.exit(1);
  });
