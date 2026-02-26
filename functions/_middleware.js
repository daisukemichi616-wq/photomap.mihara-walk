/**
 * Cloudflare Pages Functions - _middleware.js
 * ※ ファイル名を index.js ではなく _middleware.js にして配置してください。
 */

const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vR0jkQnLXsIL33pmO60BCd0hIr_v5xh34cJ_IWAHkF0pTaj855pzicmNoVx6W8CPK3MEhlp-irodPSE/pub?gid=1232979489&single=true&output=csv";

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const spotTitle = url.searchParams.get('spot'); 
  const lang = url.searchParams.get('lang') || 'jp';

  let response = await context.next();

  // HTMLリクエスト以外はスキップして通常の動作をする
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) {
    return response;
  }

  // URLに ?spot= の指定がない場合はスキップ
  if (!spotTitle) {
    return response;
  }

  let spotData = null;
  let debugMsg = 'ok';
  
  try {
    const csvRes = await fetch(CSV_URL);
    if (!csvRes.ok) throw new Error(`CSV Fetch Failed: ${csvRes.status}`);
    
    const csvText = await csvRes.text();
    spotData = findSpotInCsv(csvText, spotTitle);
    
    if (!spotData) {
      debugMsg = 'spot_not_found_in_csv'; // CSVから見つからなかった場合
    }
  } catch (e) {
    console.error('Functions Error:', e);
    debugMsg = `error_${e.message}`;
  }

  // 万が一データが見つからなかった場合でも、原因究明用のタグを仕込んで返す
  if (!spotData) {
    return new HTMLRewriter()
      .on('head', {
        element(e) {
          e.append(`<meta name="cf-functions-debug" content="${debugMsg}">`, { html: true });
        }
      }).transform(response);
  }

  // 成功時：取得したデータを元にOGPを書き換える
  const ogTitle = lang === 'en' ? (spotData.title_en || spotData.title) : spotData.title;
  let ogDesc = lang === 'en' ? (spotData.desc_en || spotData.desc || `${ogTitle} scenery.`) : (spotData.desc || `${ogTitle}の風景です。`);
  ogDesc = ogDesc.replace(/\r?\n/g, '').substring(0, 100);
  const siteTitle = lang === 'en' ? `${ogTitle} | Mihara Walk PHOTO MAP` : `${ogTitle} | 三原市まち歩き PHOTO MAP`;
  
  let imageUrl = formatDriveUrl(spotData.image);
  if (!imageUrl) {
      // 画像データが空の場合の予備画像（トップ画像）
      imageUrl = "https://i.postimg.cc/Dy2sThhC/IMG-9586.jpg";
  }

  return new HTMLRewriter()
    .on('title', { element(e) { e.setInnerContent(siteTitle); } })
    .on('meta[name="description"]', { element(e) { e.setAttribute('content', ogDesc); } })
    .on('meta[property="og:title"]', { element(e) { e.setAttribute('content', siteTitle); } })
    .on('meta[property="og:description"]', { element(e) { e.setAttribute('content', ogDesc); } })
    .on('meta[property="og:image"]', { element(e) { e.setAttribute('content', imageUrl); } })
    .on('meta[name="twitter:title"]', { element(e) { e.setAttribute('content', siteTitle); } })
    .on('meta[name="twitter:description"]', { element(e) { e.setAttribute('content', ogDesc); } })
    .on('meta[name="twitter:image"]', { element(e) { e.setAttribute('content', imageUrl); } })
    // うまく動いた証拠を裏側に記録する
    .on('head', { element(e) { e.append(`<meta name="cf-functions-debug" content="success_rewritten">`, { html: true }); } })
    .transform(response);
}

// --- 補助関数 ---

function findSpotInCsv(csvText, targetTitle) {
  const lines = csvText.split(/\r?\n/);
  if (lines.length < 2) return null;

  const headers = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase());
  const titleIndex = headers.findIndex(h => h.includes('title') || h.includes('タイトル'));
  if (titleIndex === -1) return null;

  // 比較のために全角・半角スペースを完全に除去して照合する（ズレ防止）
  const cleanTargetTitle = targetTitle.replace(/[\s\u3000]+/g, '');

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const values = parseCSVLine(line);
    const rowTitle = values[titleIndex] ? values[titleIndex].trim() : '';
    const cleanRowTitle = rowTitle.replace(/[\s\u3000]+/g, '');
    
    // スペースを除いた状態で一致するかチェック
    if (cleanRowTitle === cleanTargetTitle) {
      const result = {};
      headers.forEach((h, index) => {
        let key = h;
        if (key.includes('image') || key.includes('画像')) key = 'image';
        else if (key.includes('desc_en')) key = 'desc_en';
        else if (key.includes('desc') || key.includes('紹介')) key = 'desc';
        else if (key.includes('title_en')) key = 'title_en';
        else if (key.includes('title') || key.includes('タイトル')) key = 'title';
        else if (key.includes('rpg_title_en')) key = 'rpg_title_en';
        else if (key.includes('rpg_desc_en')) key = 'rpg_desc_en';
        
        result[key] = values[index] ? values[index].trim() : '';
      });
      return result;
    }
  }
  return null;
}

function parseCSVLine(text) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char === '"') {
            if (inQuotes && text[i+1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current);
    return result;
}

function formatDriveUrl(url) {
    if (!url) return '';
    const idMatch = url.match(/[-\w]{25,}/);
    // Google DriveのURLの場合のみID抽出してサムネイル化
    if (idMatch && url.includes('drive.google.com')) {
        return `https://drive.google.com/thumbnail?id=${idMatch[0]}&sz=w1200`;
    }
    // それ以外のURL（Postimagesなど）はそのまま返す
    return url;
}