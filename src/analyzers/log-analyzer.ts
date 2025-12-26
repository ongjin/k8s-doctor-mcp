/**
 * Log analysis module
 *
 * Rather than simply showing logs
 * finds error patterns and analyzes root causes
 *
 * @author zerry
 */

import * as k8s from '@kubernetes/client-node';
import type { LogAnalysis, LogEntry, ErrorPattern, RepeatedError } from '../types.js';

/**
 * Analyze pod logs
 *
 * Finds error patterns in logs and suggests solutions
 * Extracts key information from thousands of log lines
 */
export async function analyzeLogs(
    logApi: k8s.Log,
    namespace: string,
    podName: string,
    containerName?: string,
    tailLines: number = 500
): Promise<LogAnalysis> {
    try {
        const stream = new (require('stream').Writable)();
        let logData = '';

        stream._write = (chunk: any, encoding: string, next: Function) => {
            logData += chunk.toString();
            next();
        };

        // Fetch logs
        await logApi.log(namespace, podName, containerName || '', stream, {
            tailLines,
        });

        const lines = logData.split('\n').filter(line => line.trim());

        // 1. Extract error/warning lines
        const errorLines = extractErrorLines(lines);
        const warningLines = extractWarningLines(lines);

        // 2. Detect error patterns
        const patterns = detectErrorPatterns(lines);

        // 3. Find repeated errors
        const repeatedErrors = findRepeatedErrors(errorLines);

        // 4. Generate summary
        const summary = generateLogSummary(lines.length, errorLines, patterns);

        // 5. Generate recommendations
        const recommendations = generateRecommendations(patterns, repeatedErrors);

        return {
            totalLines: lines.length,
            errorLines,
            warningLines,
            patterns,
            repeatedErrors,
            summary,
            recommendations,
        };
    } catch (error: any) {
        throw new Error(`Log analysis failed: ${error.message}`);
    }
}

/**
 * Extract error lines
 *
 * Finds errors using keywords like ERROR, Exception, Fatal
 */
function extractErrorLines(lines: string[]): LogEntry[] {
    const errorKeywords = [
        'error',
        'exception',
        'fatal',
        'panic',
        'failed',
        'failure',
        'err:',
        'traceback',
        'stacktrace',
    ];

    const errorLines: LogEntry[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lowerLine = line.toLowerCase();

        for (const keyword of errorKeywords) {
            if (lowerLine.includes(keyword)) {
                errorLines.push({
                    lineNumber: i + 1,
                    content: line,
                    timestamp: extractTimestamp(line),
                    level: 'ERROR',
                });
                break;
            }
        }
    }

    return errorLines;
}

/**
 * Extract warning lines
 */
function extractWarningLines(lines: string[]): LogEntry[] {
    const warnKeywords = ['warn', 'warning', 'deprecated'];
    const warningLines: LogEntry[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lowerLine = line.toLowerCase();

        for (const keyword of warnKeywords) {
            if (lowerLine.includes(keyword)) {
                warningLines.push({
                    lineNumber: i + 1,
                    content: line,
                    timestamp: extractTimestamp(line),
                    level: 'WARN',
                });
                break;
            }
        }
    }

    return warningLines;
}

/**
 * Detect error patterns
 *
 * Matches patterns of commonly occurring errors with solutions
 * This is the core functionality!
 */
function detectErrorPatterns(lines: string[]): ErrorPattern[] {
    const patterns: ErrorPattern[] = [];

    // Pattern definitions: errors frequently seen in production
    const knownPatterns = [
        {
            name: 'Connection Refused',
            regex: /connection refused|ECONNREFUSED/i,
            description: 'Cannot connect to target service',
            causes: [
                'Target service not started yet',
                'Wrong service port',
                'Blocked by network policy',
            ],
            solutions: [
                'Check if service is running: kubectl get pods',
                'Verify service port: kubectl get svc',
                'Check network policy: kubectl get networkpolicy',
            ],
            severity: 'high' as const,
        },
        {
            name: 'Database Connection Error',
            regex: /could not connect to.*database|ETIMEDOUT.*:5432|:3306|:27017/i,
            description: 'Database connection failed',
            causes: [
                'DB service not ready',
                'Invalid connection string',
                'DB authentication failed',
            ],
            solutions: [
                'Check DB Pod status',
                'Verify environment variables (ConfigMap/Secret)',
                'Check DB service endpoints: kubectl get endpoints',
            ],
            severity: 'critical' as const,
        },
        {
            name: 'Out of Memory',
            regex: /out of memory|OOMKilled|cannot allocate memory/i,
            description: 'Insufficient memory',
            causes: [
                'Memory limit set too low',
                'Memory leak',
                'Higher memory usage than expected',
            ],
            solutions: [
                'Increase memory limit: resources.limits.memory',
                'Profile application memory usage',
                'Increase pod count with HPA',
            ],
            severity: 'critical' as const,
        },
        {
            name: 'File Not Found',
            regex: /no such file|ENOENT|FileNotFoundError/i,
            description: 'File or directory not found',
            causes: [
                'ConfigMap/Secret not mounted',
                'Invalid file path',
                'Volume mount failed',
            ],
            solutions: [
                'Check volumeMounts configuration',
                'Verify ConfigMap/Secret exists',
                'Verify file path is correct',
            ],
            severity: 'high' as const,
        },
        {
            name: 'Permission Denied',
            regex: /permission denied|EACCES|access denied/i,
            description: 'Permission denied',
            causes: [
                'SecurityContext runAsUser setting',
                'Volume fsGroup not set',
                'File permission issues',
            ],
            solutions: [
                'Configure securityContext:\nfsGroup: 1000\nrunAsUser: 1000',
                'Check volume permissions',
                'Set permissions in Dockerfile',
            ],
            severity: 'high' as const,
        },
        {
            name: 'DNS Resolution Failed',
            regex: /dns.*failed|getaddrinfo.*ENOTFOUND|name.*not known/i,
            description: 'DNS lookup failed',
            causes: [
                'CoreDNS issues',
                'Invalid service name',
                'ndots configuration problem',
            ],
            solutions: [
                'Check CoreDNS Pod: kubectl get pods -n kube-system',
                'Service name format: <service>.<namespace>.svc.cluster.local',
                'Verify dnsPolicy setting',
            ],
            severity: 'high' as const,
        },
        {
            name: 'Port Already in Use',
            regex: /address already in use|EADDRINUSE/i,
            description: 'Port already in use',
            causes: [
                'Multiple processes using same port',
                'Previous process not terminated properly',
            ],
            solutions: [
                'Change port number',
                'Implement graceful shutdown',
                'Configure preStop hook',
            ],
            severity: 'medium' as const,
        },
        {
            name: 'Timeout',
            regex: /timeout|timed out|ETIMEDOUT/i,
            description: 'Timeout occurred',
            causes: [
                'Response time too long',
                'Network latency',
                'Target service overloaded',
            ],
            solutions: [
                'Increase timeout value',
                'Optimize service performance',
                'Adjust readinessProbe timeout',
            ],
            severity: 'medium' as const,
        },
        {
            name: 'Null Pointer / Undefined',
            regex: /null pointer|undefined is not|cannot read property.*undefined|NullPointerException/i,
            description: 'Null/Undefined reference',
            causes: [
                'Environment variable not set',
                'Using uninitialized variable',
            ],
            solutions: [
                'Verify ConfigMap/Secret',
                'Set default value for environment variables',
                'Fix code',
            ],
            severity: 'medium' as const,
        },
        {
            name: 'SSL/TLS Error',
            regex: /ssl.*error|certificate.*invalid|CERT_/i,
            description: 'SSL/TLS certificate error',
            causes: [
                'Expired certificate',
                'Self-signed certificate',
                'CA bundle missing',
            ],
            solutions: [
                'Renew certificate',
                'Verify tls.crt, tls.key Secret',
                'NODE_TLS_REJECT_UNAUTHORIZED=0 (development only)',
            ],
            severity: 'high' as const,
        },
    ];

    // Match each pattern
    for (const pattern of knownPatterns) {
        const matchedLines: number[] = [];

        for (let i = 0; i < lines.length; i++) {
            if (pattern.regex.test(lines[i])) {
                matchedLines.push(i + 1);
            }
        }

        if (matchedLines.length > 0) {
            patterns.push({
                name: pattern.name,
                matchedLines,
                description: pattern.description,
                possibleCauses: pattern.causes,
                solutions: pattern.solutions,
                severity: pattern.severity,
            });
        }
    }

    return patterns;
}

/**
 * Find repeated errors
 *
 * If the same error keeps occurring, there's a pattern
 */
function findRepeatedErrors(errorLines: LogEntry[]): RepeatedError[] {
    const errorMap = new Map<string, number[]>();

    for (const entry of errorLines) {
        // Normalize error message (remove timestamps, numbers, etc.)
        const normalized = normalizeErrorMessage(entry.content);

        if (!errorMap.has(normalized)) {
            errorMap.set(normalized, []);
        }
        errorMap.get(normalized)!.push(entry.lineNumber);
    }

    const repeatedErrors: RepeatedError[] = [];

    for (const [message, lineNumbers] of errorMap.entries()) {
        if (lineNumbers.length >= 3) {  // If repeated 3+ times
            repeatedErrors.push({
                message,
                count: lineNumbers.length,
                firstLine: lineNumbers[0],
                lastLine: lineNumbers[lineNumbers.length - 1],
                isPattern: true,
            });
        }
    }

    // Sort by occurrence count
    return repeatedErrors.sort((a, b) => b.count - a.count);
}

/**
 * Normalize error message
 *
 * Remove timestamps, IPs, ports, etc. to group similar errors
 */
function normalizeErrorMessage(message: string): string {
    return message
        .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}.*?Z/g, '<timestamp>')  // ISO timestamp
        .replace(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g, '<ip>')  // IP address
        .replace(/:\d{2,5}/g, ':<port>')  // Port number
        .replace(/\d+/g, '<num>')  // Other numbers
        .replace(/0x[0-9a-f]+/gi, '<hex>')  // Hex values
        .toLowerCase()
        .trim();
}

/**
 * 타임스탬프 추출
 *
 * 로그에서 타임스탬프를 파싱 시도
 */
function extractTimestamp(line: string): string | undefined {
    // ISO 8601 format
    const isoMatch = line.match(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/);
    if (isoMatch) return isoMatch[0];

    // RFC 3339
    const rfcMatch = line.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}/);
    if (rfcMatch) return rfcMatch[0];

    return undefined;
}

/**
 * Generate log summary
 */
function generateLogSummary(
    totalLines: number,
    errorLines: LogEntry[],
    patterns: ErrorPattern[]
): string {
    let summary = `Analyzed ${totalLines} lines of logs.\n`;
    summary += `Errors: ${errorLines.length}\n`;

    if (patterns.length > 0) {
        summary += `\nDetected ${patterns.length} error patterns:\n`;
        for (const pattern of patterns) {
            summary += `  - ${pattern.name} (${pattern.matchedLines.length} occurrences)\n`;
        }
    } else {
        summary += '\n✅ No known error patterns detected.';
    }

    return summary;
}

/**
 * Generate recommendations
 */
function generateRecommendations(
    patterns: ErrorPattern[],
    repeatedErrors: RepeatedError[]
): string[] {
    const recommendations: string[] = [];

    // Prioritize critical patterns
    const criticalPatterns = patterns.filter(p => p.severity === 'critical');
    if (criticalPatterns.length > 0) {
        recommendations.push(
            `🔴 Resolve ${criticalPatterns.length} Critical issue(s) as top priority`
        );
    }

    // If there are many repeated errors
    if (repeatedErrors.length > 0) {
        const topError = repeatedErrors[0];
        recommendations.push(
            `⚠️ "${topError.message}" error is repeating ${topError.count} times. Find the root cause.`
        );
    }

    // Pattern-specific recommendations
    for (const pattern of patterns.slice(0, 3)) {  // Top 3 only
        recommendations.push(`💡 ${pattern.name}: ${pattern.solutions[0]}`);
    }

    if (recommendations.length === 0) {
        recommendations.push('✅ No special issues found in current logs.');
    }

    return recommendations;
}
