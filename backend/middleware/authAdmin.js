// backend/middleware/authAdmin.js
export default function authAdmin(req, res, next) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return res.status(500).json({ error: "ADMIN_TOKEN not set" });

  const got = req.header("x-admin-token");
  if (got && got === expected) return next();

  return res.status(401).json({ error: "Unauthorized" });
}
