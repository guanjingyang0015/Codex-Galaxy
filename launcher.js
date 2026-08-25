export function buildResumeArgs(threadId, model) {
  if (!threadId) throw new Error("线程 ID 不能为空。");
  const args = ["resume", String(threadId)];
  const selectedModel = String(model || "").trim();
  if (selectedModel) args.push("--model", selectedModel);
  return args;
}

function quote(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`;
}

export function formatResumeCommand(threadId, model) {
  return ["codex", "resume", quote(threadId), ...(model ? ["--model", quote(model)] : [])].join(" ");
}

function posixQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

export function buildMacTerminalArgs(cli, args, cwd) {
  const command = `cd -- ${posixQuote(cwd)} && ${[cli, ...args].map(posixQuote).join(" ")}`;
  const appleScriptCommand = command.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return [
    "-e", `tell application "Terminal" to do script "${appleScriptCommand}"`,
    "-e", 'tell application "Terminal" to activate',
  ];
}

export function waitForSpawn(child) {
  return new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
}
