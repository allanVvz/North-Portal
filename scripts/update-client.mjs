const slug = process.argv[2];
if (!slug) throw new Error("Use: npm run update:client -- <slug> '<json>'");

const payload = process.argv[3] ? JSON.parse(process.argv[3]) : {};
const baseUrl = process.env.PORTAL_BASE_URL ?? "http://localhost:3000";
const token = process.env.NORTH_ADMIN_TOKEN;
if (!token) throw new Error("NORTH_ADMIN_TOKEN is required.");

const response = await fetch(`${baseUrl}/api/admin/client/${slug}`, {
  method: "PATCH",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});

console.log(response.status, await response.text());
