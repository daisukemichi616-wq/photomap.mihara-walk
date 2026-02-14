/**
 * Cloudflare Pages Functions for SEO & OGP Optimization
 * * リクエストが来るたびに実行されます。
 * URLに `?spot=タイトル` が含まれている場合、CSVをフェッチして
 * そのスポットの情報を元にHTMLのメタタグ（OGP含む）を書き換えます。
 */

// あなたのGoogleスプレッドシートCSVのURL
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vR0jkQnLXsIL33pmO60BCd0hIr_v5xh34cJ_IWAHkF0pTaj855pzicmNoVx6W8CPK3MEhlp-irodPSE/pub?gid=1232979489&single=true&output=csv";

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const spotTitle = url.searchParams.get('spot'); // URLパラメータを取得

  // 1. オリジナルのHTMLレスポンスを取得
  let response = await context.next();

  // パラメータがない、またはHTML以外のリクエストはそのまま返す
  if (!spotTitle || !response.headers.get('content-type')?.includes('text/html')) {
    return response;
  }

  // 2. CSVを取得して解析
  let spotData = null;
  try {
    const csvRes = await fetch(CSV_URL);
    if (!csvRes.ok) throw new Error('CSV Fetch Failed');
    
    const csvText = await csvRes.text();
    spotData = findSpotInCsv(csvText, spotTitle);
  } catch (e) {
    console.error('Functions Error:', e);
    // エラー時は書き換えずにオリジナルのHTMLを返す
    return response;
  }

  // データが見つからなければそのまま返す
  if (!spotData) {
    return response;
  }

  // 3. HTMLRewriterでメタタグを書き換える
  // ここがSEO/OGP対策の肝です
  return new HTMLRewriter()
    .on('title', {
      element(element) {
        element.setInnerContent(`${spotData.title} | 三原市まち歩き PHOTO MAP`);
      }
    })
    .on('meta[name="description"]', {
      element(element) {
        let desc = spotData.desc || `${spotData.title}の風景です。`;
        desc = desc.replace(/\r?\n/g, '').substring(0, 100);
        element.setAttribute('content', desc);
      }
    })
    .on('link[rel="canonical"]', {
      element(element) {
        // カノニカルURLを現在のパラメータ付きURLに書き換え
        element.setAttribute('href', url.href);
      }
    })
    // OGP Tags
    .on('meta[property="og:title"]', {
      element(element) {
        element.setAttribute('content', `${spotData.title} | 三原市まち歩き`);
      }
    })
    .on('meta[property="og:description"]', {
      element(element) {
        let desc = spotData.desc || `${spotData.title}の風景です。`;
        desc = desc.replace(/\r?\n/g, '').substring(0, 100);
        element.setAttribute('content', desc);
      }
    })
    .on('meta[property="og:image"]', {
      element(element) {
        if (spotData.image) {
          const imgUrl = formatDriveUrl(spotData.image);
          element.setAttribute('content', imgUrl);
        }
      }
    })
    // Twitter Cards
    .on('meta[name="twitter:title"]', {
        element(element) {
          element.setAttribute('content', `${spotData.title} | 三原市まち歩き`);
        }
    })
    .on('meta[name="twitter:description"]', {
        element(element) {
          let desc = spotData.desc || `${spotData.title}の風景です。`;
          desc = desc.replace(/\r?\n/g, '').substring(0, 100);
          element.setAttribute('content', desc);
        }
    })
    .on('meta[name="twitter:image"]', {
        element(element) {
          if (spotData.image) {
            const imgUrl = formatDriveUrl(spotData.image);
            element.setAttribute('content', imgUrl);
          }
        }
    })
    .transform(response);
}


/**
 * CSVテキストから特定のタイトルの行を探すヘルパー関数
 * (サーバーレス環境ではライブラリを使わず正規表現で処理するのが軽量)
 */
function findSpotInCsv(csvText, targetTitle) {
  const lines = csvText.split(/\r?\n/);
  if (lines.length < 2) return null;

  // 1行目のヘッダーを取得して小文字に正規化
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  
  // タイトル列のインデックスを探す
  // 'title', 'タイトル' などのカラム名に対応
  const titleIndex = headers.findIndex(h => h.includes('title') || h.includes('タイトル'));
  if (titleIndex === -1) return null;

  // 2行目以降を走査
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    // CSVのパース（ダブルクォート内のカンマを無視する分割ロジック）
    const values = parseCSVLine(line);
    
    // タイトルが一致するかチェック
    if (values[titleIndex] && values[titleIndex].trim() === targetTitle.trim()) {
      // 一致したらオブジェクトを生成して返す
      const result = {};
      headers.forEach((h, index) => {
        let key = h;
        // キー名を使いやすいように正規化
        if (key.includes('image') || key.includes('画像')) key = 'image';
        if (key.includes('desc') || key.includes('紹介')) key = 'desc';
        if (key.includes('title') || key.includes('タイトル')) key = 'title';
        
        // 値のダブルクォート除去
        let val = values[index] ? values[index].trim() : '';
        if (val.startsWith('"') && val.endsWith('"')) {
            val = val.slice(1, -1).replace(/""/g, '"');
        }
        result[key] = val;
      });
      return result;
    }
  }
  return null;
}

/**
 * CSVの1行を正しく分割する関数
 * (カンマ区切りだが、ダブルクォート内のカンマは無視する)
 */
function parseCSVLine(text) {
    // 引用符内のカンマを無視して分割する正規表現
    // 参考: CSV split regex pattern
    const matches = text.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
    return matches || [];
}

/**
 * Google Drive URLをサムネイル用URLに変換
 */
function formatDriveUrl(url) {
    if (!url) return '';
    // ID抽出
    const idMatch = url.match(/[-\w]{25,}/);
    if (idMatch) {
        // w1200はOGP画像として推奨される幅
        return `https://drive.google.com/thumbnail?id=${idMatch[0]}&sz=w1200`;
    }
    return url;
}