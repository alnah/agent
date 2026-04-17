/**
 * TypeScript symbol navigation extension.
 *
 * Registers tools for definition lookup, reference lookup, project-wide rename,
 * and function or method listing from the active TypeScript project.
 */

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  Node,
  Project,
  type ReferencedSymbolEntry,
  type SourceFile,
} from "ts-morph";

export type TypeScriptSymbolTool =
  | "ts_definition"
  | "ts_references"
  | "ts_rename"
  | "ts_symbols";

type LocationInput = {
  path: string;
  line: number;
  column: number;
};

type RenameInput = LocationInput & {
  newName: string;
};

type SymbolsInput = {
  path?: string;
};

type Location = {
  filePath: string;
  line: number;
  column: number;
};

type ToolResponse = {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
  isError?: boolean;
};

type RenameableNode = Node & {
  rename(newName: string): unknown;
};

type ProjectSymbol = {
  project: Project;
  node: RenameableNode;
  location: Location;
};

type ReferenceLocation = Location & {
  text: string;
};

type FunctionLikeSymbol = Location & {
  kind: "function" | "method";
  name: string;
  containerName?: string;
};

const PROJECT_CONFIG_NAMES = ["tsconfig.json", "jsconfig.json"] as const;
const PROJECT_CONFIG_EXCLUDED_DIR_NAMES = new Set([
  ".git",
  ".pi",
  "node_modules",
]);
const LOCATION_PARAMETERS = Type.Object({
  path: Type.String({ description: "Path to a TypeScript source file" }),
  line: Type.Number({ description: "1-based line number" }),
  column: Type.Number({ description: "1-based column number" }),
});
const RENAME_PARAMETERS = Type.Object({
  path: Type.String({ description: "Path to a TypeScript source file" }),
  line: Type.Number({ description: "1-based line number" }),
  column: Type.Number({ description: "1-based column number" }),
  newName: Type.String({ description: "Replacement symbol name" }),
});
const SYMBOLS_PARAMETERS = Type.Object({
  path: Type.Optional(
    Type.String({
      description:
        "Optional path filter. Omit it to list functions and methods across the whole TypeScript project.",
    }),
  ),
});

/**
 * Registers the TypeScript symbol tools for pi.
 */
export function registerTypeScriptSymbolTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "ts_definition",
    label: "TS Definition",
    description: "Find the declaration location for one TypeScript symbol.",
    promptSnippet:
      "Find the declaration location for one TypeScript symbol from path, line, and column.",
    parameters: LOCATION_PARAMETERS,
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) =>
      runTypeScriptSymbolTool(
        "ts_definition",
        normalizeLocationInput(params),
        ctx,
      ),
  });

  pi.registerTool({
    name: "ts_references",
    label: "TS References",
    description:
      "List declaration and usage locations for one TypeScript symbol.",
    promptSnippet:
      "List all declaration and usage locations for one TypeScript symbol from path, line, and column.",
    parameters: LOCATION_PARAMETERS,
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) =>
      runTypeScriptSymbolTool(
        "ts_references",
        normalizeLocationInput(params),
        ctx,
      ),
  });

  pi.registerTool({
    name: "ts_rename",
    label: "TS Rename",
    description:
      "Rename one TypeScript symbol across the current project and save the changed files.",
    promptSnippet:
      "Rename one TypeScript symbol across the current project using path, line, column, and newName.",
    parameters: RENAME_PARAMETERS,
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) =>
      runTypeScriptSymbolTool("ts_rename", normalizeRenameInput(params), ctx),
  });

  pi.registerTool({
    name: "ts_symbols",
    label: "TS Symbols",
    description:
      "List TypeScript functions and methods in one file or across the current project.",
    promptSnippet:
      "List TypeScript functions and methods for the current project, optionally filtered by path.",
    parameters: SYMBOLS_PARAMETERS,
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) =>
      runTypeScriptSymbolTool("ts_symbols", normalizeSymbolsInput(params), ctx),
  });
}

export default function typeScriptSymbolsExtension(pi: ExtensionAPI): void {
  registerTypeScriptSymbolTools(pi);
}

async function runTypeScriptSymbolTool(
  tool: "ts_definition",
  input: LocationInput,
  ctx: ExtensionContext,
): Promise<ToolResponse>;
async function runTypeScriptSymbolTool(
  tool: "ts_references",
  input: LocationInput,
  ctx: ExtensionContext,
): Promise<ToolResponse>;
async function runTypeScriptSymbolTool(
  tool: "ts_rename",
  input: RenameInput,
  ctx: ExtensionContext,
): Promise<ToolResponse>;
async function runTypeScriptSymbolTool(
  tool: "ts_symbols",
  input: SymbolsInput,
  ctx: ExtensionContext,
): Promise<ToolResponse>;
async function runTypeScriptSymbolTool(
  tool: TypeScriptSymbolTool,
  input: LocationInput | RenameInput | SymbolsInput,
  ctx: ExtensionContext,
): Promise<ToolResponse> {
  try {
    switch (tool) {
      case "ts_definition":
        return findDefinition(input as LocationInput, ctx.cwd);
      case "ts_references":
        return findReferences(input as LocationInput, ctx.cwd);
      case "ts_rename":
        return renameSymbol(input as RenameInput, ctx.cwd);
      case "ts_symbols":
        return findTypeScriptSymbols(input as SymbolsInput, ctx.cwd);
    }
  } catch (error) {
    return createErrorResult(formatUserFacingError(tool, error));
  }
}

function findDefinition(input: LocationInput, cwd: string): ToolResponse {
  const symbol = loadProjectSymbol(input, cwd, "ts_definition");
  const definitions = symbol.project
    .getLanguageService()
    .getDefinitionsAtPosition(
      symbol.node.getSourceFile(),
      symbol.node.getStart(),
    );
  if (definitions.length === 0) {
    throw new UsageError(
      `No definition found at ${formatInputLocation(symbol.location, cwd)}.`,
    );
  }
  const definition = definitions
    .map((entry) =>
      formatReferenceLocationFromSourceFile(
        entry.getSourceFile(),
        entry.getTextSpan().getStart(),
        entry.getTextSpan().getLength(),
        cwd,
      ),
    )
    .sort(compareReferenceLocations)[0];
  return {
    content: [
      {
        type: "text",
        text: `Definition: ${formatReferenceLocation(definition)}`,
      },
    ],
    details: {
      kind: "definition",
      filePath: definition.filePath,
      line: definition.line,
      column: definition.column,
      text: definition.text,
    },
  };
}

function findReferences(input: LocationInput, cwd: string): ToolResponse {
  const symbol = loadProjectSymbol(input, cwd, "ts_references");
  const references = symbol.project
    .getLanguageService()
    .findReferencesAtPosition(
      symbol.node.getSourceFile(),
      symbol.node.getStart(),
    );
  const flattened = flattenReferences(references, cwd);
  if (flattened.length === 0) {
    throw new UsageError(
      `No references found at ${formatInputLocation(symbol.location, cwd)}.`,
    );
  }
  return {
    content: [
      {
        type: "text",
        text: [
          `References (${flattened.length}):`,
          ...flattened.map((entry) => `- ${formatReferenceLocation(entry)}`),
        ].join("\n"),
      },
    ],
    details: {
      kind: "references",
      references: flattened,
    },
  };
}

async function renameSymbol(
  input: RenameInput,
  cwd: string,
): Promise<ToolResponse> {
  const symbol = loadProjectSymbol(input, cwd, "ts_rename");
  const renameLocations = symbol.project
    .getLanguageService()
    .findRenameLocations(symbol.node);
  if (renameLocations.length === 0) {
    throw new UsageError(
      `No rename locations found at ${formatInputLocation(symbol.location, cwd)}.`,
    );
  }
  const oldName = symbol.node.getText();
  symbol.node.rename(input.newName);
  const changedFiles = symbol.project
    .getSourceFiles()
    .filter((sourceFile) => !sourceFile.isSaved())
    .map(
      (sourceFile) =>
        path.relative(cwd, sourceFile.getFilePath()) ||
        sourceFile.getBaseName(),
    )
    .sort();
  await symbol.project.save();
  return {
    content: [
      {
        type: "text",
        text: `Renamed ${oldName} to ${input.newName} in ${changedFiles.length} files.`,
      },
    ],
    details: {
      kind: "rename",
      oldName,
      newName: input.newName,
      changedFiles,
    },
  };
}

function findTypeScriptSymbols(input: SymbolsInput, cwd: string): ToolResponse {
  const project = loadProject(cwd, "ts_symbols", input.path);
  const sourceFiles = getSymbolSourceFiles(project, cwd, input.path);
  const symbols = sourceFiles
    .flatMap((sourceFile) => collectFunctionLikeSymbols(sourceFile, cwd))
    .sort(compareFunctionLikeSymbols);
  if (symbols.length === 0) {
    return {
      content: [{ type: "text", text: "TypeScript symbols (0):" }],
      details: {
        kind: "symbols",
        symbols: [],
      },
    };
  }
  return {
    content: [
      {
        type: "text",
        text: [
          `TypeScript symbols (${symbols.length}):`,
          ...symbols.map((symbol) => `- ${formatFunctionLikeSymbol(symbol)}`),
        ].join("\n"),
      },
    ],
    details: {
      kind: "symbols",
      symbols,
    },
  };
}

function loadProjectSymbol(
  input: LocationInput,
  cwd: string,
  tool: TypeScriptSymbolTool,
): ProjectSymbol {
  const absoluteFilePath = path.resolve(cwd, input.path);
  if (!existsSync(absoluteFilePath)) {
    throw new UsageError(
      `Source file not found: ${formatDisplayPath(absoluteFilePath, cwd)}.`,
    );
  }
  const project = loadProject(cwd, tool, absoluteFilePath);
  const sourceFile =
    project.getSourceFile(absoluteFilePath) ??
    project.addSourceFileAtPathIfExists(absoluteFilePath);
  if (sourceFile == null) {
    throw new UsageError(
      `Source file is not available in the active TypeScript project: ${formatDisplayPath(absoluteFilePath, cwd)}.`,
    );
  }
  const position = getPositionFromLineAndColumn(
    sourceFile.getFullText(),
    input.line,
    input.column,
  );
  const node =
    findNavigableNode(sourceFile.getDescendantAtPos(position)) ??
    (position > 0
      ? findNavigableNode(sourceFile.getDescendantAtPos(position - 1))
      : undefined);
  if (node == null) {
    throw new UsageError(
      `No symbol found at ${formatInputLocation(toLocation(input), cwd)}.`,
    );
  }
  return { project, node, location: toLocation(input) };
}

function loadProject(
  cwd: string,
  tool: TypeScriptSymbolTool,
  sourcePath?: string,
): Project {
  const projectConfigPath = resolveProjectConfigPath(cwd, tool, sourcePath);
  return new Project({ tsConfigFilePath: projectConfigPath });
}

function getSymbolSourceFiles(
  project: Project,
  cwd: string,
  inputPath?: string,
): SourceFile[] {
  if (inputPath != null) {
    const absoluteFilePath = path.resolve(cwd, inputPath);
    if (!existsSync(absoluteFilePath)) {
      throw new UsageError(
        `Source file not found: ${formatDisplayPath(absoluteFilePath, cwd)}.`,
      );
    }
    const sourceFile =
      project.getSourceFile(absoluteFilePath) ??
      project.addSourceFileAtPathIfExists(absoluteFilePath);
    if (sourceFile == null) {
      throw new UsageError(
        `Source file is not available in the active TypeScript project: ${formatDisplayPath(absoluteFilePath, cwd)}.`,
      );
    }
    return [sourceFile];
  }

  return project.getSourceFiles().filter((sourceFile) => {
    if (sourceFile.isDeclarationFile()) {
      return false;
    }
    const relativePath = path.relative(cwd, sourceFile.getFilePath());
    if (relativePath.startsWith("..")) {
      return false;
    }
    return !relativePath.includes(`node_modules${path.sep}`);
  });
}

function collectFunctionLikeSymbols(
  sourceFile: SourceFile,
  cwd: string,
): FunctionLikeSymbol[] {
  const symbols: FunctionLikeSymbol[] = [];

  sourceFile.forEachDescendant((node) => {
    if (Node.isFunctionDeclaration(node)) {
      const nameNode = node.getNameNode();
      if (nameNode != null) {
        symbols.push(
          createFunctionLikeSymbol(
            "function",
            node.getName() ?? nameNode.getText(),
            nameNode.getStart(),
            sourceFile,
            cwd,
          ),
        );
      }
      return;
    }

    if (Node.isVariableDeclaration(node)) {
      const initializer = node.getInitializer();
      if (
        initializer != null &&
        (Node.isArrowFunction(initializer) ||
          Node.isFunctionExpression(initializer))
      ) {
        const nameNode = node.getNameNode();
        symbols.push(
          createFunctionLikeSymbol(
            "function",
            node.getName(),
            nameNode.getStart(),
            sourceFile,
            cwd,
          ),
        );
      }
      return;
    }

    if (Node.isMethodDeclaration(node)) {
      const nameNode = node.getNameNode();
      const containerName = getMethodContainerName(node);
      symbols.push({
        ...createFunctionLikeSymbol(
          "method",
          node.getName(),
          nameNode.getStart(),
          sourceFile,
          cwd,
        ),
        containerName,
      });
    }
  });

  return symbols;
}

function createFunctionLikeSymbol(
  kind: "function" | "method",
  name: string,
  start: number,
  sourceFile: SourceFile,
  cwd: string,
): FunctionLikeSymbol {
  const { line, column } = sourceFile.getLineAndColumnAtPos(start);
  return {
    kind,
    name,
    filePath:
      path.relative(cwd, sourceFile.getFilePath()) || sourceFile.getBaseName(),
    line,
    column,
  };
}

function getMethodContainerName(node: Node): string | undefined {
  const classDeclaration = node.getFirstAncestor((ancestor) =>
    Node.isClassDeclaration(ancestor),
  );
  if (classDeclaration != null) {
    return classDeclaration.getName();
  }
  return undefined;
}

function normalizeLocationInput(input: Record<string, unknown>): LocationInput {
  return {
    path: String(input.path),
    line: Number(input.line),
    column: Number(input.column),
  };
}

function normalizeRenameInput(input: Record<string, unknown>): RenameInput {
  return {
    path: String(input.path),
    line: Number(input.line),
    column: Number(input.column),
    newName: String(input.newName),
  };
}

function normalizeSymbolsInput(input: Record<string, unknown>): SymbolsInput {
  if (typeof input.path === "string" && input.path !== "") {
    return { path: input.path };
  }
  return {};
}

function resolveProjectConfigPath(
  cwd: string,
  tool: TypeScriptSymbolTool,
  sourcePath?: string,
): string {
  const resolvedSourcePath =
    sourcePath != null ? path.resolve(cwd, sourcePath) : undefined;
  const startDir =
    resolvedSourcePath != null ? path.dirname(resolvedSourcePath) : cwd;
  const projectConfigPath =
    findProjectConfigPath(startDir) ??
    (resolvedSourcePath == null
      ? findSingleNestedProjectConfigPath(cwd)
      : undefined);
  if (projectConfigPath != null) {
    return projectConfigPath;
  }
  throw createProjectNotFoundError(tool);
}

function createProjectNotFoundError(tool: TypeScriptSymbolTool): UsageError {
  return new UsageError(
    `TypeScript project not found. Add tsconfig.json or jsconfig.json in this project before using ${tool}.`,
  );
}

function findProjectConfigPath(startDir: string): string | undefined {
  let currentDir = path.resolve(startDir);
  while (true) {
    for (const fileName of PROJECT_CONFIG_NAMES) {
      const candidate = path.join(currentDir, fileName);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return undefined;
    }
    currentDir = parentDir;
  }
}

function findSingleNestedProjectConfigPath(
  startDir: string,
): string | undefined {
  const projectConfigPaths = findNestedProjectConfigPaths(startDir);
  if (projectConfigPaths.length === 0) {
    return undefined;
  }
  if (projectConfigPaths.length === 1) {
    return projectConfigPaths[0];
  }
  const listedPaths = projectConfigPaths
    .slice(0, 5)
    .map(
      (projectConfigPath) => `- ${path.relative(startDir, projectConfigPath)}`,
    )
    .join("\n");
  const remainingCount = projectConfigPaths.length - 5;
  const remainingSuffix =
    remainingCount > 0 ? `\n- ... ${remainingCount} more` : "";
  throw new UsageError(
    [
      `Multiple TypeScript projects found under ${startDir}.`,
      "Re-run ts_symbols with path to a file inside the desired project.",
      `${listedPaths}${remainingSuffix}`,
    ].join("\n"),
  );
}

function findNestedProjectConfigPaths(startDir: string): string[] {
  const pendingDirs = [path.resolve(startDir)];
  const projectConfigPaths: string[] = [];

  while (pendingDirs.length > 0) {
    const currentDir = pendingDirs.pop();
    if (currentDir == null) {
      continue;
    }

    let entries: Array<{
      name: string;
      isDirectory(): boolean;
      isFile(): boolean;
    }>;
    try {
      entries = readdirSync(currentDir, { withFileTypes: true }) as Array<{
        name: string;
        isDirectory(): boolean;
        isFile(): boolean;
      }>;
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (PROJECT_CONFIG_EXCLUDED_DIR_NAMES.has(entry.name)) {
          continue;
        }
        pendingDirs.push(entryPath);
        continue;
      }
      if (
        entry.isFile() &&
        PROJECT_CONFIG_NAMES.includes(
          entry.name as (typeof PROJECT_CONFIG_NAMES)[number],
        )
      ) {
        projectConfigPaths.push(entryPath);
      }
    }
  }

  return projectConfigPaths.sort();
}

function flattenReferences(
  references: readonly { getReferences(): ReferencedSymbolEntry[] }[],
  cwd: string,
): ReferenceLocation[] {
  const byKey = new Map<string, ReferenceLocation>();
  for (const referencedSymbol of references) {
    for (const reference of referencedSymbol.getReferences()) {
      const span = reference.getTextSpan();
      const formatted = formatReferenceLocationFromSourceFile(
        reference.getSourceFile(),
        span.getStart(),
        span.getLength(),
        cwd,
      );
      const key = [
        formatted.filePath,
        formatted.line,
        formatted.column,
        formatted.text,
      ].join(":");
      if (!byKey.has(key)) {
        byKey.set(key, formatted);
      }
    }
  }
  return [...byKey.values()].sort(compareReferenceLocations);
}

function formatReferenceLocationFromSourceFile(
  sourceFile: SourceFile,
  start: number,
  length: number,
  cwd: string,
): ReferenceLocation {
  const { line, column } = sourceFile.getLineAndColumnAtPos(start);
  return {
    filePath:
      path.relative(cwd, sourceFile.getFilePath()) || sourceFile.getBaseName(),
    line,
    column,
    text: sourceFile.getFullText().slice(start, start + length),
  };
}

function compareReferenceLocations(
  left: ReferenceLocation,
  right: ReferenceLocation,
): number {
  return (
    left.filePath.localeCompare(right.filePath) ||
    left.line - right.line ||
    left.column - right.column ||
    left.text.localeCompare(right.text)
  );
}

function compareFunctionLikeSymbols(
  left: FunctionLikeSymbol,
  right: FunctionLikeSymbol,
): number {
  return (
    left.filePath.localeCompare(right.filePath) ||
    left.line - right.line ||
    left.column - right.column ||
    left.kind.localeCompare(right.kind) ||
    left.name.localeCompare(right.name)
  );
}

function formatReferenceLocation(location: ReferenceLocation): string {
  return `${location.filePath}:${location.line}:${location.column} ${location.text}`;
}

function formatFunctionLikeSymbol(symbol: FunctionLikeSymbol): string {
  const qualifiedName =
    symbol.containerName != null
      ? `${symbol.containerName}.${symbol.name}`
      : symbol.name;
  return `${symbol.kind} ${qualifiedName} ${symbol.filePath}:${symbol.line}:${symbol.column}`;
}

function formatInputLocation(location: Location, cwd: string): string {
  return `${formatDisplayPath(location.filePath, cwd)}:${location.line}:${location.column}`;
}

function formatDisplayPath(filePath: string, cwd: string): string {
  if (path.isAbsolute(filePath)) {
    return path.relative(cwd, filePath) || path.basename(filePath);
  }
  return filePath;
}

function getPositionFromLineAndColumn(
  text: string,
  targetLine: number,
  targetColumn: number,
): number {
  if (!Number.isInteger(targetLine) || targetLine < 1) {
    throw new UsageError("Line must be a positive integer.");
  }
  if (!Number.isInteger(targetColumn) || targetColumn < 1) {
    throw new UsageError("Column must be a positive integer.");
  }
  let line = 1;
  let column = 1;
  for (let index = 0; index < text.length; index++) {
    if (line === targetLine && column === targetColumn) {
      return index;
    }
    const char = text[index];
    if (char === "\r") {
      if (text[index + 1] === "\n") {
        index += 1;
      }
      line += 1;
      column = 1;
      continue;
    }
    if (char === "\n") {
      line += 1;
      column = 1;
      continue;
    }
    column += 1;
  }
  if (line === targetLine && column === targetColumn) {
    return text.length;
  }
  throw new UsageError(
    `Location ${targetLine}:${targetColumn} is outside the file.`,
  );
}

function findNavigableNode(node: Node | undefined): RenameableNode | undefined {
  let current = node;
  while (current != null) {
    if (Node.isIdentifier(current)) {
      return current as RenameableNode;
    }
    current = current.getParent();
  }
  return undefined;
}

function createErrorResult(message: string): ToolResponse {
  return {
    content: [{ type: "text", text: message }],
    details: {
      kind: "error",
      message,
    },
    isError: true,
  };
}

function toLocation(input: LocationInput): Location {
  return {
    filePath: input.path,
    line: input.line,
    column: input.column,
  };
}

function formatUserFacingError(
  tool: TypeScriptSymbolTool,
  error: unknown,
): string {
  if (error instanceof UsageError) {
    return error.message;
  }
  if (error instanceof Error) {
    return `${tool} failed: ${error.message}`;
  }
  return `${tool} failed.`;
}

class UsageError extends Error {}
