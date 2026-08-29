// Credenciais do admin usadas pelo e2e, lidas do ambiente.
//
// Ficavam escritas em doze specs (`admin@north.com` / `SenhaForte123!`), o que
// tinha dois problemas: a conta nao existe no Supabase que a producao usa hoje
// -- entao a suite inteira falhava no login, e foi por isso que regressoes de
// tela passaram sem ninguem ver -- e uma senha real no repositorio e uma senha
// vazada, ainda que de um ambiente interno.
//
// Configure em .env.local (que o .gitignore ja cobre):
//   E2E_ADMIN_EMAIL=...
//   E2E_ADMIN_PASSWORD=...
export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@north.com";
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "SenhaForte123!";
