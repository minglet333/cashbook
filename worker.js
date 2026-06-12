// Cloudflare Worker — Anthropic API 프록시
// 가계부 'AI 분석' 탭이 이 Worker를 호출합니다.
// API 키는 Worker 시크릿(ANTHROPIC_API_KEY)에만 저장되며, 페이지/저장소 어디에도 노출되지 않습니다.
//
// ── 배포 방법 (Cloudflare 대시보드) ──
// 1. dash.cloudflare.com → Workers & Pages → Create → Worker 생성
// 2. 편집기 내용을 "전체 선택(Ctrl+A) → 삭제" 후, 이 파일 내용을 통째로 붙여넣고 Deploy
//    (기존 템플릿 위에 덧붙이면 문법 오류가 납니다 — 반드시 비우고 붙여넣기)
// 3. Worker → Settings → Variables and Secrets →
//    "ANTHROPIC_API_KEY" 이름으로 Secret 추가 (값: sk-ant-... 본인 키)
// 4. 배포된 Worker URL(예: https://cashbook-ai.<계정>.workers.dev)을
//    index.html의 AI_PROXY_URL 에 넣기
// 5. 아래 ALLOWED_ORIGINS 에 실제 페이지 주소를 맞게 수정
//
// 배포 후 브라우저로 Worker URL을 그냥 열면 "Cashbook AI proxy is running." 가 보이면 정상입니다.

// 이 Worker를 호출할 수 있는 출처(다른 사이트의 무단 호출 차단)
const ALLOWED_ORIGINS = [
  "https://minglet333.github.io",   // GitHub Pages (프로젝트 페이지)
  "http://localhost:8080",          // 로컬 테스트
  "http://127.0.0.1:8080",
  "null",                           // 로컬 file:// 로 열었을 때
];

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Vary": "Origin",
  };
}

function jsonError(message, status, origin) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(origin) },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    // CORS 프리플라이트
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // 브라우저로 URL을 직접 열었을 때(GET) 상태 확인용 — 에러 아님
    if (request.method === "GET") {
      return new Response("Cashbook AI proxy is running.", {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8", ...corsHeaders(origin) },
      });
    }

    if (request.method !== "POST") {
      return jsonError("POST 요청만 허용됩니다.", 405, origin);
    }

    // 허용되지 않은 출처 차단
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      return jsonError("허용되지 않은 출처입니다.", 403, origin);
    }

    if (!env.ANTHROPIC_API_KEY) {
      return jsonError("서버에 ANTHROPIC_API_KEY 시크릿이 설정되지 않았습니다.", 500, origin);
    }

    // 본문을 text로 먼저 받아 빈 본문에도 안전하게 처리 (request.json() 의 SyntaxError 방지)
    const rawBody = await request.text();
    if (!rawBody) {
      return jsonError("요청 본문이 비어 있습니다.", 400, origin);
    }
    let body;
    try {
      body = JSON.parse(rawBody);
    } catch (e) {
      return jsonError("요청 본문이 올바른 JSON이 아닙니다.", 400, origin);
    }

    // Anthropic API로 그대로 전달 (키는 서버에서 주입)
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    // 스트리밍 응답을 그대로 통과시키며 CORS 헤더 부착
    const headers = new Headers(upstream.headers);
    for (const [k, v] of Object.entries(corsHeaders(origin))) headers.set(k, v);
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
