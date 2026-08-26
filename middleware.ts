import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Routes reachable without a session (the public marketing site + auth).
const PUBLIC_PREFIXES = [
  "/",
  "/lp",
  "/login",
  "/logout",
  "/api/auth",
  "/auth",
  "/planos",
  "/como-funciona",
  "/quem-somos",
  "/politica-de-privacidade",
  "/termos-de-uso",
  "/politica-de-cookies",
  "/recuperar-senha",
];

function isPublic(pathname: string) {
  return PUBLIC_PREFIXES.some((p) => pathname === p || (p !== "/" && pathname.startsWith(p + "/")));
}

export async function middleware(request: NextRequest) {
  const { user, response } = await updateSession(request);
  const { pathname } = request.nextUrl;

  // API routes authenticate themselves in their handlers; just refresh session.
  if (pathname.startsWith("/api/")) return response;

  const role = (user?.app_metadata?.role as string | undefined) ?? undefined;
  const clientSlug = (user?.app_metadata?.client_slug as string | undefined) ?? undefined;

  const homeFor = (r?: string, slug?: string) =>
    r === "admin" ? "/admin/home" : slug ? `/${slug}` : "/login";

  // Public pages: "/" always shows the landing page, even for logged-in users
  // (they can navigate to their area via the header). Only /login redirects
  // away when already authenticated, since the form is moot at that point.
  if (isPublic(pathname)) {
    if (user && pathname === "/login") {
      return NextResponse.redirect(new URL(homeFor(role, clientSlug), request.url));
    }
    return response;
  }

  // Everything below requires a session.
  if (!user) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
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
