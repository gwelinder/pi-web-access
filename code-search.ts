import { activityMonitor } from "./activity.js";
import { searchCodeWithExa, type ExaCodeSearchResult } from "./exa.js";

const APPROX_CHARS_PER_TOKEN = 4;
const MIN_RESULTS = 3;
const MAX_RESULTS = 10;
const MIN_HIGHLIGHT_CHARS = 400;
const MAX_HIGHLIGHT_CHARS = 4000;

interface CodeSearchParams {
	query: string;
	maxTokens?: number;
	includeDomains?: string[];
	excludeDomains?: string[];
	startPublishedDate?: string;
	endPublishedDate?: string;
}

function estimateNumResults(maxTokens: number): number {
	if (maxTokens <= 2500) return MIN_RESULTS;
	if (maxTokens <= 5000) return 5;
	if (maxTokens <= 10000) return 7;
	return MAX_RESULTS;
}

function estimateHighlightMaxCharacters(maxTokens: number, numResults: number): number {
	const totalChars = Math.max(1200, Math.min(40000, maxTokens * APPROX_CHARS_PER_TOKEN));
	return Math.max(MIN_HIGHLIGHT_CHARS, Math.min(MAX_HIGHLIGHT_CHARS, Math.floor(totalChars / Math.max(1, numResults))));
}

function truncateToApproxTokens(text: string, maxTokens: number): string {
	const maxChars = Math.max(1200, Math.min(200000, maxTokens * APPROX_CHARS_PER_TOKEN));
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars).trimEnd()}\n\n[truncated to ~${maxTokens} tokens]`;
}

function formatResult(result: ExaCodeSearchResult, index: number): string {
	const header = [`## ${index + 1}. ${result.title}`, `URL: ${result.url}`];
	if (result.publishedDate) header.push(`Published: ${result.publishedDate}`);
	if (result.author) header.push(`Author: ${result.author}`);

	const snippets = result.highlights.length > 0
		? result.highlights.map((snippet, snippetIndex) => `### Snippet ${snippetIndex + 1}\n${snippet}`).join("\n\n")
		: result.text ? `### Text\n${result.text}` : "No snippet returned.";

	return `${header.join("\n")}\n\n${snippets}`;
}

function formatCodeSearchResults(results: ExaCodeSearchResult[]): string {
	if (results.length === 0) return "No code search results found.";
	return results.map(formatResult).join("\n\n---\n\n");
}

export async function executeCodeSearch(
	_toolCallId: string,
	params: CodeSearchParams,
	signal?: AbortSignal,
): Promise<{
	content: Array<{ type: "text"; text: string }>;
	details: { query: string; maxTokens: number; error?: string };
}> {
	const query = params.query.trim();
	if (!query) {
		return {
			content: [{ type: "text", text: "Error: Query must contain at least one non-whitespace character." }],
			details: {
				query: "",
				maxTokens: params.maxTokens ?? 5000,
				error: "Query must contain at least one non-whitespace character",
			},
		};
	}

	const maxTokens = params.maxTokens ?? 5000;
	const numResults = estimateNumResults(maxTokens);
	const highlightMaxCharacters = estimateHighlightMaxCharacters(maxTokens, numResults);
	const activityId = activityMonitor.logStart({ type: "api", query });

	try {
		const results = await searchCodeWithExa({
			query,
			numResults,
			includeDomains: params.includeDomains,
			excludeDomains: params.excludeDomains,
			startPublishedDate: params.startPublishedDate,
			endPublishedDate: params.endPublishedDate,
			highlightMaxCharacters,
			signal,
		});
		activityMonitor.logComplete(activityId, 200);
		return {
			content: [{ type: "text", text: truncateToApproxTokens(formatCodeSearchResults(results), maxTokens) }],
			details: { query, maxTokens },
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message.toLowerCase().includes("abort")) {
			activityMonitor.logComplete(activityId, 0);
			throw err;
		}
		activityMonitor.logError(activityId, message);
		return {
			content: [{ type: "text", text: `Error: ${message}` }],
			details: { query, maxTokens, error: message },
		};
	}
}
