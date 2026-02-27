export async function onRequestPost(context) {
  const apiKey = context.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "APIキーが設定されていません。" }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }

  try {
    let requestData;
    try {
      requestData = await context.request.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: "リクエストデータが不正です。" }), { 
        status: 400, headers: { "Content-Type": "application/json" } 
      });
    }
    
    // 一般公開されている最新の安定モデル
    const model = "gemini-1.5-flash"; 
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestData)
    });

    // 応答をまずはテキストとして受け取る（空っぽエラーを防ぐため）
    const responseText = await response.text();

    if (!response.ok) {
      return new Response(JSON.stringify({ error: "Gemini API Error", details: responseText }), {
        status: response.status, headers: { "Content-Type": "application/json" }
      });
    }

    return new Response(responseText, {
      status: 200, headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: "Server Error", details: error.message }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}