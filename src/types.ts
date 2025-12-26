/**
 * K8s Doctor type definitions
 *
 * @author zerry
 */

/**
 * Diagnostic severity
 * Represents urgency of Kubernetes issues
 */
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/**
 * Pod status
 * Possible pod states in K8s
 */
export type PodPhase = 'Pending' | 'Running' | 'Succeeded' | 'Failed' | 'Unknown';

/**
 * Diagnostic issue
 *
 * Contains each detected problem and solution.
 * Not just showing status but explaining "why this is a problem"
 */
export interface DiagnosticIssue {
    /** Issue type (e.g., "CrashLoopBackOff", "ImagePullBackOff") */
    type: string;

    /** Severity */
    severity: Severity;

    /** Human-readable description */
    message: string;

    /** Root cause analysis */
    rootCause: string;

    /** Suggested solution (includes specific kubectl commands) */
    solution: string;

    /** Related resource (pod name, namespace, etc.) */
    resource?: {
        kind: string;
        name: string;
        namespace: string;
    };

    /** Related log lines */
    relevantLogs?: string[];

    /** Related events */
    relatedEvents?: K8sEvent[];

    /** Discovery timestamp */
    timestamp: string;
}

/**
 * Pod diagnostics result
 *
 * Comprehensive diagnostics combining pod status, resource usage, events, etc.
 */
export interface PodDiagnostics {
    /** Pod basic information */
    podInfo: {
        name: string;
        namespace: string;
        phase: PodPhase;
        startTime?: string;
        nodeName?: string;
        hostIP?: string;
        podIP?: string;
    };

    /** Container status */
    containers: ContainerStatus[];

    /** Detected issues */
    issues: DiagnosticIssue[];

    /** Resource usage */
    resources: ResourceUsage;

    /** Recent events (problem-related) */
    events: K8sEvent[];

    /** Diagnosis summary */
    summary: string;

    /** Health score (0-100) */
    healthScore: number;
}

/**
 * Container status
 */
export interface ContainerStatus {
    /** Container name */
    name: string;

    /** Ready status */
    ready: boolean;

    /** Restart count */
    restartCount: number;

    /** Current state */
    state: {
        running?: { startedAt: string };
        waiting?: { reason: string; message?: string };
        terminated?: { reason: string; exitCode: number; message?: string };
    };

    /** Last state (if restarted) */
    lastState?: {
        terminated?: { reason: string; exitCode: number; finishedAt: string };
    };

    /** Image */
    image: string;

    /** Image pull status */
    imageID?: string;
}

/**
 * Resource usage
 *
 * CPU and memory usage with threshold comparison results
 */
export interface ResourceUsage {
    /** CPU usage */
    cpu: {
        /** Current usage (millicores) */
        current?: number;
        /** Requested amount (requests) */
        requested?: number;
        /** Limit amount (limits) */
        limit?: number;
        /** Usage percentage (%) */
        usagePercent?: number;
        /** Threshold exceeded */
        isThrottled: boolean;
    };

    /** Memory usage */
    memory: {
        /** Current usage (bytes) */
        current?: number;
        /** Requested amount (requests) */
        requested?: number;
        /** Limit amount (limits) */
        limit?: number;
        /** Usage percentage (%) */
        usagePercent?: number;
        /** OOM risk */
        isOOMRisk: boolean;
    };

    /** Disk usage */
    disk?: {
        current?: number;
        limit?: number;
        usagePercent?: number;
    };
}

/**
 * K8s event
 *
 * Events shown in kubectl describe
 */
export interface K8sEvent {
    /** Event type (Normal/Warning) */
    type: string;

    /** Reason (e.g., "Failed", "BackOff") */
    reason: string;

    /** Message */
    message: string;

    /** Occurrence count */
    count: number;

    /** First occurrence timestamp */
    firstTimestamp: string;

    /** Last occurrence timestamp */
    lastTimestamp: string;

    /** Source component */
    source?: string;
}

/**
 * Log analysis result
 *
 * Not just log output, but analyzed error patterns
 */
export interface LogAnalysis {
    /** Total line count */
    totalLines: number;

    /** Error lines */
    errorLines: LogEntry[];

    /** Warning lines */
    warningLines: LogEntry[];

    /** Detected error patterns */
    patterns: ErrorPattern[];

    /** Repeated errors (same error multiple times) */
    repeatedErrors: RepeatedError[];

    /** Log analysis summary */
    summary: string;

    /** Recommendations */
    recommendations: string[];
}

/**
 * Log entry
 */
export interface LogEntry {
    /** Line number */
    lineNumber: number;

    /** Log content */
    content: string;

    /** Timestamp (if parseable) */
    timestamp?: string;

    /** Log level */
    level?: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';
}

/**
 * Error pattern
 *
 * Patterns of commonly occurring errors with solutions
 */
export interface ErrorPattern {
    /** Pattern name */
    name: string;

    /** Matched log lines */
    matchedLines: number[];

    /** Pattern description */
    description: string;

    /** Possible causes */
    possibleCauses: string[];

    /** Solutions */
    solutions: string[];

    /** Severity */
    severity: Severity;
}

/**
 * Repeated error
 */
export interface RepeatedError {
    /** Error message (normalized) */
    message: string;

    /** Occurrence count */
    count: number;

    /** First occurrence line */
    firstLine: number;

    /** Last occurrence line */
    lastLine: number;

    /** Is pattern */
    isPattern: boolean;
}

/**
 * Network diagnostics result
 */
export interface NetworkDiagnostics {
    /** Service connectivity */
    serviceConnectivity: ServiceConnectivity[];

    /** DNS issues */
    dnsIssues: DiagnosticIssue[];

    /** Network policy issues */
    networkPolicyIssues: DiagnosticIssue[];

    /** Ingress issues */
    ingressIssues: DiagnosticIssue[];

    /** Diagnosis summary */
    summary: string;
}

/**
 * Service connectivity
 */
export interface ServiceConnectivity {
    /** Service name */
    serviceName: string;

    /** Namespace */
    namespace: string;

    /** Reachable status */
    isReachable: boolean;

    /** Endpoint count */
    endpointCount: number;

    /** Issues */
    issues: string[];
}

/**
 * Storage diagnostics result
 */
export interface StorageDiagnostics {
    /** PVC status */
    pvcStatus: PVCStatus[];

    /** Volume mount issues */
    mountIssues: DiagnosticIssue[];

    /** Capacity issues */
    capacityIssues: DiagnosticIssue[];

    /** Diagnosis summary */
    summary: string;
}

/**
 * PVC status
 */
export interface PVCStatus {
    /** PVC name */
    name: string;

    /** Namespace */
    namespace: string;

    /** Phase (Bound/Pending/Lost) */
    phase: string;

    /** Requested capacity */
    requestedCapacity: string;

    /** Actual capacity */
    actualCapacity?: string;

    /** Storage class */
    storageClass?: string;

    /** Issues */
    issues: string[];
}

/**
 * Cluster health diagnosis
 */
export interface ClusterHealth {
    /** Overall health score (0-100) */
    overallScore: number;

    /** Node health */
    nodeHealth: {
        total: number;
        ready: number;
        notReady: number;
        issues: DiagnosticIssue[];
    };

    /** Pod health */
    podHealth: {
        total: number;
        running: number;
        pending: number;
        failed: number;
        crashLooping: number;
        issues: DiagnosticIssue[];
    };

    /** Resource utilization */
    resourceUtilization: {
        cpu: number;
        memory: number;
        storage: number;
    };

    /** Critical issues */
    criticalIssues: DiagnosticIssue[];

    /** Recommendations */
    recommendations: string[];

    /** Diagnosis summary */
    summary: string;
}
