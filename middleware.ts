import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Routes reachable without a session.
const PUBLIC_PREFIXES = ["/login", "/logout", "/api/auth", "/auth"];

function isPublic(pathname: string) {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/") || pathname === p);
}

export async function middleware(request: NextRequest) {
  const { user, response } = await updateSession(request);
  const { pathname } = request.nextUrl;

  // API routes authenticate themselves in their handlers; just refresh session.
  if (pathname.startsWith("/api/")) return response;

  const role = (user?.app_metadata?.role as string | undefined) ?? undefined;
  const clientSlug = (user?.app_metadata?.client_slug as string | undefined) ?? undefined;

  const homeFor = (r?: string, slug?: string) =>
    r === "admin" ? "/admin" : slug ? `/${slug}` : "/login";

  // Public pages: send logged-in users to their home.
  if (isPublic(pathname)) {
    if (user && (pathname === "/login" || pathname === "/")) {
      return NextResponse.redirect(new URL(homeFor(role, clientSlug), request.url));
    }
    return response;
  }

  // Everything below requires a session.
  if (!user) {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Root → role home.
  if (pathname === "/") {
    return NextResponse.redirect(new URL(homeFor(role, clientSlug), request.url));
  }

  // Admin area requires admin role.
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    if (role !== "admin") {
      return NextResponse.redirect(new URL(homeFor(role, clientSlug), request.url));
    }
    return response;
  }

  // Client portal: a client may only open their own slug; admins may open any.
  const slug = pathname.split("/").filter(Boolean)[0];
  if (role === "client" && clientSlug && slug !== clientSlug) {
    return NextResponse.redirect(new URL(`/${clientSlug}`, request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
