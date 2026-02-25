/**
 * Cloudflare Pages Functions for SEO & OGP Optimization
 * * リクエストが来るたびに実行されます。
 * URLに `?spot=タイトル&lang=en` が含まれている場合、CSVをフェッチして
 * そのスポットの情報を元にHTMLのメタタグ（OGP含む）を言語に応じて書き換えます。
 */

const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vR0jkQnLXsIL33pmO60BCd0hIr_v5xh34cJ_IWAHkF0pTaj855pzicmNoVx6W8CPK3MEhlp-irodPSE/pub?gid=1232979489&single=true&output=csv";

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const spotTitle = url.searchParams.get('spot'); 
  const lang = url.searchParams.get('lang') || 'jp'; // 言語パラメータ取得（デフォルトjp）

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
    return response;
  }

  if (!spotData) {
    return response;
  }

  // 言語に応じたテキストの振り分け
  const ogTitle = lang === 'en' ? (spotData.title_en || spotData.title) : spotData.title;
  let ogDesc = lang === 'en' ? (spotData.desc_en || spotData.desc || `${ogTitle} scenery.`) : (spotData.desc || `${ogTitle}の風景です。`);
  ogDesc = ogDesc.replace(/\r?\n/g, '').substring(0, 100); // 100文字でカット
  const siteTitle = lang === 'en' ? `${ogTitle} | Mihara Walk PHOTO MAP` : `${ogTitle} | 三原市まち歩き PHOTO MAP`;

  // 3. HTMLRewriterでメタタグを書き換える
  return new HTMLRewriter()
    .on('title', {
      element(element) {
        element.setInnerContent(siteTitle);
      }
    })
    .on('meta[name="description"]', {
      element(element) {
        element.setAttribute('content', ogDesc);
      }
    })
    .on('link[rel="canonical"]', {
      element(element) {
        element.setAttribute('href', url.href);
      }
    })
    // OGP Tags
    .on('meta[property="og:title"]', {
      element(element) {
        element.setAttribute('content', siteTitle);
      }
    })
    .on('meta[property="og:description"]', {
      element(element) {
        element.setAttribute('content', ogDesc);
      }
    })
    .on('meta[property="og:image"]', {
      element(element) {
        if (spotData.image) {
          element.setAttribute('content', formatDriveUrl(spotData.image));
        }
      }
    })
    // Twitter Cards
    .on('meta[name="twitter:title"]', {
        element(element) {
          element.setAttribute('content', siteTitle);
        }
    })
    .on('meta[name="twitter:description"]', {
        element(element) {
          element.setAttribute('content', ogDesc);
        }
    })
    .on('meta[name="twitter:image"]', {
        element(element) {
          if (spotData.image) {
            element.setAttribute('content', formatDriveUrl(spotData.image));
          }
        }
    })
    .transform(response);
}

/**
 * CSVテキストから特定のタイトルの行を探すヘルパー関数
 */
function findSpotInCsv(csvText, targetTitle) {
  const lines = csvText.split(/\r?\n/);
  if (lines.length < 2) return null;

  // ヘッダー行を取得
  const headers = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase());
  const titleIndex = headers.findIndex(h => h.includes('title') || h.includes('タイトル'));
  if (titleIndex === -1) return null;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue; // 空行はスキップ

    const values = parseCSVLine(line);
    
    // タイトル列の値を取得し、一致するか確認
    const rowTitle = values[titleIndex] ? values[titleIndex].trim() : '';
    
    if (rowTitle === targetTitle.trim()) {
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

/**
 * 空の列やカンマを含むテキストを正確に処理するCSVパーサー
 */
function parseCSVLine(text) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char === '"') {
            // ダブルクォーテーションのエスケープ（""）を処理
            if (inQuotes && text[i+1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            // クォーテーション外のカンマで区切る
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
    if (idMatch) return `https://drive.google.com/thumbnail?id=${idMatch[0]}&sz=w1200`;
    return url;
}