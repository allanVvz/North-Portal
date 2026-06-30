const slug = process.argv[2] ?? "north";
const name = process.argv[3] ?? "ADM NORTH";
const baseUrl = process.env.PORTAL_BASE_URL ?? "http://localhost:3000";
const token = process.env.NORTH_ADMIN_TOKEN;
if (!token) throw new Error("NORTH_ADMIN_TOKEN is required.");

const response = await fetch(`${baseUrl}/api/admin/client/${slug}`, {
  method: "PATCH",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ name, is_active: true }),
});

console.log(response.status, await response.text());
