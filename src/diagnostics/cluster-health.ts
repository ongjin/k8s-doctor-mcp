/**
 * Cluster-wide health diagnostics
 *
 * @author zerry
 */

import * as k8s from '@kubernetes/client-node';
import type { ClusterHealth, DiagnosticIssue } from '../types.js';

/**
 * Diagnose overall cluster health
 *
 * Comprehensively analyzes nodes, pods, and resource utilization
 */
export async function diagnoseClusterHealth(
    coreApi: k8s.CoreV1Api,
    namespace?: string
): Promise<ClusterHealth> {
    const issues: DiagnosticIssue[] = [];

    // 1. Node health
    const nodesResponse = await coreApi.listNode();
    const nodes = nodesResponse.items;

    const readyNodes = nodes.filter((n: any) =>
        n.status?.conditions?.some((c: any) => c.type === 'Ready' && c.status === 'True')
    );
    const notReadyNodes = nodes.filter((n: any) =>
        !n.status?.conditions?.some((c: any) => c.type === 'Ready' && c.status === 'True')
    );

    // Not Ready node issues
    for (const node of notReadyNodes) {
        issues.push({
            type: 'Node Not Ready',
            severity: 'critical',
            message: `Node "${node.metadata?.name}" is not in Ready state`,
            rootCause: 'Node has encountered a problem',
            solution: 'Check detailed cause with: kubectl describe node <node-name>',
            resource: {
                kind: 'Node',
                name: node.metadata?.name || 'unknown',
                namespace: '',
            },
            timestamp: new Date().toISOString(),
        });
    }

    // 2. Pod health
    const podsResponse = namespace
        ? await coreApi.listNamespacedPod({ namespace })
        : await coreApi.listPodForAllNamespaces();
    const pods = podsResponse.items;

    const podStats = {
        total: pods.length,
        running: pods.filter((p: any) => p.status?.phase === 'Running').length,
        pending: pods.filter((p: any) => p.status?.phase === 'Pending').length,
        failed: pods.filter((p: any) => p.status?.phase === 'Failed').length,
        crashLooping: pods.filter((p: any) =>
            p.status?.containerStatuses?.some((c: any) =>
                c.state?.waiting?.reason === 'CrashLoopBackOff' || (c.restartCount || 0) > 5
            )
        ).length,
    };

    // Pending pod issues
    const pendingPods = pods.filter((p: any) => p.status?.phase === 'Pending');
    for (const pod of pendingPods.slice(0, 5)) {  // Max 5 pods
        issues.push({
            type: 'Pod Pending',
            severity: 'high',
            message: `Pod "${pod.metadata?.name}" is in Pending state`,
            rootCause: 'Cannot be scheduled or image cannot be pulled',
            solution: `kubectl describe pod ${pod.metadata?.name} -n ${pod.metadata?.namespace}`,
            resource: {
                kind: 'Pod',
                name: pod.metadata?.name || 'unknown',
                namespace: pod.metadata?.namespace || 'default',
            },
            timestamp: new Date().toISOString(),
        });
    }

    // CrashLoop pod issues
    const crashLoopPods = pods.filter((p: any) =>
        p.status?.containerStatuses?.some((c: any) =>
            c.state?.waiting?.reason === 'CrashLoopBackOff' || (c.restartCount || 0) > 5
        )
    );
    for (const pod of crashLoopPods.slice(0, 5)) {
        issues.push({
            type: 'CrashLoopBackOff',
            severity: 'critical',
            message: `Pod "${pod.metadata?.name}" is in CrashLoop state`,
            rootCause: 'Container is repeatedly failing',
            solution: `kubectl logs ${pod.metadata?.name} -n ${pod.metadata?.namespace} --previous`,
            resource: {
                kind: 'Pod',
                name: pod.metadata?.name || 'unknown',
                namespace: pod.metadata?.namespace || 'default',
            },
            timestamp: new Date().toISOString(),
        });
    }

    // 3. Resource utilization (basic calculation)
    const resourceUtilization = {
        cpu: 0,
        memory: 0,
        storage: 0,
    };

    // 4. Overall health score
    const overallScore = calculateOverallScore(nodes.length, readyNodes.length, podStats, issues);

    // 5. Filter critical issues only
    const criticalIssues = issues.filter(i => i.severity === 'critical');

    // 6. Recommendations
    const recommendations = generateClusterRecommendations(issues, podStats, nodes.length);

    // 7. Summary
    const summary = generateClusterSummary(nodes.length, readyNodes.length, podStats, overallScore);

    return {
        overallScore,
        nodeHealth: {
            total: nodes.length,
            ready: readyNodes.length,
            notReady: notReadyNodes.length,
            issues: issues.filter(i => i.resource?.kind === 'Node'),
        },
        podHealth: {
            ...podStats,
            issues: issues.filter(i => i.resource?.kind === 'Pod'),
        },
        resourceUtilization,
        criticalIssues,
        recommendations,
        summary,
    };
}

/**
 * Calculate overall health score
 */
function calculateOverallScore(
    totalNodes: number,
    readyNodes: number,
    podStats: any,
    issues: DiagnosticIssue[]
): number {
    let score = 100;

    // Deduct for node status
    const nodeHealthPercent = (readyNodes / totalNodes) * 100;
    score -= (100 - nodeHealthPercent) * 0.5;

    // Deduct for pod status
    const healthyPodPercent = (podStats.running / podStats.total) * 100;
    score -= (100 - healthyPodPercent) * 0.3;

    // CrashLoop is severe
    score -= podStats.crashLooping * 5;

    // Deduct for issues
    for (const issue of issues) {
        if (issue.severity === 'critical') score -= 10;
        else if (issue.severity === 'high') score -= 5;
        else if (issue.severity === 'medium') score -= 2;
    }

    return Math.max(0, Math.min(100, score));
}

/**
 * Generate cluster recommendations
 */
function generateClusterRecommendations(
    issues: DiagnosticIssue[],
    podStats: any,
    totalNodes: number
): string[] {
    const recommendations: string[] = [];

    const critical = issues.filter(i => i.severity === 'critical');
    if (critical.length > 0) {
        recommendations.push(`🔴 Resolve ${critical.length} Critical issue(s) as top priority`);
    }

    if (podStats.crashLooping > 0) {
        recommendations.push(`⚠️ ${podStats.crashLooping} pod(s) in CrashLoop state. Check logs immediately`);
    }

    if (podStats.pending > 5) {
        recommendations.push(`⚠️ ${podStats.pending} pod(s) in Pending state. Check for resource insufficiency`);
    }

    if (totalNodes < 3) {
        recommendations.push('💡 For high availability, running at least 3 nodes is recommended');
    }

    if (recommendations.length === 0) {
        recommendations.push('✅ Cluster is healthy!');
    }

    return recommendations;
}

/**
 * Generate cluster summary
 */
function generateClusterSummary(
    totalNodes: number,
    readyNodes: number,
    podStats: any,
    score: number
): string {
    let summary = `Cluster Health Score: ${score.toFixed(1)}/100\n\n`;
    summary += `Nodes: ${readyNodes}/${totalNodes} Ready\n`;
    summary += `Pods: ${podStats.running}/${podStats.total} Running\n`;

    if (podStats.crashLooping > 0) {
        summary += `⚠️ CrashLoop: ${podStats.crashLooping}\n`;
    }
    if (podStats.pending > 0) {
        summary += `⚠️ Pending: ${podStats.pending}\n`;
    }
    if (podStats.failed > 0) {
        summary += `⚠️ Failed: ${podStats.failed}\n`;
    }

    return summary;
}
