// Daangn Item Search Chrome Extension - background.js

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'checkDaangn') {
    await checkNewDaangnItems();
  }
});

// 알림 클릭 시 해당 매물 페이지 열기
chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId.startsWith('daangn_item_')) {
    const itemUrl = notificationId.replace('daangn_item_', '');
    chrome.tabs.create({ url: decodeURIComponent(itemUrl) });
  }
});

async function checkNewDaangnItems() {
  const data = await chrome.storage.local.get([
    'keyword', 'minPrice', 'maxPrice', 'region', 'seenIds', 'enableAlarm'
  ]);

  if (!data.enableAlarm || !data.keyword) return;

  const seenIds = new Set(data.seenIds || []);
  const keyword = data.keyword;
  const regionVal = data.region || '';
  
  let regionParam = '';
  if (regionVal) {
    if (regionVal.includes('-')) {
      regionParam = regionVal;
    } else {
      regionParam = await resolveRegionCode(regionVal);
    }
  }

  // 가격 파싱
  const minP = parseUserPrice(data.minPrice);
  const maxP = parseUserPrice(data.maxPrice);

  try {
    const items = await fetchDaangnListings(keyword, regionParam);
    const newItems = [];

    for (const it of items) {
      if (!seenIds.has(it.id)) {
        seenIds.add(it.id);

        // 가격 필터링
        if (minP > 0 && it.price < minP) continue;
        if (maxP > 0 && it.price > maxP) continue;

        newItems.push(it);
      }
    }

    // 최근 500개 유지
    const updatedIds = Array.from(seenIds).slice(-500);
    await chrome.storage.local.set({ seenIds: updatedIds });

    if (newItems.length > 0) {
      // 뱃지 업데이트
      chrome.action.setBadgeText({ text: String(newItems.length) });
      chrome.action.setBadgeBackgroundColor({ color: '#ff6f0f' });

      // 대표 알림 발송 (최신 1건)
      const topItem = newItems[0];
      const notifId = `daangn_item_${encodeURIComponent(topItem.url)}`;

      chrome.notifications.create(notifId, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: `🥕 [당근 새 매물] ${topItem.priceStr}`,
        message: `[${topItem.region}] ${topItem.title}`,
        priority: 2
      });
    }
  } catch (err) {
    console.error('백그라운드 당근 매물 조회 실패:', err);
  }
}

function parseUserPrice(val) {
  if (!val) return 0;
  const num = parseInt(val, 10);
  if (isNaN(num)) return 0;
  return num >= 1000 ? num : num * 10000;
}

async function resolveRegionCode(dongName) {
  try {
    const url = `https://www.daangn.com/kr/api/v1/regions/keyword?keyword=${encodeURIComponent(dongName)}`;
    const res = await fetch(url);
    if (!res.ok) return '';
    const json = await res.json();
    if (json.regions && json.regions.length > 0) {
      const top = json.regions[0];
      return `${top.name}-${top.id}`;
    }
  } catch (e) {
    console.warn(e);
  }
  return '';
}

async function fetchDaangnListings(keyword, regionParam) {
  let url = `https://www.daangn.com/kr/search/buy-sell/?q=${encodeURIComponent(keyword)}`;
  if (regionParam) {
    url += `&in=${encodeURIComponent(regionParam)}`;
  }

  const res = await fetch(url);
  if (!res.ok) return [];
  const html = await res.text();

  const links = [];
  // Background service worker doesn't have full DOMParser, so we use Regex parser for HTML
  const linkRegex = /<a[^>]+href="([^"]*\/kr\/buy-sell\/[^"#?]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];
    const innerHtml = match[2];

    if (href.includes('/kr/search/buy-sell/')) continue;

    const id = href.replace(/\/+$/, '').split('/').pop();
    const cleanText = innerHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    const priceMatch = cleanText.match(/([0-9,]+)원/);
    const priceStr = priceMatch ? priceMatch[0] : '가격 미정';
    const priceNum = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : 0;

    const dongMatch = cleanText.match(/([가-힣0-9]+[동|읍|면])/);
    const region = dongMatch ? dongMatch[1] : '지역 미정';

    // 제목은 보통 맨 앞 텍스트
    const titleMatch = cleanText.match(/^([^|0-9]+)/);
    const title = titleMatch ? titleMatch[1].trim() : cleanText.slice(0, 30);

    const fullUrl = href.startsWith('http') ? href : `https://www.daangn.com${href}`;

    links.push({
      id,
      title,
      price: priceNum,
      priceStr,
      region,
      url: fullUrl
    });
  }

  return links;
}
