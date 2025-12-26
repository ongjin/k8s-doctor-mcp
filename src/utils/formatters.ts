/**
 * Result formatting utilities
 *
 * @author zerry
 */

import type { DiagnosticIssue, Severity } from '../types.js';

/**
 * Convert bytes to human-readable format
 *
 * 1024 -> "1 KiB"
 * 1048576 -> "1 MiB"
 */
export function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

/**
 * Convert millicores to human-readable format
 *
 * 1000 -> "1 core"
 * 500 -> "0.5 cores"
 */
export function formatCPU(millicores: number): string {
    const cores = millicores / 1000;
    return `${cores.toFixed(2)} ${cores === 1 ? 'core' : 'cores'}`;
}

/**
 * Return emoji based on severity
 */
export function getSeverityEmoji(severity: Severity): string {
    const emojis = {
        critical: '🔴',
        high: '🟠',
        medium: '🟡',
        low: '🔵',
        info: '⚪',
    };
    return emojis[severity] || '⚪';
}

/**
 * Convert health score to emoji
 */
export function getHealthEmoji(score: number): string {
    if (score >= 90) return '💚';
    if (score >= 70) return '💛';
    if (score >= 50) return '🧡';
    return '❤️';
}

/**
 * Convert timestamp to relative time
 *
 * "2 hours ago", "5 minutes ago" 등
 */
export function timeAgo(timestamp: string): string {
    const now = new Date();
    const past = new Date(timestamp);
    const diffMs = now.getTime() - past.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffDay > 0) return `${diffDay}days ago`;
    if (diffHour > 0) return `${diffHour}hours ago`;
    if (diffMin > 0) return `${diffMin}minutes ago`;
    return `${diffSec}seconds ago`;
}

/**
 * Format issue list as markdown
 */
export function formatIssues(issues: DiagnosticIssue[]): string {
    if (issues.length === 0) {
        return '✅ No issues found!';
    }

    let result = `## 🔍 Detected Issues (${issues.length})\n\n`;

    // Severity별로 정렬
    const sorted = [...issues].sort((a, b) => {
        const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
        return severityOrder[a.severity] - severityOrder[b.severity];
    });

    for (const issue of sorted) {
        result += `### ${getSeverityEmoji(issue.severity)} ${issue.type}\n\n`;
        result += `**Severity**: ${issue.severity.toUpperCase()}\n\n`;
        result += `**Problem**: ${issue.message}\n\n`;
        result += `**Root Cause**: ${issue.rootCause}\n\n`;
        result += `**Solution**:\n${issue.solution}\n\n`;

        if (issue.relevantLogs && issue.relevantLogs.length > 0) {
            result += `**Related Logs**:\n\`\`\`\n${issue.relevantLogs.join('\n')}\n\`\`\`\n\n`;
        }

        if (issue.resource) {
            result += `**Resource**: ${issue.resource.kind}/${issue.resource.name} (ns: ${issue.resource.namespace})\n\n`;
        }

        result += '---\n\n';
    }

    return result;
}

/**
 * Output diagnosis results as clean table
 */
export function createTable(headers: string[], rows: string[][]): string {
    const colWidths = headers.map((h, i) => {
        const maxRowWidth = Math.max(...rows.map(r => (r[i] || '').length));
        return Math.max(h.length, maxRowWidth);
    });

    let table = '| ' + headers.map((h, i) => h.padEnd(colWidths[i])).join(' | ') + ' |\n';
    table += '| ' + colWidths.map(w => '-'.repeat(w)).join(' | ') + ' |\n';

    for (const row of rows) {
        table += '| ' + row.map((cell, i) => (cell || '').padEnd(colWidths[i])).join(' | ') + ' |\n';
    }

    return table;
}

/**
 * Display percent as progress bar
 *
 * 85% -> "████████░░ 85%"
 */
export function progressBar(percent: number, width: number = 10): string {
    const filled = Math.round((percent / 100) * width);
    const empty = width - filled;
    return '█'.repeat(filled) + '░'.repeat(empty) + ` ${percent.toFixed(1)}%`;
}
