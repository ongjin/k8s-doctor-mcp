/**
 * Kubernetes client initialization
 *
 * @author zerry
 */

import * as k8s from '@kubernetes/client-node';

/**
 * Load K8s configuration
 *
 * Automatically finds and loads kubeconfig.
 * Works in-cluster as well
 */
export function loadK8sConfig(): k8s.KubeConfig {
    // Try local kubeconfig first (most common case)
    try {
        const kc = new k8s.KubeConfig();
        kc.loadFromDefault();
        return kc;
    } catch (localError) {
        // If local fails, try in-cluster config (when running inside pod)
        try {
            const kc = new k8s.KubeConfig();
            kc.loadFromCluster();
            return kc;
        } catch (clusterError) {
            throw new Error(
                'Cannot find kubeconfig. Please verify kubectl is configured.\n' +
                'Hint: Check connection with "kubectl cluster-info"'
            );
        }
    }
}

/**
 * Create K8s API clients
 *
 * Creates frequently used API clients at once
 */
export function createK8sClients(kc: k8s.KubeConfig) {
    return {
        core: kc.makeApiClient(k8s.CoreV1Api),
        apps: kc.makeApiClient(k8s.AppsV1Api),
        batch: kc.makeApiClient(k8s.BatchV1Api),
        networking: kc.makeApiClient(k8s.NetworkingV1Api),
        storage: kc.makeApiClient(k8s.StorageV1Api),
        log: new k8s.Log(kc),
        metrics: new k8s.Metrics(kc),
    };
}

/**
 * Validate namespace
 *
 * Check if namespace actually exists
 */
export async function validateNamespace(
    coreApi: k8s.CoreV1Api,
    namespace: string
): Promise<boolean> {
    try {
        await coreApi.readNamespace({ name: namespace });
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Check if pod exists
 */
export async function podExists(
    coreApi: k8s.CoreV1Api,
    namespace: string,
    podName: string
): Promise<boolean> {
    try {
        await coreApi.readNamespacedPod({ name: podName, namespace });
        return true;
    } catch (e) {
        return false;
    }
}
