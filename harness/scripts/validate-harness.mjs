#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const harnessDirectory = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repositoryRoot = resolve(harnessDirectory, "..");
const tasksDirectory = join(repositoryRoot, "tasks");
const errors = [];

function fail(message) {
  errors.push(message);
}

function parseScalar(raw) {
  const value = raw.trim();
  if (value === "null") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^\d+$/.test(value)) return Number(value);
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function parseInlineList(raw) {
  const inner = raw.slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(",").map((item) => parseScalar(item));
}

function parseFrontMatter(content, source) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) {
    fail(`${source}: missing YAML front matter`);
    return { data: {}, body: content };
  }

  const data = {};
  const lines = match[1].split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const field = line.match(/^([a-z][a-z0-9_]*):(?:\s*(.*))?$/);
    if (!field) {
      fail(`${source}: unsupported front-matter line "${line}"`);
      continue;
    }

    const [, key, raw = ""] = field;
    if (Object.hasOwn(data, key)) {
      fail(`${source}: duplicate front-matter field ${key}`);
      continue;
    }

    if (raw.startsWith("[") && raw.endsWith("]")) {
      data[key] = parseInlineList(raw);
      continue;
    }

    if (raw !== "") {
      data[key] = parseScalar(raw);
      continue;
    }

    const values = [];
    while (index + 1 < lines.length) {
      const item = lines[index + 1].match(/^\s{2}-\s+(.+)$/);
      if (!item) break;
      values.push(parseScalar(item[1]));
      index += 1;
    }
    data[key] = values;
  }

  return { data, body: content.slice(match[0].length) };
}

function ensureEnum(source, field, value, allowed) {
  if (!allowed.includes(value)) {
    fail(`${source}: ${field} must be one of ${allowed.join(", ")}; received ${String(value)}`);
  }
}

const requiredFields = [
  "id",
  "title",
  "status",
  "priority",
  "size",
  "type",
  "dependencies",
  "owner",
  "reviewer",
  "requires_human",
  "architecture_required",
  "prd_references",
  "definition_of_done",
];

const taskFiles = readdirSync(tasksDirectory)
  .filter((file) => /^T-\d{3}-.+\.md$/.test(file))
  .sort();

const tasks = new Map();

for (const file of taskFiles) {
  const source = join("tasks", file);
  const content = readFileSync(join(tasksDirectory, file), "utf8");
  const { data, body } = parseFrontMatter(content, source);

  for (const field of requiredFields) {
    if (!Object.hasOwn(data, field)) fail(`${source}: missing required field ${field}`);
  }

  if (!/^T-\d{3}$/.test(data.id ?? "")) fail(`${source}: invalid task id ${String(data.id)}`);
  if (!file.startsWith(`${data.id}-`)) fail(`${source}: filename does not match id ${String(data.id)}`);
  if (tasks.has(data.id)) fail(`${source}: duplicate task id ${data.id}`);

  ensureEnum(source, "status", data.status, ["todo", "waiting_for_human", "in_progress", "blocked", "done"]);
  ensureEnum(source, "priority", data.priority, ["critical", "high", "medium", "low"]);
  ensureEnum(source, "size", data.size, ["small", "medium", "large"]);
  ensureEnum(source, "owner", data.owner, ["ai", "human"]);

  if (!Array.isArray(data.dependencies)) fail(`${source}: dependencies must be a list`);
  if (!Array.isArray(data.prd_references) || data.prd_references.length === 0) {
    fail(`${source}: prd_references must be a non-empty list`);
  }
  if (typeof data.requires_human !== "boolean") fail(`${source}: requires_human must be boolean`);
  if (typeof data.architecture_required !== "boolean") fail(`${source}: architecture_required must be boolean`);
  if (data.definition_of_done !== "harness/definition-of-done.md") {
    fail(`${source}: definition_of_done must reference the shared standard`);
  }

  if (data.owner === "human") {
    if (data.requires_human !== true) fail(`${source}: human owner requires requires_human: true`);
    if (data.reviewer !== null) fail(`${source}: human owner requires reviewer: null`);
    if (data.architecture_required !== false) fail(`${source}: human checkpoint cannot require an Architect`);
  } else if (data.reviewer !== "ai_reviewer") {
    fail(`${source}: AI-owned task requires reviewer: ai_reviewer`);
  }

  const heading = body.match(/^# (T-\d{3}) — (.+)$/m);
  if (!heading || heading[1] !== data.id || heading[2] !== data.title) {
    fail(`${source}: heading must match front-matter id and title`);
  }
  for (const section of ["## Expected Outcome", "## Not Included", "## Definition of Done"]) {
    if (!body.includes(section)) fail(`${source}: missing body section ${section}`);
  }

  tasks.set(data.id, { ...data, source });
}

for (const task of tasks.values()) {
  for (const dependency of task.dependencies ?? []) {
    if (!tasks.has(dependency)) fail(`${task.source}: unknown dependency ${dependency}`);
    if (dependency === task.id) fail(`${task.source}: task cannot depend on itself`);
  }
}

const visitState = new Map();
function visit(id, path = []) {
  if (visitState.get(id) === "done") return;
  if (visitState.get(id) === "active") {
    fail(`dependency cycle: ${[...path, id].join(" -> ")}`);
    return;
  }
  visitState.set(id, "active");
  for (const dependency of tasks.get(id)?.dependencies ?? []) visit(dependency, [...path, id]);
  visitState.set(id, "done");
}
for (const id of tasks.keys()) visit(id);

const backlogPath = join(tasksDirectory, "backlog.md");
const backlogContent = readFileSync(backlogPath, "utf8");
const backlogItems = [...backlogContent.matchAll(/^- \[([ xX])\] (T-\d{3}) (.+)$/gm)];
const backlogIds = new Set();

for (const [, checked, id, title] of backlogItems) {
  if (backlogIds.has(id)) fail(`tasks/backlog.md: duplicate entry ${id}`);
  backlogIds.add(id);
  const task = tasks.get(id);
  if (!task) {
    fail(`tasks/backlog.md: unknown task ${id}`);
    continue;
  }
  if (title !== task.title) fail(`tasks/backlog.md: title mismatch for ${id}`);
  const isChecked = checked.toLowerCase() === "x";
  if (isChecked !== (task.status === "done")) {
    fail(`tasks/backlog.md: checkbox for ${id} does not match status ${task.status}`);
  }
}
for (const id of tasks.keys()) {
  if (!backlogIds.has(id)) fail(`tasks/backlog.md: missing task ${id}`);
}

const statePath = join(harnessDirectory, "project-state.md");
const stateContent = readFileSync(statePath, "utf8");
const { data: state } = parseFrontMatter(stateContent, "harness/project-state.md");
const doneCount = [...tasks.values()].filter((task) => task.status === "done").length;

if (state.total_tasks !== tasks.size) fail("harness/project-state.md: total_tasks does not match task files");
if (state.completed_tasks !== doneCount) fail("harness/project-state.md: completed_tasks does not match done task count");
for (const field of ["current_task", "next_suggested_task", "last_completed_task"]) {
  const id = state[field];
  if (id !== null && !tasks.has(id)) fail(`harness/project-state.md: ${field} references unknown task ${id}`);
}
for (const id of state.pending_human_checkpoints ?? []) {
  const task = tasks.get(id);
  if (!task) fail(`harness/project-state.md: unknown human checkpoint ${id}`);
  else if (!task.requires_human) fail(`harness/project-state.md: ${id} is not a human checkpoint`);
}
for (const task of tasks.values()) {
  if (
    task.requires_human &&
    task.status !== "done" &&
    !(state.pending_human_checkpoints ?? []).includes(task.id)
  ) {
    fail(`harness/project-state.md: pending human checkpoint ${task.id} is not listed`);
  }
}

for (const resource of [
  "AGENTS.md",
  "PRD",
  "styleguide.md",
  "carnalesComp.png",
  "mockups/pos.html",
  "mockups/kds.html",
  "mockups/accounts.html",
  "mockups/admin.html",
  "restaurantData.md",
  "products.md",
]) {
  if (!existsSync(join(repositoryRoot, resource))) fail(`resource index target is missing: ${resource}`);
}

try {
  execFileSync("git", ["check-ignore", "-q", ".env.local"], {
    cwd: repositoryRoot,
    stdio: "ignore",
  });
} catch {
  fail(".env.local is not ignored by Git");
}

if (errors.length > 0) {
  console.error(`Harness validation failed with ${errors.length} error(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Harness validation passed: ${tasks.size} tasks, ${doneCount} done, ${backlogItems.length} backlog entries, no dependency cycles.`,
);
