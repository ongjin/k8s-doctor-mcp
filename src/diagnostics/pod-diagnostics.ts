/**
 * Pod diagnostics module
 *
 * Comprehensively analyzes pod status, containers, and events
 * to identify the root cause of problems
 *
 * @author zerry
 */

import * as k8s from '@kubernetes/client-node';
import type {
    PodDiagnostics,
    DiagnosticIssue,
    ContainerStatus,
    ResourceUsage,
    K8sEvent,
    PodPhase,
} from '../types.js';
import { withRetry } from '../utils/retry.js';

/**
 * Comprehensive pod diagnostics
 *
 * This is the core feature. Analyzes all pod states
 * to clearly explain "why it's not working"
 */
export async function diagnosePod(
    coreApi: k8s.CoreV1Api,
    namespace: string,
    podName: string,
    metricsApi?: k8s.Metrics
): Promise<PodDiagnostics> {
    try {
        console.error(`[diagnosePod] Starting diagnostics for pod ${podName} in namespace ${namespace}`);

        // Parallel API calls for better performance
        const [pod, eventsResponse] = await Promise.all([
            // 1. Get pod information with retry
            withRetry(() => coreApi.readNamespacedPod({ name: podName, namespace }), {
                maxAttempts: 3,
                initialDelay: 500,
            }).catch((error) => {
                console.error(`[diagnosePod] Failed to get pod info:`, error.message);
                throw new Error(`Cannot read pod ${podName}: ${error.message}`);
            }),

            // 2. Get pod events with retry
            withRetry(() => coreApi.listNamespacedEvent({
                namespace,
                fieldSelector: `involvedObject.name=${podName}`,
            }), {
                maxAttempts: 2, // Events are less critical, fewer retries
                initialDelay: 500,
            }).catch((error) => {
                console.error(`[diagnosePod] Failed to get events (non-fatal):`, error.message);
                // Return empty events instead of failing
                return { items: [] };
            }),
        ]);

        const events = parseEvents(eventsResponse.items);

        // 3. Analyze container status
        const containers = parseContainerStatuses(pod.status?.containerStatuses || []);

        // 4. Detect issues
        const issues: DiagnosticIssue[] = [];

        // Container-related issues
        issues.push(...detectContainerIssues(pod, containers, events));

        // Image pull issues
        issues.push(...detectImagePullIssues(pod, events));

        // Resource-related issues
        const resources = await analyzeResourceUsage(pod, namespace, podName, metricsApi);
        issues.push(...detectResourceIssues(pod, resources));

        // Volume mount issues
        issues.push(...detectVolumeIssues(pod, events));

        // Network issues
        issues.push(...detectNetworkIssues(pod, events));

        // 5. Calculate health score
        const healthScore = calculateHealthScore(pod, issues);

        // 6. Generate summary
        const summary = generatePodSummary(pod, issues, healthScore);

        return {
            podInfo: {
                name: pod.metadata?.name || podName,
                namespace: pod.metadata?.namespace || namespace,
                phase: (pod.status?.phase as PodPhase) || 'Unknown',
                startTime: pod.status?.startTime?.toISOString(),
                nodeName: pod.spec?.nodeName,
                hostIP: pod.status?.hostIP,
                podIP: pod.status?.podIP,
            },
            containers,
            issues,
            resources,
            events,
            summary,
            healthScore,
        };
    } catch (error: any) {
        console.error(`[diagnosePod] Fatal error:`, error);
        throw new Error(`Pod diagnosis failed: ${error.message}`);
    }
}

/**
 * Specialized CrashLoopBackOff diagnostics
 *
 * CrashLoop is really tricky, this function accurately identifies the cause
 */
export async function diagnoseCrashLoop(
    coreApi: k8s.CoreV1Api,
    logApi: k8s.Log,
    namespace: string,
    podName: string,
    containerName?: string
): Promise<DiagnosticIssue[]> {
    const issues: DiagnosticIssue[] = [];

    try {
        console.error(`[diagnoseCrashLoop] Analyzing pod ${podName} in namespace ${namespace}`);

        const pod = await withRetry(
            () => coreApi.readNamespacedPod({ name: podName, namespace }),
            { maxAttempts: 3 }
        );

        const containerStatuses = pod.status?.containerStatuses || [];

        for (const status of containerStatuses) {
            // If containerName specified, only that container
            if (containerName && status.name !== containerName) continue;

            const restartCount = status.restartCount || 0;

            // Detect CrashLoop
            if (restartCount > 3 || status.state?.waiting?.reason === 'CrashLoopBackOff') {
                // Check termination reason from previous state
                const lastTerminated = status.lastState?.terminated;
                let rootCause = 'unknown';
                let solution = '';

                if (lastTerminated) {
                    const exitCode = lastTerminated.exitCode;

                    // Analyze exit code
                    if (exitCode === 0) {
                        rootCause = 'Container exited normally but keeps restarting due to restart policy';
                        solution = 'Change spec.restartPolicy to "Never" or "OnFailure"\n```yaml\nspec:\n  restartPolicy: OnFailure\n```';
                    } else if (exitCode === 1) {
                        rootCause = 'Application error caused termination';
                        solution = 'Check logs to fix application errors\n```bash\nkubectl logs ' + podName + ' -n ' + namespace + ' -c ' + status.name + ' --previous\n```';
                    } else if (exitCode === 137) {
                        rootCause = 'OOM (Out Of Memory) - Container was killed due to insufficient memory';
                        solution = 'Increase memory limit or optimize application memory usage\n```yaml\nresources:\n  limits:\n    memory: "512Mi"  # Set higher than current\n```';
                    } else if (exitCode === 143) {
                        rootCause = 'Terminated by SIGTERM - Received normal termination signal';
                        solution = 'Graceful shutdown may not be properly implemented. Try increasing terminationGracePeriodSeconds';
                    } else if (exitCode === 126) {
                        rootCause = 'Permission denied - Executable file lacks execute permission';
                        solution = 'Grant execute permission with chmod +x in Dockerfile';
                    } else if (exitCode === 127) {
                        rootCause = 'Command not found - CMD/ENTRYPOINT command does not exist';
                        solution = 'Verify CMD/ENTRYPOINT path in Dockerfile';
                    } else {
                        rootCause = `Unknown error (exit code ${exitCode})`;
                        solution = 'Check logs to identify detailed cause';
                    }
                }

                // Find additional clues in logs
                try {
                    const { Writable } = require('stream');
                    const stream = new Writable();
                    let logData = '';

                    stream._write = (chunk: any, _encoding: string, next: Function) => {
                        logData += chunk.toString();
                        next();
                    };

                    await withRetry(
                        () => logApi.log(namespace, podName, status.name, stream, {
                            previous: true,
                            tailLines: 50,
                        }),
                        { maxAttempts: 2 }
                    );

                    // Find error patterns in logs
                    const relevantLogs: string[] = [];
                    const lines = logData.split('\n');

                    for (const line of lines) {
                        if (
                            line.toLowerCase().includes('error') ||
                            line.toLowerCase().includes('exception') ||
                            line.toLowerCase().includes('fatal') ||
                            line.toLowerCase().includes('panic')
                        ) {
                            relevantLogs.push(line.trim());
                        }
                    }

                    issues.push({
                        type: 'CrashLoopBackOff',
                        severity: 'critical',
                        message: `Container "${status.name}" has restarted ${restartCount} times`,
                        rootCause,
                        solution,
                        resource: {
                            kind: 'Pod',
                            name: podName,
                            namespace,
                        },
                        relevantLogs: relevantLogs.slice(0, 10), // Max 10 lines
                        timestamp: new Date().toISOString(),
                    });
                } catch (logError: any) {
                    console.error(`[diagnoseCrashLoop] Failed to retrieve logs for ${status.name}:`, logError.message);
                    // Add issue even if logs cannot be retrieved
                    issues.push({
                        type: 'CrashLoopBackOff',
                        severity: 'critical',
                        message: `Container "${status.name}" has restarted ${restartCount} times`,
                        rootCause,
                        solution,
                        resource: {
                            kind: 'Pod',
                            name: podName,
                            namespace,
                        },
                        timestamp: new Date().toISOString(),
                    });
                }
            }
        }
    } catch (error: any) {
        throw new Error(`CrashLoop diagnostics failed: ${error.message}`);
    }

    return issues;
}

/**
 * Parse container statuses
 */
function parseContainerStatuses(statuses: any[]): ContainerStatus[] {
    return statuses.map(s => ({
        name: s.name,
        ready: s.ready || false,
        restartCount: s.restartCount || 0,
        state: s.state || {},
        lastState: s.lastState,
        image: s.image,
        imageID: s.imageID,
    }));
}

/**
 * Parse events
 */
function parseEvents(items: any[]): K8sEvent[] {
    return items
        .map(e => ({
            type: e.type,
            reason: e.reason,
            message: e.message,
            count: e.count || 1,
            firstTimestamp: e.firstTimestamp,
            lastTimestamp: e.lastTimestamp,
            source: e.source?.component,
        }))
        .sort((a, b) =>
            new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime()
        );
}

/**
 * Detect container issues
 */
function detectContainerIssues(
    pod: any,
    containers: ContainerStatus[],
    _events: K8sEvent[]
): DiagnosticIssue[] {
    const issues: DiagnosticIssue[] = [];

    for (const container of containers) {
        // Check Waiting state
        if (container.state.waiting) {
            const reason = container.state.waiting.reason;
            const message = container.state.waiting.message;

            if (reason === 'ErrImagePull' || reason === 'ImagePullBackOff') {
                // Image pull issues are handled in a separate function
                continue;
            }

            issues.push({
                type: `Container Waiting: ${reason}`,
                severity: 'high',
                message: `Container "${container.name}" is in ${reason} state`,
                rootCause: message || 'Unknown reason',
                solution: getWaitingSolution(reason),
                resource: {
                    kind: 'Pod',
                    name: pod.metadata?.name,
                    namespace: pod.metadata?.namespace,
                },
                timestamp: new Date().toISOString(),
            });
        }

        // Check Terminated state
        if (container.state.terminated && container.state.terminated.exitCode !== 0) {
            issues.push({
                type: 'Container Terminated',
                severity: 'high',
                message: `Container "${container.name}" terminated with exit code ${container.state.terminated.exitCode}`,
                rootCause: container.state.terminated.reason || 'Unknown reason',
                solution: getTerminatedSolution(container.state.terminated.exitCode),
                resource: {
                    kind: 'Pod',
                    name: pod.metadata?.name,
                    namespace: pod.metadata?.namespace,
                },
                timestamp: new Date().toISOString(),
            });
        }
    }

    return issues;
}

/**
 * Detect image pull issues
 */
function detectImagePullIssues(pod: any, events: K8sEvent[]): DiagnosticIssue[] {
    const issues: DiagnosticIssue[] = [];

    const imagePullEvents = events.filter(e =>
        e.reason === 'Failed' && e.message.includes('pull')
    );

    if (imagePullEvents.length > 0) {
        const event = imagePullEvents[0];
        let rootCause = 'Cannot download image';
        let solution = '';

        if (event.message.includes('not found') || event.message.includes('manifest unknown')) {
            rootCause = 'Image or tag does not exist';
            solution = '1. Verify image name and tag\n2. Test locally with docker pull <image>';
        } else if (event.message.includes('unauthorized') || event.message.includes('authentication')) {
            rootCause = 'Image registry authentication failed';
            solution = '```bash\nkubectl create secret docker-registry regcred \\\n  --docker-server=<registry> \\\n  --docker-username=<username> \\\n  --docker-password=<password>\n\n# Add to Pod spec:\nspec:\n  imagePullSecrets:\n  - name: regcred\n```';
        } else if (event.message.includes('timeout')) {
            rootCause = 'Network timeout - Cannot access registry';
            solution = '1. Check cluster network connectivity\n2. Verify firewall/proxy settings\n3. Verify registry URL is correct';
        }

        issues.push({
            type: 'ImagePullBackOff',
            severity: 'critical',
            message: 'Cannot pull container image',
            rootCause,
            solution,
            resource: {
                kind: 'Pod',
                name: pod.metadata?.name,
                namespace: pod.metadata?.namespace,
            },
            relatedEvents: [event],
            timestamp: new Date().toISOString(),
        });
    }

    return issues;
}

/**
 * Analyze resource usage
 *
 * Collects real-time metrics from Metrics Server if available
 */
async function analyzeResourceUsage(
    pod: any,
    namespace: string,
    podName: string,
    metricsApi?: k8s.Metrics
): Promise<ResourceUsage> {
    const containers = pod.spec?.containers || [];

    let totalCpuRequest = 0;
    let totalCpuLimit = 0;
    let totalMemRequest = 0;
    let totalMemLimit = 0;

    for (const container of containers) {
        const requests = container.resources?.requests || {};
        const limits = container.resources?.limits || {};

        totalCpuRequest += parseCPU(requests.cpu || '0');
        totalCpuLimit += parseCPU(limits.cpu || '0');
        totalMemRequest += parseMemory(requests.memory || '0');
        totalMemLimit += parseMemory(limits.memory || '0');
    }

    // Try to get real-time metrics from Metrics Server
    let currentCpu: number | undefined;
    let currentMem: number | undefined;
    let cpuUsagePercent: number | undefined;
    let memUsagePercent: number | undefined;

    if (metricsApi) {
        try {
            const metrics = await withRetry(
                () => metricsApi.getPodMetrics(namespace),
                {
                    maxAttempts: 2,
                    initialDelay: 500,
                    shouldRetry: (error) => {
                        // Don't retry if Metrics Server is not installed
                        if (error.statusCode === 404) return false;
                        return true;
                    },
                }
            );

            // Find the specific pod in the metrics list
            const podMetric = metrics.items?.find((item: any) => item.metadata?.name === podName);

            if (podMetric) {
                // Sum up all container metrics
                let totalCpuUsage = 0;
                let totalMemUsage = 0;

                for (const container of podMetric.containers || []) {
                    // CPU is in nanocores, convert to millicores
                    if (container.usage?.cpu) {
                        totalCpuUsage += parseMetricCPU(container.usage.cpu);
                    }
                    // Memory is in Ki, convert to bytes
                    if (container.usage?.memory) {
                        totalMemUsage += parseMetricMemory(container.usage.memory);
                    }
                }

                currentCpu = totalCpuUsage;
                currentMem = totalMemUsage;

                // Calculate usage percentages
                if (totalCpuLimit > 0) {
                    cpuUsagePercent = (currentCpu / totalCpuLimit) * 100;
                }
                if (totalMemLimit > 0) {
                    memUsagePercent = (currentMem / totalMemLimit) * 100;
                }
            }
        } catch (error: any) {
            // Metrics Server not available or pod metrics not ready
            // This is fine, we'll just show spec values
            if (error.statusCode !== 404) {
                console.error(`[analyzeResourceUsage] Failed to get metrics (non-fatal):`, error.message);
            }
        }
    }

    return {
        cpu: {
            current: currentCpu,
            requested: totalCpuRequest,
            limit: totalCpuLimit,
            usagePercent: cpuUsagePercent,
            isThrottled: cpuUsagePercent !== undefined && cpuUsagePercent >= 80,
        },
        memory: {
            current: currentMem,
            requested: totalMemRequest,
            limit: totalMemLimit,
            usagePercent: memUsagePercent,
            isOOMRisk: memUsagePercent !== undefined && memUsagePercent >= 90,
        },
    };
}

/**
 * Detect resource issues
 */
function detectResourceIssues(pod: any, resources: ResourceUsage): DiagnosticIssue[] {
    const issues: DiagnosticIssue[] = [];

    // Check for high CPU usage (throttling)
    if (resources.cpu.isThrottled && resources.cpu.usagePercent !== undefined) {
        issues.push({
            type: 'High CPU Usage',
            severity: 'high',
            message: `CPU usage is high (${resources.cpu.usagePercent.toFixed(1)}%)`,
            rootCause: 'CPU limit may be too low for current workload',
            solution: `Increase CPU limit or optimize application:\n\`\`\`yaml\nresources:\n  limits:\n    cpu: "${Math.ceil((resources.cpu.limit || 1000) * 1.5)}m"  # Increased by 50%\n\`\`\``,
            resource: {
                kind: 'Pod',
                name: pod.metadata?.name,
                namespace: pod.metadata?.namespace,
            },
            timestamp: new Date().toISOString(),
        });
    }

    // Check for OOM risk
    if (resources.memory.isOOMRisk && resources.memory.usagePercent !== undefined) {
        issues.push({
            type: 'OOM Risk',
            severity: 'critical',
            message: `Memory usage is critically high (${resources.memory.usagePercent.toFixed(1)}%)`,
            rootCause: 'Pod is at risk of OOM kill - memory usage exceeds 90% of limit',
            solution: `Increase memory limit immediately:\n\`\`\`yaml\nresources:\n  limits:\n    memory: "${Math.ceil((resources.memory.limit || 512 * 1024 * 1024) / (1024 * 1024) * 1.5)}Mi"  # Increased by 50%\n\`\`\``,
            resource: {
                kind: 'Pod',
                name: pod.metadata?.name,
                namespace: pod.metadata?.namespace,
            },
            timestamp: new Date().toISOString(),
        });
    }

    // When resource limits are not set
    if (!resources.cpu.limit) {
        issues.push({
            type: 'Missing CPU Limit',
            severity: 'medium',
            message: 'CPU limit is not set',
            rootCause: 'CPU usage can increase without limit',
            solution: '```yaml\nresources:\n  limits:\n    cpu: "1000m"\n  requests:\n    cpu: "100m"\n```',
            resource: {
                kind: 'Pod',
                name: pod.metadata?.name,
                namespace: pod.metadata?.namespace,
            },
            timestamp: new Date().toISOString(),
        });
    }

    if (!resources.memory.limit) {
        issues.push({
            type: 'Missing Memory Limit',
            severity: 'high',
            message: 'Memory limit is not set',
            rootCause: 'Memory leak can affect entire node',
            solution: '```yaml\nresources:\n  limits:\n    memory: "512Mi"\n  requests:\n    memory: "128Mi"\n```',
            resource: {
                kind: 'Pod',
                name: pod.metadata?.name,
                namespace: pod.metadata?.namespace,
            },
            timestamp: new Date().toISOString(),
        });
    }

    return issues;
}

/**
 * Detect volume issues
 */
function detectVolumeIssues(pod: any, events: K8sEvent[]): DiagnosticIssue[] {
    const issues: DiagnosticIssue[] = [];

    const volumeEvents = events.filter(e =>
        e.message.includes('volume') || e.message.includes('mount')
    );

    for (const event of volumeEvents) {
        if (event.type === 'Warning') {
            issues.push({
                type: 'Volume Mount Issue',
                severity: 'high',
                message: 'Volume mount failed',
                rootCause: event.message,
                solution: '1. Verify PVC is in Bound state\n2. Verify storage class is correct\n3. Check status with kubectl describe pvc <pvc-name>',
                resource: {
                    kind: 'Pod',
                    name: pod.metadata?.name,
                    namespace: pod.metadata?.namespace,
                },
                relatedEvents: [event],
                timestamp: new Date().toISOString(),
            });
        }
    }

    return issues;
}

/**
 * Detect network issues
 */
function detectNetworkIssues(pod: any, events: K8sEvent[]): DiagnosticIssue[] {
    const issues: DiagnosticIssue[] = [];

    const networkEvents = events.filter(e =>
        e.message.includes('network') || e.message.includes('CNI')
    );

    for (const event of networkEvents) {
        if (event.type === 'Warning') {
            issues.push({
                type: 'Network Configuration Issue',
                severity: 'high',
                message: 'Network configuration problem',
                rootCause: event.message,
                solution: '1. Check CNI plugin status\n2. Check network policy\n3. Verify Pod CIDR range',
                resource: {
                    kind: 'Pod',
                    name: pod.metadata?.name,
                    namespace: pod.metadata?.namespace,
                },
                relatedEvents: [event],
                timestamp: new Date().toISOString(),
            });
        }
    }

    return issues;
}

/**
 * Calculate health score
 */
function calculateHealthScore(pod: any, issues: DiagnosticIssue[]): number {
    let score = 100;

    // Deductions based on pod phase
    const phase = pod.status?.phase;
    if (phase === 'Failed') score -= 100;
    else if (phase === 'Pending') score -= 30;
    else if (phase === 'Unknown') score -= 50;

    // Deductions based on issues
    for (const issue of issues) {
        if (issue.severity === 'critical') score -= 30;
        else if (issue.severity === 'high') score -= 20;
        else if (issue.severity === 'medium') score -= 10;
        else if (issue.severity === 'low') score -= 5;
    }

    return Math.max(0, Math.min(100, score));
}

/**
 * Generate pod summary
 */
function generatePodSummary(pod: any, issues: DiagnosticIssue[], healthScore: number): string {
    const phase = pod.status?.phase || 'Unknown';
    const containerCount = pod.spec?.containers?.length || 0;
    const readyContainers = pod.status?.containerStatuses?.filter((c: any) => c.ready).length || 0;

    let summary = `Pod "${pod.metadata?.name}" is currently in ${phase} state.\n`;
    summary += `Containers: ${readyContainers}/${containerCount} ready\n`;
    summary += `Health: ${healthScore}/100\n\n`;

    if (issues.length === 0) {
        summary += '✅ No issues found!';
    } else {
        summary += `⚠️ ${issues.length} issue(s) detected.\n`;
        const critical = issues.filter(i => i.severity === 'critical').length;
        const high = issues.filter(i => i.severity === 'high').length;
        if (critical > 0) summary += `  - Critical: ${critical}\n`;
        if (high > 0) summary += `  - High: ${high}\n`;
    }

    return summary;
}

// ===== Helper functions =====

function getWaitingSolution(reason: string): string {
    const solutions: Record<string, string> = {
        'CreateContainerConfigError': 'Check container configuration (ConfigMap, Secret, etc.)',
        'InvalidImageName': 'Verify image name format',
        'CreateContainerError': 'Check container creation settings',
    };
    return solutions[reason] || 'Check logs and events to identify the cause';
}

function getTerminatedSolution(exitCode: number): string {
    const solutions: Record<number, string> = {
        1: 'Check application logs to fix errors',
        137: 'Increase memory limit (OOM killed)',
        143: 'Verify graceful shutdown implementation',
        126: 'Check executable permissions (chmod +x)',
        127: 'Verify CMD/ENTRYPOINT path',
    };
    return solutions[exitCode] || `Check logs for exit code ${exitCode}`;
}

function parseCPU(cpu: string): number {
    if (cpu.endsWith('m')) {
        return parseInt(cpu.slice(0, -1));
    }
    return parseFloat(cpu) * 1000;
}

function parseMemory(mem: string): number {
    const units: Record<string, number> = {
        'Ki': 1024,
        'Mi': 1024 * 1024,
        'Gi': 1024 * 1024 * 1024,
        'K': 1000,
        'M': 1000 * 1000,
        'G': 1000 * 1000 * 1000,
    };

    for (const [unit, multiplier] of Object.entries(units)) {
        if (mem.endsWith(unit)) {
            return parseFloat(mem.slice(0, -unit.length)) * multiplier;
        }
    }

    return parseFloat(mem);
}

/**
 * Parse CPU from Metrics API format
 * Metrics API returns nanocores (e.g., "123456789n") or millicores (e.g., "123m")
 */
function parseMetricCPU(cpu: string): number {
    if (cpu.endsWith('n')) {
        // Nanocores to millicores: divide by 1,000,000
        return parseInt(cpu.slice(0, -1)) / 1_000_000;
    } else if (cpu.endsWith('m')) {
        // Already in millicores
        return parseInt(cpu.slice(0, -1));
    } else {
        // Cores to millicores: multiply by 1000
        return parseFloat(cpu) * 1000;
    }
}

/**
 * Parse Memory from Metrics API format
 * Metrics API returns in Ki (e.g., "123456Ki")
 */
function parseMetricMemory(mem: string): number {
    if (mem.endsWith('Ki')) {
        return parseInt(mem.slice(0, -2)) * 1024;
    } else if (mem.endsWith('Mi')) {
        return parseInt(mem.slice(0, -2)) * 1024 * 1024;
    } else if (mem.endsWith('Gi')) {
        return parseInt(mem.slice(0, -2)) * 1024 * 1024 * 1024;
    }
    // Assume bytes
    return parseInt(mem);
}
