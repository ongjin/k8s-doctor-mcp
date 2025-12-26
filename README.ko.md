# 🏥 K8s Doctor MCP

> AI 기반 Kubernetes 클러스터 진단 및 지능형 디버깅 추천 시스템

[![npm version](https://img.shields.io/npm/v/k8s-doctor-mcp)](https://www.npmjs.com/package/k8s-doctor-mcp)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-green)](https://nodejs.org)
[![Kubernetes](https://img.shields.io/badge/kubernetes-1.20%2B-blue)](https://kubernetes.io)

**[English](README.md)** | **[한국어](#한국어)**

## 데모

<!-- 여기에 데모 GIF 추가 -->
![K8s Doctor 데모](./docs/demo.gif)

## 왜 K8s Doctor가 필요한가요?

쿠버네티스 이슈가 발생하면 개발자들은 보통 이런 무한루프에 빠집니다:
- `kubectl get pods`
- `kubectl logs`
- `kubectl describe`
- 구글링, 스택오버플로우 검색...

**K8s Doctor가 게임체인저입니다.** 단순한 kubectl 래퍼가 아니라 AI 기반 진단 도구로:

- 🔍 **근본 원인 분석** - 단순 상태 체크를 넘어선 분석
- 🧠 **에러 패턴 감지** - 흔한 이슈 자동 인식 (Connection Refused, OOM, DNS 실패 등)
- 💡 **실행 가능한 해결책 제공** - 정확한 kubectl 명령어까지 알려줌
- 📊 **Exit code 분석** - exit 137, 143, 1이 무슨 의미인지 설명
- 🎯 **로그 패턴 매칭** - 수천 줄 로그에서 핵심만 추출
- 🏥 **건강도 점수** - 파드/클러스터 건강도를 0-100점으로 평가

## 주요 기능

| 도구 | 설명 |
|------|------|
| `diagnose-pod` | **파드 종합 진단** - 상태, 이벤트, 리소스 분석 및 건강도 점수 제공 |
| `debug-crashloop` | **CrashLoopBackOff 전문가** - exit code 해석, 로그 분석, 근본 원인 파악 |
| `analyze-logs` | **스마트 로그 분석** - 에러 패턴 감지, 흔한 문제 해결책 제안 |
| `check-resources` | **리소스 사용량** - CPU/Memory limit 확인, OOM 위험 경고 |
| `full-diagnosis` | **클러스터 건강 체크** - 모든 노드와 파드 스캔 |
| `check-events` | **이벤트 분석** - Warning 이벤트 필터링 및 분석 |
| `list-namespaces` | **네임스페이스 목록** - 모든 네임스페이스 빠른 조회 |
| `list-pods` | **파드 목록** - 문제가 있는 파드 상태 표시 |

## 설치

### npm으로 설치 (권장)

```bash
npm install -g k8s-doctor-mcp
```

### 소스에서 빌드

```bash
git clone https://github.com/ongjin/k8s-doctor-mcp.git
cd k8s-doctor-mcp
npm install && npm run build
```

## Claude Code에 등록

```bash
# npm 전역 설치 후
claude mcp add k8s-doctor -- k8s-doctor-mcp

# 또는 소스에서 빌드한 경우
claude mcp add k8s-doctor -- node /path/to/k8s-doctor-mcp/dist/index.js
```

## 빠른 설정 (권장)

매번 도구 사용 승인을 누르는 것이 번거롭다면, 아래 방법으로 자동 허용을 설정하세요.

### 🖥️ For Claude Desktop App Users
1. Claude 앱을 재시작합니다.
2. `k8s-doctor`를 사용하는 첫 번째 질문을 던집니다.
3. 알림창이 뜨면 **"Always allow requests from this server"** 체크박스를 클릭하고 **Allow**를 누르세요.
   (이후에는 묻지 않고 실행됩니다.)

### ⌨️ For Claude Code (CLI) Users
터미널 환경(`claude` 명령어)을 사용 중이라면 권한 관리 명령어를 사용하세요.

1. 터미널에서 `claude`를 실행합니다.
2. 프롬프트 입력창에 `/permissions`를 입력하고 엔터를 칩니다.
3. **Global Permissions** 또는 **Project Permissions** 메뉴가 나오면 `Allowed Tools`를 선택합니다.
4. `mcp__k8s-doctor__*` 를 입력하여 모든 도구를 허용하거나, 필요한 도구만 개별 등록합니다.

> 💡 **Tip**: 대부분의 경우 `diagnose-pod`, `debug-crashloop`, `analyze-logs` 세 가지만 허용하면 충분합니다. 이 세 도구로 90%의 디버깅 시나리오를 커버합니다.

**권장 설정:**
```bash
# 균형잡힌 접근 - 주요 진단 도구 허용
claude config add allowedTools \
  "mcp__k8s-doctor__diagnose-pod" \
  "mcp__k8s-doctor__debug-crashloop" \
  "mcp__k8s-doctor__analyze-logs" \
  "mcp__k8s-doctor__full-diagnosis"
```

## 필수 조건

- **kubectl** 설정 및 작동 확인 (`kubectl cluster-info` 성공해야 함)
- **kubeconfig** 파일이 기본 위치(`~/.kube/config`)에 있거나 `KUBECONFIG` 환경변수 설정
- **Node.js** 18 이상
- Kubernetes 클러스터 접근 권한 (로컬 minikube/kind 또는 원격)

## 사용 예제

### 예제 1: CrashLooping 파드 진단

```
사용자: "production 네임스페이스의 'api-server' 파드가 CrashLoop 상태인데 왜 그런거야?"

Claude (k8s-doctor 사용):
🔍 CrashLoopBackOff 진단

Exit Code: 137 (OOM Killed)
근본 원인: 메모리 부족으로 컨테이너가 강제 종료되었습니다

해결 방법:
메모리 limit을 늘리세요:
```yaml
resources:
  limits:
    memory: "512Mi"  # 현재 값보다 높게 설정
```

관련 로그:
- 라인 1234: Error: JavaScript heap out of memory
- 라인 1256: FATAL ERROR: Reached heap limit
```

### 예제 2: 애플리케이션 로그 분석

```
사용자: "'backend-worker' 파드 로그를 분석해서 뭐가 실패하는지 알려줘"

Claude (analyze-logs 사용):
📝 로그 분석 결과

감지된 에러 패턴:

🔴 Database Connection Error (15회 발생)
가능한 원인:
- DB 서비스가 준비되지 않음
- 잘못된 연결 문자열
- 인증 실패

해결 방법:
- DB Pod 상태 확인
- 환경변수 확인 (ConfigMap/Secret)
- 서비스 엔드포인트 확인: kubectl get endpoints

🟡 Timeout (8회 발생)
가능한 원인: 응답 시간이 너무 길거나 네트워크 지연
해결책: 타임아웃 값을 늘리거나 서비스 성능 최적화
```

### 예제 3: 클러스터 전체 건강 체크

```
사용자: "클러스터 전체 건강 상태 확인해줘"

Claude (full-diagnosis 사용):
🏥 클러스터 건강 진단

전체 점수: 72/100 💛

노드: 3/3 Ready ✅
파드: 45/52 Running
- CrashLoop: 2개 🔥
- Pending: 5개 ⏳

Critical 이슈:
🔴 파드 "payment-service" CrashLooping (exit 1)
🔴 파드 "worker-3" OOM Killed

권장사항:
- 2개 CrashLoop 파드를 즉시 수정하세요
- Pending 파드들의 리소스 부족 여부 확인
```

## 작동 원리

1. **클러스터 연결** - kubeconfig를 통해 연결 (kubectl과 동일)
2. **종합 데이터 수집** - 파드 상태, 이벤트, 로그, 리소스 사용량
3. **패턴 매칭 적용** - 실전 경험을 바탕으로 한 일반적인 에러 패턴 인식
4. **근본 원인 분석** - 단순히 상태만 보여주는게 아니라 WHY(왜) 실패했는지 설명
5. **해결책 제공** - 정확한 명령어와 YAML로 수정 방법 제시

## 감지하는 에러 패턴

K8s Doctor가 인식하는 일반적인 패턴들:

- 🔴 **Connection Refused** - 서비스 준비 안됨, 잘못된 포트, 네트워크 정책
- 🔴 **Database Connection Errors** - DB 인증, 잘못된 연결 문자열
- 🔴 **Out of Memory** - OOM kill, 메모리 누수, 부족한 limit
- 🟠 **File Not Found** - ConfigMap 미마운트, 잘못된 경로
- 🟠 **Permission Denied** - SecurityContext 문제, fsGroup 이슈
- 🟠 **DNS Resolution Failed** - CoreDNS 문제, 잘못된 서비스명
- 🟡 **Port Already in Use** - 같은 포트의 여러 프로세스
- 🟡 **Timeout** - 느린 응답, 네트워크 지연
- 🟡 **SSL/TLS Errors** - 만료된 인증서, CA bundle 누락

## 아키텍처

```
k8s-doctor-mcp/
├── src/
│   ├── index.ts                 # MCP 서버 (모든 도구)
│   ├── types.ts                 # TypeScript 타입 정의
│   ├── diagnostics/
│   │   ├── pod-diagnostics.ts   # 파드 건강 분석
│   │   └── cluster-health.ts    # 클러스터 전체 진단
│   ├── analyzers/
│   │   └── log-analyzer.ts      # 스마트 로그 패턴 매칭
│   └── utils/
│       ├── k8s-client.ts        # Kubernetes API 클라이언트
│       └── formatters.ts        # 출력 포맷팅 유틸
└── package.json
```

## 보안 고려사항

- K8s Doctor는 **읽기 전용** Kubernetes API만 사용 (list, get, describe)
- `kubectl get/describe/logs`와 동일한 권한 필요
- 클러스터 상태를 절대 변경하지 않음
- kubeconfig 자격증명은 로컬에만 유지
- 외부 서버로 데이터 전송 안함

## 문제 해결

### "kubeconfig를 찾을 수 없습니다"
```bash
# kubectl 작동 확인
kubectl cluster-info

# kubeconfig 위치 확인
echo $KUBECONFIG

# 명시적 경로로 테스트
export KUBECONFIG=~/.kube/config
```

### "Permission denied"
```bash
# 클러스터 권한 확인
kubectl auth can-i get pods --all-namespaces

# 최소한 다음에 대한 읽기 권한 필요:
# - pods, events, namespaces, nodes
```

### "Connection refused to cluster"
```bash
# 클러스터 연결 확인
kubectl get nodes

# 로컬 클러스터의 경우 (minikube/kind)
minikube status
kind get clusters
```

## 개발

```bash
# 클론 및 설치
git clone https://github.com/ongjin/k8s-doctor-mcp.git
cd k8s-doctor-mcp
npm install

# 개발 모드
npm run dev

# 빌드
npm run build

# Claude Code로 테스트
npm run build
claude mcp add k8s-doctor-dev -- node $(pwd)/dist/index.js
```

## 기여

기여를 환영합니다! 특히:

- 🆕 새로운 에러 패턴 감지
- 🌍 국제화 (더 많은 언어)
- 📊 메트릭 통합 (Prometheus 등)
- 🧪 테스트 커버리지
- 📖 문서 개선

## 로드맵

- [ ] Metrics Server 통합 (실시간 CPU/Memory 사용량)
- [ ] 네트워크 정책 진단
- [ ] 스토리지/PVC 문제 해결
- [ ] Helm 차트 분석
- [ ] 멀티 클러스터 지원
- [ ] 대화형 디버깅 모드
- [ ] 리포트 내보내기 (PDF, HTML)

## 라이선스

MIT © [zerry](https://github.com/ongjin)

## 감사의 말

다음 기술로 만들어졌습니다:
- [@modelcontextprotocol/sdk](https://github.com/anthropics/mcp) - Model Context Protocol
- [@kubernetes/client-node](https://github.com/kubernetes-client/javascript) - Kubernetes JavaScript Client
- [Claude Code](https://claude.com/claude-code) - AI 기반 개발 도구

## 스타 히스토리

이 도구가 디버깅 시간을 절약해줬다면 ⭐ 스타 부탁드립니다!

## 작성자

**zerry**

- GitHub: [@zerry](https://github.com/ongjin)
- kubectl 지옥에 지친 DevOps 커뮤니티를 위해 만들었습니다 😅

---

**로그에 빠진 Kubernetes 사용자들을 위해 ❤️로 만들었습니다**
