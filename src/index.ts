#!/usr/bin/env node
/**
 * K8s Doctor MCP Server
 *
 * MCP server for AI-powered Kubernetes cluster diagnosis and problem solving.
 * Goes beyond simple queries - analyzes error logs, identifies root causes, and suggests solutions.
 *
 * @author zerry
 * @license MIT
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod';
import * as k8s from '@kubernetes/client-node';
import { loadK8sConfig, createK8sClients } from './utils/k8s-client.js';
import { diagnosePod, diagnoseCrashLoop } from './diagnostics/pod-diagnostics.js';
import { analyzeLogs } from './analyzers/log-analyzer.js';
import { diagnoseClusterHealth } from './diagnostics/cluster-health.js';
import { formatIssues, formatBytes, formatCPU, getHealthEmoji, createTable } from './utils/formatters.js';
import { MemoryCache, getOrCompute } from './utils/cache.js';

// ============================================
// MCP Server Initialization
// ============================================
const server = new McpServer({
    name: 'k8s-doctor',
    version: '1.0.0',
});

// Kubernetes client initialization
let k8sClients: ReturnType<typeof createK8sClients> | null = null;
let k8sConfig: k8s.KubeConfig | null = null;

// Cache instances for performance optimization
const namespaceCache = new MemoryCache<any>(30000); // 30 seconds TTL
const podListCache = new MemoryCache<any>(30000); // 30 seconds TTL

/**
 * Get K8s clients with lazy initialization
 */
function getK8sClients(): ReturnType<typeof createK8sClients> {
    if (!k8sClients || !k8sConfig) {
        try {
            k8sConfig = loadK8sConfig();
            k8sClients = createK8sClients(k8sConfig);
            console.error('✅ Kubernetes connection established');
        } catch (error: any) {
            console.error('❌ Kubernetes connection failed:', error.message);
            throw new Error(`Cannot connect to Kubernetes: ${error.message}\nPlease verify kubectl is configured.`);
        }
    }
    return k8sClients;
}

/**
 * Comprehensive pod diagnostics
 *
 * This is the core feature! Clearly explains why the pod is not working.
 * Analyzes all issues including CrashLoopBackOff, ImagePullBackOff, OOM, etc.
 */
server.registerTool(
    'diagnose-pod',
    {
        title: 'Comprehensive pod diagnostics',
        description: 'Analyzes pod status, logs, and events to identify root causes and suggest solutions',
        inputSchema: {
            namespace: z.string().describe('Namespace'),
            podName: z.string().describe('Pod name'),
            detailed: z.boolean().default(true).describe('Enable detailed analysis (includes logs)'),
        },
    },
    async ({ namespace, podName, detailed }) => {
        try {
            const diagnostics = await diagnosePod(
                getK8sClients().core,
                namespace,
                podName,
                getK8sClients().metrics
            );

            let result = `# 🏥 Pod Diagnosis Report\n\n`;
            result += `**Pod**: ${diagnostics.podInfo.name}\n`;
            result += `**Namespace**: ${diagnostics.podInfo.namespace}\n`;
            result += `**Status**: ${diagnostics.podInfo.phase}\n`;
            result += `**Node**: ${diagnostics.podInfo.nodeName || 'N/A'}\n`;
            result += `**Health**: ${getHealthEmoji(diagnostics.healthScore)} ${diagnostics.healthScore}/100\n\n`;

            // Summary
            result += `## 📊 Summary\n\n${diagnostics.summary}\n\n`;

            // Container Status
            result += `## 🐳 Container Status\n\n`;
            const containerRows = diagnostics.containers.map(c => [
                c.name,
                c.ready ? '✅' : '❌',
                c.restartCount.toString(),
                c.state.running ? 'Running' :
                c.state.waiting ? `Waiting: ${c.state.waiting.reason}` :
                c.state.terminated ? `Terminated: ${c.state.terminated.reason}` : 'Unknown',
            ]);
            result += createTable(['Name', 'Ready', 'Restarts', 'State'], containerRows);
            result += '\n\n';

            // Resource usage
            result += `## 💾 Resources\n\n`;
            result += `**CPU**:\n`;
            if (diagnostics.resources.cpu.current !== undefined) {
                result += `  - Current: ${formatCPU(diagnostics.resources.cpu.current)}`;
                if (diagnostics.resources.cpu.usagePercent !== undefined) {
                    const emoji = diagnostics.resources.cpu.usagePercent >= 80 ? ' ⚠️' : '';
                    result += ` (${diagnostics.resources.cpu.usagePercent.toFixed(1)}%${emoji})\n`;
                } else {
                    result += '\n';
                }
            }
            if (diagnostics.resources.cpu.requested) {
                result += `  - Requested: ${formatCPU(diagnostics.resources.cpu.requested)}\n`;
            }
            if (diagnostics.resources.cpu.limit) {
                result += `  - Limit: ${formatCPU(diagnostics.resources.cpu.limit)}\n`;
            }
            if (diagnostics.resources.cpu.isThrottled) {
                result += `  - ⚠️ **WARNING**: CPU usage is high (>80%)\n`;
            }

            result += `\n**Memory**:\n`;
            if (diagnostics.resources.memory.current !== undefined) {
                result += `  - Current: ${formatBytes(diagnostics.resources.memory.current)}`;
                if (diagnostics.resources.memory.usagePercent !== undefined) {
                    const emoji = diagnostics.resources.memory.usagePercent >= 90 ? ' 🔴' :
                                 diagnostics.resources.memory.usagePercent >= 80 ? ' ⚠️' : '';
                    result += ` (${diagnostics.resources.memory.usagePercent.toFixed(1)}%${emoji})\n`;
                } else {
                    result += '\n';
                }
            }
            if (diagnostics.resources.memory.requested) {
                result += `  - Requested: ${formatBytes(diagnostics.resources.memory.requested)}\n`;
            }
            if (diagnostics.resources.memory.limit) {
                result += `  - Limit: ${formatBytes(diagnostics.resources.memory.limit)}\n`;
            }
            if (diagnostics.resources.memory.isOOMRisk) {
                result += `  - 🔴 **CRITICAL**: OOM risk detected (>90%)\n`;
            }

            if (!diagnostics.resources.cpu.current && !diagnostics.resources.memory.current) {
                result += `\n💡 **Tip**: Install Metrics Server to see real-time usage:\n`;
                result += '```bash\nkubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml\n```\n';
            }
            result += '\n\n';

            // Issues
            result += formatIssues(diagnostics.issues);

            // Recent Events
            if (diagnostics.events.length > 0) {
                result += `## 📋 Recent Events (last 5)\n\n`;
                for (const event of diagnostics.events.slice(0, 5)) {
                    const icon = event.type === 'Warning' ? '⚠️' : 'ℹ️';
                    result += `${icon} **${event.reason}** (${event.count} times)\n`;
                    result += `   ${event.message}\n\n`;
                }
            }

            return { content: [{ type: 'text', text: result }] };
        } catch (error: any) {
            return {
                content: [{
                    type: 'text',
                    text: `❌ Pod diagnosis failed: ${error.message}\n\nVerify pod exists:\n\`\`\`bash\nkubectl get pod ${podName} -n ${namespace}\n\`\`\``,
                }],
            };
        }
    }
);

/**
 * Specialized CrashLoopBackOff diagnostics
 *
 * CrashLoop is really tricky - this tool analyzes exit codes
 * and logs to accurately identify the root cause
 */
server.registerTool(
    'debug-crashloop',
    {
        title: 'CrashLoopBackOff Diagnostics',
        description: 'Analyzes pods in CrashLoop state by examining exit codes, logs, and events to find the root cause',
        inputSchema: {
            namespace: z.string().describe('Namespace'),
            podName: z.string().describe('Pod name'),
            containerName: z.string().optional().describe('Container name (optional)'),
        },
    },
    async ({ namespace, podName, containerName }) => {
        try {
            const issues = await diagnoseCrashLoop(
                getK8sClients().core,
                getK8sClients().log,
                namespace,
                podName,
                containerName
            );

            let result = `# 🔍 CrashLoopBackOff Diagnostics\n\n`;
            result += `**Pod**: ${podName}\n`;
            result += `**Namespace**: ${namespace}\n\n`;

            if (issues.length === 0) {
                result += '✅ No CrashLoop issues detected.\n';
            } else {
                result += formatIssues(issues);
            }

            // Additional debugging commands
            result += `\n## 🛠️ Additional Debugging Commands\n\n`;
            result += '```bash\n';
            result += `# Check previous logs (important!)\n`;
            result += `kubectl logs ${podName} -n ${namespace} --previous\n\n`;
            result += `# Check current logs\n`;
            result += `kubectl logs ${podName} -n ${namespace}\n\n`;
            result += `# Check events\n`;
            result += `kubectl describe pod ${podName} -n ${namespace}\n\n`;
            result += `# Check pod YAML\n`;
            result += `kubectl get pod ${podName} -n ${namespace} -o yaml\n`;
            result += '```\n';

            return { content: [{ type: 'text', text: result }] };
        } catch (error: any) {
            return {
                content: [{
                    type: 'text',
                    text: `❌ CrashLoop diagnostics failed: ${error.message}`,
                }],
            };
        }
    }
);

/**
 * Log analysis
 *
 * Rather than just showing logs, finds error patterns
 * and identifies likely causes of errors
 */
server.registerTool(
    'analyze-logs',
    {
        title: 'Smart Log Analysis',
        description: 'Detects error patterns in logs and suggests causes and solutions (Connection Refused, OOM, DB errors, etc.)',
        inputSchema: {
            namespace: z.string().describe('Namespace'),
            podName: z.string().describe('Pod name'),
            containerName: z.string().optional().describe('Container name (optional)'),
            tailLines: z.number().default(500).describe('Number of recent lines to analyze'),
        },
    },
    async ({ namespace, podName, containerName, tailLines }) => {
        try {
            const analysis = await analyzeLogs(
                getK8sClients().log,
                namespace,
                podName,
                containerName,
                tailLines
            );

            let result = `# 📝 Log Analysis Results\n\n`;
            result += `${analysis.summary}\n\n`;

            // Detected patterns
            if (analysis.patterns.length > 0) {
                result += `## 🎯 Detected Error Patterns\n\n`;
                for (const pattern of analysis.patterns) {
                    result += `### ${pattern.name} (${pattern.matchedLines.length} occurrences)\n\n`;
                    result += `**Description**: ${pattern.description}\n\n`;
                    result += `**Possible Causes**:\n`;
                    for (const cause of pattern.possibleCauses) {
                        result += `  - ${cause}\n`;
                    }
                    result += `\n**Solutions**:\n`;
                    for (const solution of pattern.solutions) {
                        result += `  - ${solution}\n`;
                    }
                    result += `\n**Locations**: lines ${pattern.matchedLines.slice(0, 5).join(', ')}`;
                    if (pattern.matchedLines.length > 5) {
                        result += ` and ${pattern.matchedLines.length - 5} more`;
                    }
                    result += '\n\n---\n\n';
                }
            }

            // Repeated errors
            if (analysis.repeatedErrors.length > 0) {
                result += `## 🔁 Repeated Errors\n\n`;
                for (const repeated of analysis.repeatedErrors.slice(0, 5)) {
                    result += `- **${repeated.message}** (${repeated.count} times)\n`;
                    result += `  Lines ${repeated.firstLine} ~ ${repeated.lastLine}\n\n`;
                }
            }

            // Recommendations
            result += `## 💡 Recommendations\n\n`;
            for (const rec of analysis.recommendations) {
                result += `${rec}\n\n`;
            }

            // Error log samples
            if (analysis.errorLines.length > 0) {
                result += `\n## ❌ Error Log Samples (last 10)\n\n\`\`\`\n`;
                for (const line of analysis.errorLines.slice(-10)) {
                    result += `${line.lineNumber}: ${line.content}\n`;
                }
                result += '```\n';
            }

            return { content: [{ type: 'text', text: result }] };
        } catch (error: any) {
            return {
                content: [{
                    type: 'text',
                    text: `❌ Log analysis failed: ${error.message}`,
                }],
            };
        }
    }
);

/**
 * Resource usage check
 *
 * Checks if CPU/Memory is approaching limits and OOM risk
 */
server.registerTool(
    'check-resources',
    {
        title: 'Resource Usage Check',
        description: 'Compares pod CPU/Memory usage against limits to check for threshold violations',
        inputSchema: {
            namespace: z.string().describe('Namespace'),
            podName: z.string().optional().describe('Specific pod (optional, entire namespace if empty)'),
        },
    },
    async ({ namespace, podName }) => {
        try {
            const podsResponse = podName
                ? await getK8sClients().core.readNamespacedPod({ name: podName, namespace })
                : await getK8sClients().core.listNamespacedPod({ namespace });

            const pods = podName ? [podsResponse] : (podsResponse as any).items;

            // Try to get metrics
            let metricsMap = new Map<string, any>();
            let metricsAvailable = false;
            try {
                const metrics = await getK8sClients().metrics.getPodMetrics(namespace);
                for (const podMetric of metrics.items || []) {
                    const name = podMetric.metadata?.name;
                    if (name) {
                        // Sum container metrics for each pod
                        let totalCpu = 0;
                        let totalMem = 0;
                        for (const container of podMetric.containers || []) {
                            if (container.usage?.cpu) {
                                totalCpu += parseFloat(container.usage.cpu.replace('n', '')) / 1_000_000;
                            }
                            if (container.usage?.memory) {
                                totalMem += parseInt(container.usage.memory.replace('Ki', '')) * 1024;
                            }
                        }
                        metricsMap.set(name, { cpu: totalCpu, memory: totalMem });
                    }
                }
                metricsAvailable = metricsMap.size > 0;
            } catch (e) {
                // Metrics Server not available
            }

            let result = `# 💾 Resource Usage Check\n\n`;
            if (metricsAvailable) {
                result += `✅ **Real-time metrics available**\n\n`;
            } else {
                result += `⚠️ **Metrics Server not available** - showing only spec values\n\n`;
            }

            for (const pod of pods) {
                const containers = pod.spec?.containers || [];
                const podMetrics = metricsMap.get(pod.metadata?.name || '');
                result += `## Pod: ${pod.metadata?.name}\n\n`;

                // Calculate totals
                let totalCpuRequest = 0;
                let totalCpuLimit = 0;
                let totalMemRequest = 0;
                let totalMemLimit = 0;

                for (const container of containers) {
                    const requests = (container as any).resources?.requests || {};
                    const limits = (container as any).resources?.limits || {};

                    if (requests.cpu) {
                        const val = requests.cpu.endsWith('m') ? parseInt(requests.cpu) : parseFloat(requests.cpu) * 1000;
                        totalCpuRequest += val;
                    }
                    if (limits.cpu) {
                        const val = limits.cpu.endsWith('m') ? parseInt(limits.cpu) : parseFloat(limits.cpu) * 1000;
                        totalCpuLimit += val;
                    }
                    if (requests.memory) {
                        totalMemRequest += parseMemoryValue(requests.memory);
                    }
                    if (limits.memory) {
                        totalMemLimit += parseMemoryValue(limits.memory);
                    }
                }

                // Show current usage if available
                if (podMetrics) {
                    result += `**Current Usage**:\n`;
                    result += `  - CPU: ${formatCPU(podMetrics.cpu)}`;
                    if (totalCpuLimit > 0) {
                        const percent = (podMetrics.cpu / totalCpuLimit) * 100;
                        const emoji = percent >= 80 ? ' ⚠️' : '';
                        result += ` (${percent.toFixed(1)}%${emoji})`;
                    }
                    result += '\n';

                    result += `  - Memory: ${formatBytes(podMetrics.memory)}`;
                    if (totalMemLimit > 0) {
                        const percent = (podMetrics.memory / totalMemLimit) * 100;
                        const emoji = percent >= 90 ? ' 🔴' : percent >= 80 ? ' ⚠️' : '';
                        result += ` (${percent.toFixed(1)}%${emoji})`;
                    }
                    result += '\n\n';
                }

                const rows = [];
                for (const container of containers) {
                    const requests = (container as any).resources?.requests || {};
                    const limits = (container as any).resources?.limits || {};

                    rows.push([
                        container.name,
                        requests.cpu || 'N/A',
                        limits.cpu || '⚠️ None',
                        requests.memory || 'N/A',
                        limits.memory || '⚠️ None',
                    ]);
                }

                result += `**Resource Specs**:\n`;
                result += createTable(
                    ['Container', 'CPU Request', 'CPU Limit', 'Memory Request', 'Memory Limit'],
                    rows
                );
                result += '\n';

                // Warnings
                const noLimits = containers.filter((c: any) => !c.resources?.limits);
                if (noLimits.length > 0) {
                    result += `\n⚠️ **Warning**: ${noLimits.length} container(s) have no resource limits set\n`;
                    result += `This can lead to unlimited resource consumption.\n\n`;
                }

                // Threshold warnings
                if (podMetrics && totalCpuLimit > 0) {
                    const cpuPercent = (podMetrics.cpu / totalCpuLimit) * 100;
                    if (cpuPercent >= 80) {
                        result += `⚠️ **CPU Warning**: Usage is high (${cpuPercent.toFixed(1)}%)\n`;
                    }
                }
                if (podMetrics && totalMemLimit > 0) {
                    const memPercent = (podMetrics.memory / totalMemLimit) * 100;
                    if (memPercent >= 90) {
                        result += `🔴 **Memory Critical**: OOM risk detected (${memPercent.toFixed(1)}%)\n`;
                    } else if (memPercent >= 80) {
                        result += `⚠️ **Memory Warning**: Usage is high (${memPercent.toFixed(1)}%)\n`;
                    }
                }
            }

            if (!metricsAvailable) {
                result += `\n💡 **Tip**: Install Metrics Server to see real-time usage:\n`;
                result += '```bash\nkubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml\n```\n';
            }

            return { content: [{ type: 'text', text: result }] };
        } catch (error: any) {
            return {
                content: [{
                    type: 'text',
                    text: `❌ Resource check failed: ${error.message}`,
                }],
            };
        }
    }
);

/**
 * Cluster-wide Health Diagnosis
 *
 * Scans all nodes and pods in the cluster to check for problems
 */
server.registerTool(
    'full-diagnosis',
    {
        title: 'Cluster-wide Health Diagnosis',
        description: 'Comprehensively analyzes cluster nodes, pods, and resources to evaluate health',
        inputSchema: {
            namespace: z.string().optional().describe('Specific namespace only (optional, all if empty)'),
        },
    },
    async ({ namespace }) => {
        try {
            const health = await diagnoseClusterHealth(getK8sClients().core, namespace);

            let result = `# 🏥 Cluster Health Diagnosis\n\n`;
            result += `${health.summary}\n\n`;

            // Node Health
            result += `## 🖥️ Node Status\n\n`;
            result += `- Total: ${health.nodeHealth.total}\n`;
            result += `- Ready: ${health.nodeHealth.ready} ✅\n`;
            if (health.nodeHealth.notReady > 0) {
                result += `- Not Ready: ${health.nodeHealth.notReady} ❌\n`;
            }
            result += '\n';

            // Pod Health
            result += `## 🐳 Pod Status\n\n`;
            result += `- Total: ${health.podHealth.total}\n`;
            result += `- Running: ${health.podHealth.running} ✅\n`;
            if (health.podHealth.pending > 0) {
                result += `- Pending: ${health.podHealth.pending} ⏳\n`;
            }
            if (health.podHealth.failed > 0) {
                result += `- Failed: ${health.podHealth.failed} ❌\n`;
            }
            if (health.podHealth.crashLooping > 0) {
                result += `- CrashLoop: ${health.podHealth.crashLooping} 🔥\n`;
            }
            result += '\n';

            // Critical issues
            if (health.criticalIssues.length > 0) {
                result += `## 🔴 Critical Issues\n\n`;
                result += formatIssues(health.criticalIssues);
            }

            // Recommendations
            result += `## 💡 Recommendations\n\n`;
            for (const rec of health.recommendations) {
                result += `${rec}\n\n`;
            }

            return { content: [{ type: 'text', text: result }] };
        } catch (error: any) {
            console.error('Cluster diagnosis error:', error);
            return {
                content: [{
                    type: 'text',
                    text: `❌ Cluster diagnosis failed: ${error.message}\n\nDetails: ${error.stack || JSON.stringify(error, null, 2)}`,
                }],
            };
        }
    }
);

/**
 * Event Query and Analysis
 *
 * Shows resource events in chronological order and alerts on problems
 */
server.registerTool(
    'check-events',
    {
        title: 'Event Query and Analysis',
        description: 'Queries events for specific resources or namespaces and analyzes Warning events',
        inputSchema: {
            namespace: z.string().describe('Namespace'),
            resourceName: z.string().optional().describe('Resource name (optional, entire namespace if empty)'),
            showNormal: z.boolean().default(false).describe('Show Normal events too'),
        },
    },
    async ({ namespace, resourceName, showNormal }) => {
        try {
            const eventsResponse = await getK8sClients().core.listNamespacedEvent({
                namespace,
                fieldSelector: resourceName ? `involvedObject.name=${resourceName}` : undefined,
            });

            const events = eventsResponse.items;

            // 시간순 정렬 (최신순)
            events.sort((a: any, b: any) =>
                new Date(b.lastTimestamp || b.metadata?.creationTimestamp || '').getTime() -
                new Date(a.lastTimestamp || a.metadata?.creationTimestamp || '').getTime()
            );

            let result = `# 📋 Event Analysis\n\n`;
            result += `**Namespace**: ${namespace}\n`;
            if (resourceName) {
                result += `**Resource**: ${resourceName}\n`;
            }
            result += `\n`;

            const warnings = events.filter((e: any) => e.type === 'Warning');
            const normals = events.filter((e: any) => e.type === 'Normal');

            result += `Total ${events.length} events (Warning: ${warnings.length}, Normal: ${normals.length})\n\n`;

            // Warning events
            if (warnings.length > 0) {
                result += `## ⚠️ Warning Events\n\n`;
                for (const event of warnings.slice(0, 20)) {
                    result += `**${event.reason}** (${event.count || 1} times)\n`;
                    result += `  - ${event.message}\n`;
                    result += `  - Target: ${event.involvedObject?.kind}/${event.involvedObject?.name}\n`;
                    result += `  - Time: ${event.lastTimestamp || event.metadata?.creationTimestamp}\n\n`;
                }
            } else {
                result += `✅ No Warning events!\n\n`;
            }

            // Normal events (optional)
            if (showNormal && normals.length > 0) {
                result += `## ℹ️ Normal Events (last 10)\n\n`;
                for (const event of normals.slice(0, 10)) {
                    result += `- **${event.reason}**: ${event.message}\n`;
                }
                result += '\n';
            }

            return { content: [{ type: 'text', text: result }] };
        } catch (error: any) {
            return {
                content: [{
                    type: 'text',
                    text: `❌ Event query failed: ${error.message}`,
                }],
            };
        }
    }
);

/**
 * List namespaces
 *
 * Utility function - Check available namespaces
 */
server.registerTool(
    'list-namespaces',
    {
        title: 'List Namespaces',
        description: 'Lists all namespaces in the cluster',
        inputSchema: {},
    },
    async () => {
        try {
            // Use cache for namespace list
            const namespaces = await getOrCompute(
                namespaceCache,
                'all-namespaces',
                async () => {
                    const nsResponse = await getK8sClients().core.listNamespace();
                    return nsResponse.items;
                }
            );

            let result = `# 📁 Namespace List\n\n`;
            result += `Total: ${namespaces.length}\n\n`;

            for (const ns of namespaces) {
                const status = ns.status?.phase || 'Unknown';
                const icon = status === 'Active' ? '✅' : '❌';
                result += `${icon} **${ns.metadata?.name}** (${status})\n`;
            }

            return { content: [{ type: 'text', text: result }] };
        } catch (error: any) {
            return {
                content: [{
                    type: 'text',
                    text: `❌ Namespace query failed: ${error.message}`,
                }],
            };
        }
    }
);

/**
 * List pods
 *
 * Utility function - List pods in a namespace
 */
server.registerTool(
    'list-pods',
    {
        title: 'List Pods',
        description: 'Lists all pods in a specific namespace',
        inputSchema: {
            namespace: z.string().describe('Namespace'),
            showAll: z.boolean().default(false).describe('Show all pods (default shows only problematic pods)'),
        },
    },
    async ({ namespace, showAll }) => {
        try {
            // Use cache for pod list per namespace
            const pods = await getOrCompute(
                podListCache,
                `pods-${namespace}`,
                async () => {
                    const podsResponse = await getK8sClients().core.listNamespacedPod({ namespace });
                    return podsResponse.items;
                }
            );

            let result = `# 🐳 Pod List (${namespace})\n\n`;

            const rows = [];
            for (const pod of pods) {
                const phase = pod.status?.phase || 'Unknown';
                const restarts = pod.status?.containerStatuses?.reduce(
                    (sum: any, c: any) => sum + (c.restartCount || 0), 0
                ) || 0;
                const ready = pod.status?.containerStatuses?.filter((c: any) => c.ready).length || 0;
                const total = pod.status?.containerStatuses?.length || 0;

                // Filter problematic pods
                const hasProblem = phase !== 'Running' || restarts > 0;
                if (!showAll && !hasProblem) continue;

                const statusIcon = phase === 'Running' && restarts === 0 ? '✅' :
                                 phase === 'Pending' ? '⏳' :
                                 phase === 'Failed' ? '❌' :
                                 restarts > 5 ? '🔥' : '⚠️';

                rows.push([
                    statusIcon,
                    pod.metadata?.name || '',
                    phase,
                    `${ready}/${total}`,
                    restarts.toString(),
                    pod.spec?.nodeName || 'N/A',
                ]);
            }

            if (rows.length === 0) {
                result += '✅ All pods are healthy!\n';
            } else {
                result += createTable(['Status', 'Name', 'Phase', 'Ready', 'Restarts', 'Node'], rows);
            }

            return { content: [{ type: 'text', text: result }] };
        } catch (error: any) {
            return {
                content: [{
                    type: 'text',
                    text: `❌ Pod list query failed: ${error.message}`,
                }],
            };
        }
    }
);

// ============================================
// Helper functions
// ============================================
function parseMemoryValue(mem: string): number {
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

// ============================================
// Server startup
// ============================================
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('🏥 K8s Doctor MCP Server started');
    console.error('   Available in environments where kubectl commands work');
}

main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
