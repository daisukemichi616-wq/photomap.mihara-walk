/**
 * Cloudflare Pages Functions - _middleware.js
 */

// 1. ギャラリー用CSV
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vR0jkQnLXsIL33pmO60BCd0hIr_v5xh34cJ_IWAHkF0pTaj855pzicmNoVx6W8CPK3MEhlp-irodPSE/pub?gid=1232979489&single=true&output=csv";

// 2. 親子でお散歩用 新しいCSV（フォーム回答用シート）
const LOCAL_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTia8V00j15toSprtd2bQV4JWrZprRz7m_cf73IZla6KOu62wtunUjCrb9wKkyNthWep8TfDeT8HW2B/pub?gid=1467172273&single=true&output=csv";

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const spotTitle = url.searchParams.get('spot'); 
  const lang = url.searchParams.get('lang') || 'jp';

  let response = await context.next();

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) {
    return response;
  }

  if (!spotTitle) {
    return response;
  }

  let spotData = null;
  
  try {
    // まずはギャラリー用のCSVから探す
    let csvText1 = "";
    try {
      const csvRes1 = await fetch(CSV_URL);
      if (csvRes1.ok) csvText1 = await csvRes1.text();
    } catch(e) {}
    
    spotData = findSpotInCsv(csvText1, spotTitle);

    // 見つからなければ、新しい「親子さんぽ用」のCSVから探す
    if (!spotData && LOCAL_CSV_URL.startsWith("http")) {
      try {
        const csvRes2 = await fetch(LOCAL_CSV_URL);
        if (csvRes2.ok) {
           const csvText2 = await csvRes2.text();
           spotData = findSpotInCsv(csvText2, spotTitle);
        }
      } catch(e) {}
    }

  } catch (e) {
    console.error('Functions Error:', e);
  }

  // もし該当データが見つかれば、HTMLのMetaタグ（OGP）を書き換える
  if (spotData && spotData.title) {
    let html = await response.text();
    
    // 言語判定でタイトル/説明文を切り替え
    const isEn = (lang === 'en');
    const displayTitle = (isEn && spotData.title_en) ? spotData.title_en : spotData.title;
    const displayDesc = (isEn && spotData.desc_en) ? spotData.desc_en : (spotData.desc || 'まだ知らない三原の景色を、みんなで描くフォトマップ。');

    // Googleドライブの画像URLをプレビュー用に変換
    let imageUrl = spotData.image || "https://i.postimg.cc/Dy2sThhC/IMG-9586.jpg";
    if (imageUrl.includes('drive.google.com')) {
      const idMatch = imageUrl.match(/[-\w]{25,}/);
      if (idMatch) {
        imageUrl = `https://drive.google.com/thumbnail?id=${idMatch[0]}&sz=w1000`;
      }
    }

    const newTitle = `${displayTitle} | MIHARA REDISCOVER`;
    const cleanDesc = displayDesc.replace(/\n/g, '').substring(0, 100);

    // Metaタグの置換
    html = html.replace(/<title>.*?<\/title>/, `<title>${newTitle}</title>`);
    html = html.replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${cleanDesc}">`);
    
    html = html.replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${newTitle}">`);
    html = html.replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${cleanDesc}">`);
    html = html.replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${imageUrl}">`);
    
    html = html.replace(/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${newTitle}">`);
    html = html.replace(/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${cleanDesc}">`);
    html = html.replace(/<meta name="twitter:image" content="[^"]*">/, `<meta name="twitter:image" content="${imageUrl}">`);

    return new Response(html, {
      headers: response.headers,
    });
  }

  return response;
}

// --- 補助関数：CSVテキストからタイトルが一致する行を探してオブジェクトにする ---
function findSpotInCsv(csvText, targetTitle) {
  if (!csvText) return null;
  
  const rows = parseCSV(csvText);
  if (rows.length < 2) return null;

  const header = rows[0].map(h => h.replace(/^[\s\u3000]+|[\s\u3000]+$/g, '').toLowerCase());
  
  const titleIndex = header.indexOf('title');
  const titleEnIndex = header.indexOf('title_en');
  const descIndex = header.indexOf('desc');
  const descEnIndex = header.indexOf('desc_en');
  const imageIndex = header.indexOf('image');

  if (titleIndex === -1) return null;

  for (let i = 1; i < rows.length; i++) {
    const values = rows[i];
    // 行のデータがヘッダーのインデックスより短い場合はスキップしてエラーを防ぐ
    if (!values || values.length <= titleIndex) continue;
    
    if (values[titleIndex] && values[titleIndex].trim() === targetTitle) {
      return {
        title: values[titleIndex].trim(),
        desc: (descIndex !== -1 && values[descIndex]) ? values[descIndex].trim() : '',
        image: (imageIndex !== -1 && values[imageIndex]) ? values[imageIndex].trim() : '',
        title_en: (titleEnIndex !== -1 && values[titleEnIndex]) ? values[titleEnIndex].trim() : '',
        desc_en: (descEnIndex !== -1 && values[descEnIndex]) ? values[descEnIndex].trim() : ''
      };
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
  if (current !== '' || row.length > 0) {
    row.push(current); result.push(row);
  }
  return result;
}