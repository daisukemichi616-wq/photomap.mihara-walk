/**
 * Cloudflare Pages Functions - _middleware.js
 */

const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vR0jkQnLXsIL33pmO60BCd0hIr_v5xh34cJ_IWAHkF0pTaj855pzicmNoVx6W8CPK3MEhlp-irodPSE/pub?gid=1232979489&single=true&output=csv";

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const spotTitle = url.searchParams.get('spot'); 
  const lang = url.searchParams.get('lang') || 'jp';

  let response = await context.next();

  // HTMLリクエスト以外はスキップ
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) {
    return response;
  }

  // URLに ?spot= の指定がない場合はスキップ
  if (!spotTitle) {
    return response;
  }

  let spotData = null;
  
  try {
    const csvRes = await fetch(CSV_URL);
    if (!csvRes.ok) throw new Error(`CSV Fetch Failed: ${csvRes.status}`);
    
    const csvText = await csvRes.text();
    spotData = findSpotInCsv(csvText, spotTitle);
  } catch (e) {
    console.error('Functions Error:', e);
  }

  // データが見つからなかった場合は書き換えずに返す
  if (!spotData) {
    return response;
  }

  // 成功時：データを元にOGPを書き換える
  const ogTitle = lang === 'en' ? (spotData.title_en || spotData.title) : spotData.title;
  let ogDesc = lang === 'en' ? (spotData.desc_en || spotData.desc || `${ogTitle} scenery.`) : (spotData.desc || `${ogTitle}の風景です。`);
  ogDesc = ogDesc.replace(/\r?\n/g, '').substring(0, 100);
  const siteTitle = lang === 'en' ? `${ogTitle} | Mihara Walk PHOTO MAP` : `${ogTitle} | 三原市まち歩き PHOTO MAP`;
  
  let imageUrl = formatDriveUrl(spotData.image);
  if (!imageUrl) {
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
    // デバッグ用（成功の証）
    .on('head', { element(e) { e.append(`<meta name="cf-functions-debug" content="success_rewritten">`, { html: true }); } })
    .transform(response);
}

// --- 補助関数：改行対応のCSVデータ検索 ---
function findSpotInCsv(csvText, targetTitle) {
  const rows = parseCSV(csvText);
  if (rows.length < 2) return null;

  // 余計な変換をせず、見出し（ヘッダー）をそのまま小文字にして取得
  const headers = rows[0].map(h => h.replace(/^[\s\u3000]+|[\s\u3000]+$/g, '').toLowerCase());
  
  // 「title」列を正確に探す
  const titleIndex = headers.findIndex(h => h === 'title' || h === 'タイトル');
  if (titleIndex === -1) return null;

  // 照合用：スペースをすべて除去して比べる
  const cleanTargetTitle = targetTitle.replace(/[\s\u3000]+/g, '');

  for (let i = 1; i < rows.length; i++) {
    const values = rows[i];
    if (!values || values.length === 0 || !values[0]) continue;

    const rowTitle = values[titleIndex] ? values[titleIndex].trim() : '';
    const cleanRowTitle = rowTitle.replace(/[\s\u3000]+/g, '');
    
    if (cleanRowTitle === cleanTargetTitle) {
      const result = {};
      // 上書きバグを防ぐため、ヘッダーの名前をそのままキーにする
      headers.forEach((h, index) => {
        result[h] = values[index] ? values[index].trim() : '';
      });
      return result;
    }
  }
  return null;
}

// --- 補助関数：改行を含むCSVを正しく分解するエンジン ---
function parseCSV(csvText) {
  const result = [];
  let row = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    if (char === '"') {
      if (inQuotes && csvText[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (char === ',' && !inQuotes) {
      row.push(current); current = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && csvText[i + 1] === '\n') { i++; }
      row.push(current); result.push(row); row = []; current = '';
    } else { current += char; }
  }
  if (current !== '' || row.length > 0) { row.push(current); result.push(row); }
  return result;
}

// --- X（Twitter）の画像ブロック回避用URLジェネレーター ---
function formatDriveUrl(url) {
    if (!url) return '';
    const idMatch = url.match(/[-\w]{25,}/);
    // Google DriveのURLの場合、Twitterbotが読み込める特殊なURLに変換
    if (idMatch && (url.includes('drive.google.com') || url.includes('google'))) {
        return `https://lh3.googleusercontent.com/d/${idMatch[0]}=w1200`;
    }
    return url;
}