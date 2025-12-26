# K8s Doctor MCP - Setup Guide

## Quick Start

### 1. Install Dependencies

```bash
cd /home/smj/workspace/mcp/k8s-doctor-mcp
npm install
```

### 2. Build the Project

```bash
npm run build
```

### 3. Test Locally

```bash
# Make sure kubectl is configured
kubectl cluster-info

# Run in development mode
npm run dev
```

### 4. Register with Claude Code

```bash
# Option 1: Using built output
claude mcp add k8s-doctor -- node /home/smj/workspace/mcp/k8s-doctor-mcp/dist/index.js

# Option 2: After publishing to npm
npm publish
claude mcp add k8s-doctor -- k8s-doctor-mcp
```

## Project Structure

```
k8s-doctor-mcp/
├── src/
│   ├── index.ts                 # Main MCP server with all tools
│   ├── types.ts                 # TypeScript type definitions
│   ├── diagnostics/
│   │   ├── pod-diagnostics.ts   # Pod health analysis + CrashLoop debugger
│   │   └── cluster-health.ts    # Cluster-wide diagnostics (English)
│   ├── analyzers/
│   │   └── log-analyzer.ts      # Smart log pattern matching
│   └── utils/
│       ├── k8s-client.ts        # Kubernetes API client setup
│       └── formatters.ts        # Output formatting utilities
├── dist/                        # Compiled JavaScript output
├── README.md                    # English documentation
├── README.ko.md                 # Korean documentation
├── LICENSE                      # MIT License
├── package.json
└── tsconfig.json
```

## Available MCP Tools

1. **diagnose-pod** - Comprehensive pod diagnostics
2. **debug-crashloop** - CrashLoopBackOff specialist
3. **analyze-logs** - Smart log pattern analysis
4. **check-resources** - Resource usage validation
5. **full-diagnosis** - Complete cluster health check
6. **check-events** - Event analysis
7. **list-namespaces** - Namespace listing
8. **list-pods** - Pod listing with status

## Testing

### Prerequisites

- Kubernetes cluster (minikube, kind, or remote)
- kubectl configured and working
- Node.js 18+

### Test Commands

```bash
# Check if kubectl works
kubectl cluster-info
kubectl get nodes

# Install dependencies
npm install

# Build
npm run build

# Development mode
npm run dev
```

### Example Usage with Claude

Once registered with Claude Code:

```
User: "Diagnose pod 'my-app' in namespace 'production'"
User: "Why is my pod CrashLooping?"
User: "Analyze logs for backend-worker and find errors"
User: "Check overall cluster health"
```

## Language Support

- **Default**: English (all cluster-health messages and diagnostics)
- **Supported**: Korean (README.ko.md available, can add i18n in future)

## Deployment Options

### Option 1: npm Global Install

```bash
npm run build
npm link
k8s-doctor-mcp
```

### Option 2: npx

```bash
npm publish
npx k8s-doctor-mcp
```

### Option 3: Direct Node Execution

```bash
npm run build
node dist/index.js
```

## Troubleshooting

### "kubeconfig not found"

```bash
export KUBECONFIG=~/.kube/config
kubectl cluster-info
```

### "Permission denied"

```bash
kubectl auth can-i get pods --all-namespaces
# Should return "yes"
```

### Build Errors

```bash
rm -rf node_modules dist
npm install
npm run build
```

## Next Steps

1. ✅ Basic implementation complete
2. ✅ Build successful
3. ✅ English as default language
4. 🔄 Test with real Kubernetes cluster
5. 📦 Publish to npm (optional)
6. 🌟 Get GitHub stars!

## Contributing

See main README.md for contribution guidelines.

## License

MIT © zerry
