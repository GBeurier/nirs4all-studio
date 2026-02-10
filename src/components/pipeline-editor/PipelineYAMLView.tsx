/**
 * PipelineYAMLView
 * ================
 *
 * Read-only YAML view of the current pipeline in nirs4all-native format.
 * Displays the pipeline definition as human-readable YAML that matches
 * what users would write in Python or save as a .yaml config file.
 *
 * Features:
 * - Converts editor steps to native format on-the-fly
 * - Syntax-highlighted YAML display
 * - Copy to clipboard button
 * - JSON toggle for alternative view
 */

import { useState, useMemo, useCallback } from "react";
import { Copy, Check, FileCode, FileJson, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import type { PipelineStep as EditorPipelineStep } from "@/components/pipeline-editor/types";
import {
  toNativeFormat,
  toNativePipelineYAML,
  toNativePipelineJSON,
} from "@/utils/nativePipelineFormat";

// ============================================================================
// Props
// ============================================================================

export interface PipelineYAMLViewProps {
  /** Current pipeline steps from the editor */
  steps: EditorPipelineStep[];
  /** Optional pipeline name for the header */
  pipelineName?: string;
  /** Optional description */
  pipelineDescription?: string;
  /** Optional random seed */
  randomState?: number;
  /** CSS class name for the root container */
  className?: string;
}

// ============================================================================
// Syntax Highlighting
// ============================================================================

type TokenType = "key" | "string" | "number" | "boolean" | "null" | "comment" | "punctuation" | "plain";

interface Token {
  type: TokenType;
  text: string;
}

/** Tokenize a YAML line for syntax highlighting. */
function tokenizeYAMLLine(line: string): Token[] {
  const tokens: Token[] = [];
  const trimmed = line.trimStart();
  const leadingSpaces = line.length - trimmed.length;

  // Add indentation
  if (leadingSpaces > 0) {
    tokens.push({ type: "plain", text: " ".repeat(leadingSpaces) });
  }

  // Comment line
  if (trimmed.startsWith("#")) {
    tokens.push({ type: "comment", text: trimmed });
    return tokens;
  }

  // List item prefix
  let rest = trimmed;
  if (rest.startsWith("- ")) {
    tokens.push({ type: "punctuation", text: "- " });
    rest = rest.slice(2);
  }

  // Check for key: value pattern
  const colonIdx = rest.indexOf(": ");
  if (colonIdx > 0 && !rest.startsWith('"') && !rest.startsWith("'")) {
    const key = rest.slice(0, colonIdx);
    const value = rest.slice(colonIdx + 2);

    tokens.push({ type: "key", text: key });
    tokens.push({ type: "punctuation", text: ": " });

    // Tokenize the value
    tokens.push(...tokenizeYAMLValue(value));
    return tokens;
  }

  // Key with no value (block key ending with :)
  if (rest.endsWith(":") && !rest.includes(" ") && !rest.startsWith('"')) {
    tokens.push({ type: "key", text: rest.slice(0, -1) });
    tokens.push({ type: "punctuation", text: ":" });
    return tokens;
  }

  // Inline list or plain value
  tokens.push(...tokenizeYAMLValue(rest));
  return tokens;
}

function tokenizeYAMLValue(value: string): Token[] {
  const tokens: Token[] = [];

  if (!value) return tokens;

  // Inline array: [...]
  if (value.startsWith("[") && value.endsWith("]")) {
    tokens.push({ type: "punctuation", text: "[" });
    const inner = value.slice(1, -1);
    const parts = splitInlineArray(inner);
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) tokens.push({ type: "punctuation", text: ", " });
      tokens.push(...tokenizeYAMLValue(parts[i].trim()));
    }
    tokens.push({ type: "punctuation", text: "]" });
    return tokens;
  }

  // Inline object: {...}
  if (value.startsWith("{") && value.endsWith("}")) {
    tokens.push({ type: "punctuation", text: value });
    return tokens;
  }

  // Quoted string
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    tokens.push({ type: "string", text: value });
    return tokens;
  }

  // Boolean
  if (value === "true" || value === "false" || value === "yes" || value === "no") {
    tokens.push({ type: "boolean", text: value });
    return tokens;
  }

  // Null
  if (value === "null" || value === "~") {
    tokens.push({ type: "null", text: value });
    return tokens;
  }

  // Number
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value)) {
    tokens.push({ type: "number", text: value });
    return tokens;
  }

  // Plain text (could be an unquoted string or class name)
  tokens.push({ type: "plain", text: value });
  return tokens;
}

/** Split items in an inline YAML array, respecting nested brackets. */
function splitInlineArray(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";

  for (const ch of s) {
    if (ch === "[" || ch === "{") depth++;
    if (ch === "]" || ch === "}") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/** CSS classes for each token type. */
const TOKEN_CLASSES: Record<TokenType, string> = {
  key: "text-cyan-400",
  string: "text-amber-300",
  number: "text-emerald-400",
  boolean: "text-purple-400",
  null: "text-gray-500",
  comment: "text-gray-500 italic",
  punctuation: "text-gray-400",
  plain: "text-foreground",
};

// ============================================================================
// Component
// ============================================================================

export function PipelineYAMLView({
  steps,
  pipelineName,
  pipelineDescription,
  randomState,
  className,
}: PipelineYAMLViewProps) {
  const [format, setFormat] = useState<"yaml" | "json">("yaml");
  const [copied, setCopied] = useState(false);

  // Convert editor steps to native format
  const nativeSteps = useMemo(() => {
    try {
      return toNativeFormat(steps);
    } catch {
      return [];
    }
  }, [steps]);

  // Generate YAML string
  const yamlContent = useMemo(() => {
    try {
      return toNativePipelineYAML(steps, {
        name: pipelineName,
        description: pipelineDescription,
        randomState,
      });
    } catch (e) {
      return `# Error generating YAML: ${e instanceof Error ? e.message : "Unknown error"}`;
    }
  }, [steps, pipelineName, pipelineDescription, randomState]);

  // Generate JSON string
  const jsonContent = useMemo(() => {
    try {
      const doc = toNativePipelineJSON(steps, {
        name: pipelineName,
        description: pipelineDescription,
        randomState,
      });
      return JSON.stringify(doc, null, 2);
    } catch (e) {
      return `// Error generating JSON: ${e instanceof Error ? e.message : "Unknown error"}`;
    }
  }, [steps, pipelineName, pipelineDescription, randomState]);

  const content = format === "yaml" ? yamlContent : jsonContent;

  // Tokenize YAML lines for highlighting
  const highlightedLines = useMemo(() => {
    if (format !== "yaml") return null;
    return yamlContent.split("\n").map((line) => tokenizeYAMLLine(line));
  }, [yamlContent, format]);

  // Copy to clipboard
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      toast.success(`Pipeline copied as ${format.toUpperCase()}`);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy to clipboard");
    }
  }, [content, format]);

  // Download as file
  const handleDownload = useCallback(() => {
    const ext = format === "yaml" ? "yaml" : "json";
    const mimeType = format === "yaml" ? "text/yaml" : "application/json";
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(pipelineName || "pipeline").replace(/\s+/g, "_")}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Pipeline downloaded as ${ext.toUpperCase()}`);
  }, [content, format, pipelineName]);

  if (steps.length === 0) {
    return (
      <div className={`flex items-center justify-center h-full text-muted-foreground text-sm ${className || ""}`}>
        Add steps to the pipeline to see the native format view.
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full ${className || ""}`}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            nirs4all Native Format
          </span>
          <span className="text-xs text-muted-foreground">
            ({nativeSteps.length} step{nativeSteps.length !== 1 ? "s" : ""})
          </span>
        </div>

        <div className="flex items-center gap-1">
          {/* Format toggle */}
          <div className="flex items-center rounded-md border border-border bg-background">
            <button
              onClick={() => setFormat("yaml")}
              className={`flex items-center gap-1 px-2 py-1 text-xs rounded-l-md transition-colors ${
                format === "yaml"
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <FileCode className="h-3 w-3" />
              YAML
            </button>
            <button
              onClick={() => setFormat("json")}
              className={`flex items-center gap-1 px-2 py-1 text-xs rounded-r-md transition-colors ${
                format === "json"
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <FileJson className="h-3 w-3" />
              JSON
            </button>
          </div>

          {/* Download */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleDownload}>
                <Download className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Download as {format.toUpperCase()}</TooltipContent>
          </Tooltip>

          {/* Copy */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCopy}>
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {copied ? "Copied!" : `Copy ${format.toUpperCase()}`}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Code Display */}
      <div className="flex-1 overflow-auto bg-[hsl(var(--card))]">
        <pre className="p-3 text-xs leading-relaxed font-mono">
          {format === "yaml" && highlightedLines ? (
            highlightedLines.map((tokens, lineIdx) => (
              <div key={lineIdx} className="min-h-[1.25rem]">
                <span className="inline-block w-8 text-right mr-3 text-muted-foreground/40 select-none">
                  {lineIdx + 1}
                </span>
                {tokens.map((token, tokenIdx) => (
                  <span key={tokenIdx} className={TOKEN_CLASSES[token.type]}>
                    {token.text}
                  </span>
                ))}
              </div>
            ))
          ) : (
            // JSON with basic syntax highlighting via class names
            jsonContent.split("\n").map((line, lineIdx) => (
              <div key={lineIdx} className="min-h-[1.25rem]">
                <span className="inline-block w-8 text-right mr-3 text-muted-foreground/40 select-none">
                  {lineIdx + 1}
                </span>
                <span>{highlightJSONLine(line)}</span>
              </div>
            ))
          )}
        </pre>
      </div>
    </div>
  );
}

/** Basic JSON syntax highlighting for a single line. */
function highlightJSONLine(line: string): React.ReactNode {
  // Very simple regex-based highlighting
  const parts: React.ReactNode[] = [];
  let remaining = line;
  let key = 0;

  // Match patterns in order
  const patterns: Array<[RegExp, string]> = [
    [/^(\s+)/, ""], // whitespace - no class
    [/^("(?:[^"\\]|\\.)*")\s*:/, "text-cyan-400"], // key
    [/^:\s*/, "text-gray-400"], // colon
    [/^("(?:[^"\\]|\\.)*")/, "text-amber-300"], // string value
    [/^(-?\d+\.?\d*(?:[eE][+-]?\d+)?)/, "text-emerald-400"], // number
    [/^(true|false)/, "text-purple-400"], // boolean
    [/^(null)/, "text-gray-500"], // null
    [/^([{}[\],])/, "text-gray-400"], // punctuation
    [/^(\S+)/, "text-foreground"], // other
  ];

  while (remaining.length > 0) {
    let matched = false;
    for (const [pattern, className] of patterns) {
      const match = remaining.match(pattern);
      if (match) {
        const text = match[0];
        if (className) {
          parts.push(
            <span key={key++} className={className}>{text}</span>
          );
        } else {
          parts.push(<span key={key++}>{text}</span>);
        }
        remaining = remaining.slice(text.length);
        matched = true;
        break;
      }
    }
    if (!matched) {
      // Safety: consume one char to prevent infinite loop
      parts.push(<span key={key++}>{remaining[0]}</span>);
      remaining = remaining.slice(1);
    }
  }

  return <>{parts}</>;
}
