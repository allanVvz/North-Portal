// Backend de IA para desenvolvimento e para o e2e do fluxo de conversão —
// chama a CLI `claude` em modo print (`-p`), em vez da Messages API da
// Anthropic. Ativado só por `AI_CLI=1`; produção (Vercel) nunca tem o binário
// nem essa env, então `aiComplete` segue pela chave normal lá.
//
// O prompt do usuário vai por STDIN, nunca como argumento: é texto arbitrário
// (comentário de gestor) e no Windows o spawn de um `.cmd` exige `shell:true`,
// que não escapa argumentos. O system prompt vai num arquivo temporário
// (`--append-system-prompt-file`) — o único argumento "dinâmico", e mora em
// `os.tmpdir()`.

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function runClaude(bin: string, args: string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      timeout: 90_000,
      windowsHide: true,
      shell: process.platform === "win32", // .cmd exige shell no Windows (Node ≥ 20)
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`CLI claude saiu com código ${code}: ${err.slice(0, 500)}`));
    });
    child.stdin.write(input);
    child.stdin.end();
  });
}

export async function aiCompleteViaCli({ system, user }: { system: string; user: string }): Promise<string> {
  const bin = process.env.AI_CLI_BIN || (process.platform === "win32" ? "claude.cmd" : "claude");
  const model = process.env.AI_MODEL || "sonnet";
  const dir = await mkdtemp(join(tmpdir(), "aicli-"));
  const sysFile = join(dir, "system.txt");
  try {
    await writeFile(sysFile, system, "utf8");
    const stdout = await runClaude(
      bin,
      ["-p", "--append-system-prompt-file", sysFile, "--model", model, "--strict-mcp-config"],
      user,
    );
    return stdout.trim();
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
