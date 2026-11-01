// Daangn Item Search Chrome Extension - popup.js

document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements
  const keywordInput = document.getElementById('keyword');
  const minPriceInput = document.getElementById('minPrice');
  const maxPriceInput = document.getElementById('maxPrice');
  const regionInput = document.getElementById('region');
  const sortBySelect = document.getElementById('sortBy');
  const searchBtn = document.getElementById('searchBtn');
  const tagBtns = document.querySelectorAll('.tag-btn');
  
  const enableAlarmCheckbox = document.getElementById('enableAlarm');
  const alarmOptions = document.getElementById('alarmOptions');
  const alarmIntervalSelect = document.getElementById('alarmInterval');
  
  const resultsCountBadge = document.getElementById('resultsCountBadge');
  const statusMsg = document.getElementById('statusMsg');
  const loadingSpinner = document.getElementById('loadingSpinner');
  const itemList = document.getElementById('itemList');

  let currentFetchedItems = [];

  // 1. 기존 저장된 설정 불러오기
  const saved = await chrome.storage.local.get([
    'keyword', 'minPrice', 'maxPrice', 'region', 'sortBy',
    'enableAlarm', 'alarmInterval'
  ]);

  if (saved.keyword) keywordInput.value = saved.keyword;
  if (saved.minPrice !== undefined && saved.minPrice !== '') minPriceInput.value = saved.minPrice;
  if (saved.maxPrice !== undefined && saved.maxPrice !== '') maxPriceInput.value = saved.maxPrice;
  if (saved.region) regionInput.value = saved.region;
  if (saved.sortBy) sortBySelect.value = saved.sortBy;
  
  if (saved.enableAlarm) {
    enableAlarmCheckbox.checked = true;
    alarmOptions.classList.remove('hidden');
    if (saved.alarmInterval) alarmIntervalSelect.value = saved.alarmInterval;
  }

  // 2. 빠른 가격 태그 버튼 이벤트
  tagBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const min = btn.dataset.min;
      const max = btn.dataset.max;
      minPriceInput.value = min === "0" && max === "0" ? "" : min;
      maxPriceInput.value = max === "0" ? "" : max;
    });
  });

  // 3. 알림 토글 이벤트
  enableAlarmCheckbox.addEventListener('change', async () => {
    if (enableAlarmCheckbox.checked) {
      alarmOptions.classList.remove('hidden');
    } else {
      alarmOptions.classList.add('hidden');
      await chrome.alarms.clear('checkDaangn');
      await chrome.action.setBadgeText({ text: '' });
    }
    saveSettings();
  });

  alarmIntervalSelect.addEventListener('change', saveSettings);

  // 4. 정렬 방식 변경 시 즉시 재정렬 (다시 크롤링하지 않고 정렬만 수행)
  sortBySelect.addEventListener('change', () => {
    saveSettings();
    if (currentFetchedItems.length > 0) {
      renderItems(sortItems(currentFetchedItems, sortBySelect.value));
    }
  });

  // 5. 검색 실행 이벤트
  searchBtn.addEventListener('click', executeSearch);
  keywordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') executeSearch();
  });

  // 설정 저장 함수
  async function saveSettings() {
    const settings = {
      keyword: keywordInput.value.trim(),
      minPrice: minPriceInput.value.trim(),
      maxPrice: maxPriceInput.value.trim(),
      region: regionInput.value.trim(),
      sortBy: sortBySelect.value,
      enableAlarm: enableAlarmCheckbox.checked,
      alarmInterval: alarmIntervalSelect.value
    };
    await chrome.storage.local.set(settings);

    // 알림 설정이 켜져있으면 알람 등록
    if (settings.enableAlarm && settings.keyword) {
      const intervalMinutes = parseInt(settings.alarmInterval, 10) || 15;
      chrome.alarms.create('checkDaangn', {
        periodInMinutes: intervalMinutes
      });
    }
  }

  // 검색 메인 실행 함수
  async function executeSearch() {
    const rawKeyword = keywordInput.value.trim();
    if (!rawKeyword) {
      alert('검색할 제품명을 입력해주세요! (예: 나이키 로말리오4)');
      keywordInput.focus();
      return;
    }

    await saveSettings();

    // UI 상태 초기화
    loadingSpinner.classList.remove('hidden');
    itemList.innerHTML = '';
    resultsCountBadge.classList.add('hidden');
    statusMsg.textContent = '당근마켓 매물 조회 중...';

    try {
      // 지역 해석 (동 이름 -> 당근 region code)
      const regionInputVal = regionInput.value.trim();
      let regionParam = "";
      if (regionInputVal) {
        if (regionInputVal.includes("-")) {
          regionParam = regionInputVal;
        } else {
          regionParam = await resolveRegionCode(regionInputVal);
        }
      }

      // 키워드 동의어 확장 (로말리오 -> 로말레오 등)
      const searchKeywords = getExpandedKeywords(rawKeyword);

      // 매물 크롤링
      const allFound = [];
      const seenIds = new Set();

      for (const kw of searchKeywords) {
        const items = await fetchDaangnListings(kw, regionParam);
        for (const it of items) {
          if (!seenIds.has(it.id)) {
            seenIds.add(it.id);
            allFound.push(it);
          }
        }
      }

      // 가격 필터링 계산 (만원 단위 입력 처리)
      const minP = parseUserPrice(minPriceInput.value.trim());
      const maxP = parseUserPrice(maxPriceInput.value.trim());

      const filtered = allFound.filter(it => {
        if (minP > 0 && it.price < minP) return false;
        if (maxP > 0 && it.price > maxP) return false;
        return true;
      });

      currentFetchedItems = filtered;

      // 정렬 적용
      const sorted = sortItems(filtered, sortBySelect.value);

      // 렌더링
      loadingSpinner.classList.add('hidden');
      resultsCountBadge.textContent = `${sorted.length}건`;
      resultsCountBadge.classList.remove('hidden');
      statusMsg.textContent = regionParam ? `지역: ${regionInputVal}` : '전국 매물';

      renderItems(sorted);

    } catch (err) {
      console.error(err);
      loadingSpinner.classList.add('hidden');
      statusMsg.textContent = '조회 실패';
      itemList.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">⚠️</span>
          <p>매물을 가져오는 중 오류가 발생했습니다.<br><small>${err.message}</small></p>
        </div>
      `;
    }
  }

  // 사용자 가격 입력값 파싱 (10 입력 시 100,000원으로 자동 변환)
  function parseUserPrice(val) {
    if (!val) return 0;
    const num = parseInt(val, 10);
    if (isNaN(num)) return 0;
    // 만약 1000 이상 입력했다면 원 단위 직접 입력으로 간주, 1000 미만이면 만원 단위로 계산
    return num >= 1000 ? num : num * 10000;
  }

  // 키워드 동의어 확장 (예: 로말리오 -> 로말레오 추가)
  function getExpandedKeywords(kw) {
    const set = new Set([kw]);
    if (kw.includes("로말리오")) {
      set.add(kw.replace(/로말리오/g, "로말레오"));
    }
    if (kw.includes("로말레오")) {
      set.add(kw.replace(/로말레오/g, "로말리오"));
    }
    return Array.from(set);
  }

  // 동 이름으로 당근 지역 코드 가져오기
  async function resolveRegionCode(dongName) {
    try {
      const url = `https://www.daangn.com/kr/api/v1/regions/keyword?keyword=${encodeURIComponent(dongName)}`;
      const res = await fetch(url);
      if (!res.ok) return "";
      const json = await res.json();
      if (json.regions && json.regions.length > 0) {
        const top = json.regions[0];
        return `${top.name}-${top.id}`;
      }
    } catch (e) {
      console.warn("지역 코드 변환 실패:", e);
    }
    return "";
  }

  // 당근마켓 웹 페이지 Fetch 및 HTML 파싱
  async function fetchDaangnListings(keyword, regionParam) {
    let url = `https://www.daangn.com/kr/search/buy-sell/?q=${encodeURIComponent(keyword)}`;
    if (regionParam) {
      url += `&in=${encodeURIComponent(regionParam)}`;
    }

    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const links = doc.querySelectorAll('a[href*="/kr/buy-sell/"]');
    const items = [];
    const seenHrefs = new Set();

    links.forEach(a => {
      const href = a.getAttribute('href');
      if (!href || href === '/kr/search/buy-sell/' || seenHrefs.has(href)) return;
      seenHrefs.add(href);

      const id = href.replace(/\/+$/, '').split('/').pop();
      const textBlocks = Array.from(a.querySelectorAll('*'))
        .map(el => el.textContent.trim())
        .filter(t => t.length > 0);

      // 이미지 추출
      const imgElem = a.querySelector('img');
      const imgSrc = imgElem ? imgElem.getAttribute('src') : '';

      // 제목, 가격, 지역 추출
      const titleElem = a.querySelector('h2') || a.querySelector('[class*="title"]') || a;
      const title = (titleElem.textContent || '').trim();

      let priceStr = '가격 미정';
      let priceNum = 0;
      let region = '지역 정보 없음';
      let hasDirectBuy = a.textContent.includes('바로구매');

      // 텍스트 블록에서 가격과 지역 매칭
      const fullText = a.textContent;
      const priceMatch = fullText.match(/([0-9,]+)원/);
      if (priceMatch) {
        priceStr = priceMatch[0];
        priceNum = parseInt(priceMatch[1].replace(/,/g, ''), 10);
      }

      // 지역명 추출 (보통 동 단위 텍스트)
      const dongMatch = fullText.match(/([가-힣0-9]+[동|읍|면])/);
      if (dongMatch) {
        region = dongMatch[1];
      }

      if (id && title) {
        const fullUrl = href.startsWith('http') ? href : `https://www.daangn.com${href}`;
        items.push({
          id,
          title,
          price: priceNum,
          priceStr,
          region,
          imgSrc,
          hasDirectBuy,
          url: fullUrl
        });
      }
    });

    return items;
  }

  // 정렬 함수
  function sortItems(items, sortBy) {
    const list = [...items];
    if (sortBy === 'price_asc') {
      return list.sort((a, b) => a.price - b.price);
    } else if (sortBy === 'price_desc') {
      return list.sort((a, b) => b.price - a.price);
    }
    // 'latest' 기본순 (당근 검색 원본 순서 유지)
    return list;
  }

  // 결과 화면 렌더링
  function renderItems(items) {
    itemList.innerHTML = '';

    if (items.length === 0) {
      itemList.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">🔍</span>
          <p>조건에 맞는 매물이 없습니다.<br><small>가격 범위를 넓히거나 지역을 비워보세요.</small></p>
        </div>
      `;
      return;
    }

    items.forEach(it => {
      const card = document.createElement('a');
      card.className = 'item-card';
      card.href = it.url;
      card.target = '_blank';

      // 썸네일
      const thumb = document.createElement('div');
      thumb.className = 'item-thumb';
      if (it.imgSrc) {
        const img = document.createElement('img');
        img.src = it.imgSrc;
        img.className = 'item-thumb';
        img.loading = 'lazy';
        img.onerror = () => { img.style.display = 'none'; thumb.textContent = '🥕'; };
        thumb.appendChild(img);
      } else {
        thumb.textContent = '🥕';
      }

      // 매물 정보
      const info = document.createElement('div');
      info.className = 'item-info';

      const title = document.createElement('div');
      title.className = 'item-title';
      title.textContent = it.title;

      const price = document.createElement('div');
      price.className = 'item-price';
      price.textContent = it.priceStr;

      const meta = document.createElement('div');
      meta.className = 'item-meta';
      
      const regionSpan = document.createElement('span');
      regionSpan.textContent = it.region;
      meta.appendChild(regionSpan);

      if (it.hasDirectBuy) {
        const badge = document.createElement('span');
        badge.className = 'direct-badge';
        badge.textContent = '바로구매/택배';
        meta.appendChild(badge);
      }

      info.appendChild(title);
      info.appendChild(price);
      info.appendChild(meta);

      card.appendChild(thumb);
      card.appendChild(info);

      card.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: it.url });
      });

      itemList.appendChild(card);
    });
  }
});
