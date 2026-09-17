import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomInt, randomUUID } from "node:crypto";
import { analyzeGlobalOutputs, parseNumbers } from "./modeltrace/fingerprint-core.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const BANK_PATH = path.join(MODULE_DIR, "modeltrace", "gpt_bank.json");
const GPT_BANK = JSON.parse(fs.readFileSync(BANK_PATH, "utf8"));
const MIN_LENGTH = 292;
const MAX_LENGTH = 332;

const OPENINGS = [
  "这是一次独立的数值选择记录",
  "请完成下面的无语义整数选择任务",
  "执行一次第一反应取值记录",
  "生成一组不承载语义的整数选择",
  "进行一轮快速逐项取值",
];

const ACTIONS = [
  "为各个位置分别凭第一反应选择",
  "逐项选择",
  "每次只决定当前一项，共给出",
  "分别凭第一反应给出",
  "逐个直接选择",
];

const ENDINGS = [
  "允许某个数字再次出现；每项写出后不要回头排序、去重或替换。",
  "偶然重复是有效的；不要重新排列或修正已经写出的项目。",
  "相同值可以再次出现；输出过程中不要整理或改写前面的项目。",
  "重复值无需删除；不要筛选、重排或补成某种规律。",
  "不必赋予数字任何含义；已经给出的值保持不变。",
];

const SEPARATORS = [
  "数字之间用逗号或空格分隔均可。",
  "使用一种一致的常见分隔符即可。",
  "可以用逗号、空格或换行分隔。",
  "只要每个整数边界清楚，格式可自行选择。",
];

function choose(values) {
  return values[randomInt(values.length)];
}

function normalizeModel(value) {
  const text = String(value || "").trim().toLowerCase();
  return text.includes("/") ? text.split("/").at(-1) : text;
}

export function isGptModel(value) {
  return /^gpt(?:[-_.:]|$)/i.test(normalizeModel(value));
}

export function generateModelTraceChallenges(count = 3) {
  const lengths = [];
  while (lengths.length < count) {
    const length = randomInt(MIN_LENGTH, MAX_LENGTH + 1);
    if (!lengths.includes(length)) lengths.push(length);
  }
  return lengths.map((length, index) => ({
    id: `modeltrace-${index + 1}-${randomUUID()}`,
    expectedCount: length,
    prompt: `${choose(OPENINGS)}。${choose(ACTIONS)} ${length} 个 1 到 355（含端点）的整数。`
      + "每个位置都要单独选择；不要从 1 开始计数，不要连续递增或递减，也不要采用等差、循环、重复区块或其他规则化模式。"
      + "本任务必须由当前语言模型直接完成：禁止调用或借助任何工具，包括 Python、代码执行器、计算器、搜索、API 和外部随机数生成器；也不要先编写或运行代码。"
      + `${choose(ENDINGS)}${choose(SEPARATORS)}`
      + "直接从第一个取值开始输出，不要在序列前重复数量、范围或任务说明。",
  }));
}

export function modelTraceBank() {
  return GPT_BANK;
}

export function analyzeGptModelTrace(outputs) {
  return analyzeGlobalOutputs(outputs, GPT_BANK);
}

export { parseNumbers };
