import { redirect } from "next/navigation";

// Middleware routes authenticated users to their role home and everyone else to
// /login. This is a safety fallback if middleware is bypassed.
export default function Home() {
  redirect("/login");
}
