export async function onRequestPost(context) {
  // Cloudflareの環境変数からAPIキーを安全に読み込む
  const apiKey = context.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "APIキーが設定されていません。" }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }

  try {
    // サイトの画面（index.html）から送られてきたチャット履歴を受け取る
    const requestData = await context.request.json();
    const model = "gemini-2.5-flash-preview-09-2025";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    // GoogleのGeminiサーバーへリクエストを転送する
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestData)
    });

    if (!response.ok) {
      const errorText = await response.text();
      return new Response(JSON.stringify({ error: `Gemini API error`, details: errorText }), {
        status: response.status, headers: { "Content-Type": "application/json" }
      });
    }

    const data = await response.json();
    // 画面側にAIの返答を返す
    return new Response(JSON.stringify(data), {
      status: 200, headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}