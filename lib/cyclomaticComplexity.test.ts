import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

function functionComplexity(file: string, functionName: string): number {
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let target: ts.FunctionDeclaration | undefined;
  source.forEachChild((node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === functionName) target = node;
  });
  if (!target) throw new Error(`Função ${functionName} não encontrada em ${file}`);

  let complexity = 1;
  function visit(node: ts.Node) {
    if (node !== target && ts.isFunctionLike(node)) return;
    if (
      ts.isIfStatement(node) ||
      ts.isForStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isForOfStatement(node) ||
      ts.isWhileStatement(node) ||
      ts.isDoStatement(node) ||
      ts.isCatchClause(node) ||
      ts.isConditionalExpression(node) ||
      (ts.isCaseClause(node) && node.statements.length > 0)
    ) complexity += 1;
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) {
      complexity += 1;
    }
    ts.forEachChild(node, visit);
  }
  visit(target);
  return complexity;
}

describe("limite de complexidade ciclomática do núcleo de tarefas", () => {
  const cases = [
    ["lib/recurrence.ts", "nextRecurringDueDate", 8],
    ["lib/recurrence.ts", "recurringExecutionFields", 5],
    ["lib/supabase.ts", "listRecurringTasks", 12],
    ["lib/supabase.ts", "listActionPlans", 12],
    ["lib/supabase.ts", "completeTaskCycle", 12],
  ] as const;

  it.each(cases)("mantém %s:%s abaixo de %i caminhos", (relativeFile, functionName, maximum) => {
    const file = path.join(process.cwd(), relativeFile);
    expect(functionComplexity(file, functionName), `${relativeFile}:${functionName}`).toBeLessThanOrEqual(maximum);
  });
});
