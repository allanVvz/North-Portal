import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { HttpError } from "./validation";

export function apiError(error: unknown) {
  if (error instanceof HttpError) {
    return NextResponse.json({ error: error.message, ...(error.details ?? {}) }, { status: error.status });
  }
  if (error instanceof ZodError) {
    return NextResponse.json({ error: "Dados invalidos." }, { status: 400 });
  }
  console.error("Unhandled API error", error);
  return NextResponse.json({ error: "Nao foi possivel concluir a solicitacao." }, { status: 500 });
}

export async function safeTokenEquals(expected: string, received: string) {
  if (!expected || !received) return false;
  const encoder = new TextEncoder();
  const left = encoder.encode(expected);
  const right = encoder.encode(received);
  if (left.length !== right.length) return false;
  const key = await crypto.subtle.importKey("raw", left, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expectedSig = await crypto.subtle.sign("HMAC", key, left);
  const receivedSig = await crypto.subtle.sign("HMAC", key, right);
  return bytesEqual(new Uint8Array(expectedSig), new Uint8Array(receivedSig));
}

function bytesEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index];
  return diff === 0;
}
