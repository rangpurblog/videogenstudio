'use strict';

const { downloadProductMedia } = require('./mediaDownloader.cjs');

// ── ASIN extraction ───────────────────────────────────────────────────────────

function extractAsin(url) {
  const patterns = [
    /\/dp\/([A-Z0-9]{10})/i,
    /\/gp\/product\/([A-Z0-9]{10})/i,
    /\/product\/([A-Z0-9]{10})/i,
    /[?&]asin=([A-Z0-9]{10})/i,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return m[1].toUpperCase();
  }
  return null;
}

// ── PAAPI 5 ───────────────────────────────────────────────────────────────────

async function fetchMetaViaPaapi(asin, credentials, onProgress) {
  let amazonPaapi;
  try { amazonPaapi = require('amazon-paapi'); }
  catch { throw new Error('amazon-paapi package not found'); }

  onProgress('Calling Amazon Product Advertising API…');

  const data = await amazonPaapi.GetItems(
    {
      AccessKey: credentials.accessKey,
      SecretKey: credentials.secretKey,
      PartnerTag: credentials.partnerTag,
      PartnerType: 'Associates',
      Marketplace: credentials.marketplace || 'www.amazon.com',
    },
    {
      ItemIds: [asin],
      ItemIdType: 'ASIN',
      Condition: 'New',
      Resources: [
        'Images.Primary.Large',
        'Images.Primary.Medium',
        'Images.Variants.Large',
        'ItemInfo.Title',
        'ItemInfo.Features',
      ],
    }
  );

  const item = data?.ItemsResult?.Items?.[0];
  if (!item) throw new Error('PAAPI returned no item for ASIN ' + asin);

  const title = item.ItemInfo?.Title?.DisplayValue || 'Unknown Product';
  const imageUrls = [];

  if (item.Images?.Primary?.Large?.URL) {
    imageUrls.push({
      url: item.Images.Primary.Large.URL,
      width: item.Images.Primary.Large.Width || 0,
      height: item.Images.Primary.Large.Height || 0,
    });
  }
  for (const v of item.Images?.Variants || []) {
    if (v.Large?.URL) imageUrls.push({ url: v.Large.URL, width: v.Large.Width || 0, height: v.Large.Height || 0 });
  }

  return { title, imageUrls, videoUrls: [] };
}

// ── Puppeteer scraping ────────────────────────────────────────────────────────

async function fetchMetaViaScraping(productUrl, onProgress) {
  let puppeteer;
  try { puppeteer = require('puppeteer'); }
  catch { throw new Error('puppeteer not found'); }

  onProgress('Launching browser…');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1280, height: 900 });

    onProgress('Loading product page…');
    await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await Promise.race([
      page.waitForSelector('#productTitle', { timeout: 10000 }),
      page.waitForSelector('#landingImage', { timeout: 10000 }),
    ]).catch(() => {});

    onProgress('Extracting product data…');

    const { title, imageUrls, videoUrls } = await page.evaluate(() => {
      const title = document.querySelector('#productTitle')?.textContent?.trim() || 'Unknown Product';
      const imageUrls = [];

      const mainImg = document.querySelector('#landingImage, #imgTagWrapperId img, #main-image');
      if (mainImg) {
        const dyn = mainImg.getAttribute('data-a-dynamic-image');
        if (dyn) {
          try {
            const obj = JSON.parse(dyn);
            const best = Object.keys(obj).sort((a, b) => {
              const [aw, ah] = obj[a]; const [bw, bh] = obj[b];
              return (bw * bh) - (aw * ah);
            })[0];
            if (best) imageUrls.push({ url: best, width: 0, height: 0 });
          } catch {}
        }
        const hi = mainImg.getAttribute('data-old-hires');
        if (hi?.startsWith('http') && !imageUrls.some((i) => i.url === hi)) {
          imageUrls.push({ url: hi, width: 0, height: 0 });
        }
        if (!imageUrls.length && mainImg.src) {
          imageUrls.push({ url: mainImg.src, width: 0, height: 0 });
        }
      }

      for (const el of document.querySelectorAll('#altImages .a-button-thumbnail img, .imageThumbnail img, li.image.item img')) {
        const full = (el.src || '').replace(/\._[A-Z0-9_,]+_\.(jpg|jpeg|png|gif)/i, '._SL1500_.$1');
        if (full && !imageUrls.some((i) => i.url === full)) imageUrls.push({ url: full, width: 0, height: 0 });
      }

      const videoUrls = [];
      for (const v of document.querySelectorAll('video source, video[src]')) {
        const src = v.src || v.getAttribute('src');
        if (src?.endsWith('.mp4') && !videoUrls.some((u) => u.url === src)) videoUrls.push({ url: src });
      }
      for (const s of document.querySelectorAll('script:not([src])')) {
        for (const m of [...(s.textContent || '').matchAll(/"(https:\/\/[^"]+\.mp4)"/g)]) {
          if (!videoUrls.some((u) => u.url === m[1])) videoUrls.push({ url: m[1] });
        }
      }

      return { title, imageUrls: imageUrls.slice(0, 10), videoUrls: videoUrls.slice(0, 3) };
    });

    return { title, imageUrls, videoUrls };
  } finally {
    await browser.close();
  }
}

// ── Public entry point ────────────────────────────────────────────────────────

async function fetchProductData(productUrl, credentials, mediaBaseDir, productIndex, onProgress = () => {}) {
  const asin = extractAsin(productUrl) || ('product_' + productIndex);

  let title = '';
  let imageUrls = [];
  let videoUrls = [];
  let source = 'scraping';

  if (credentials?.accessKey && credentials?.secretKey && credentials?.partnerTag) {
    try {
      const meta = await fetchMetaViaPaapi(asin, credentials, onProgress);
      title = meta.title;
      imageUrls = meta.imageUrls;
      videoUrls = meta.videoUrls;
      source = 'paapi';
    } catch (err) {
      onProgress(`PAAPI failed (${err.message}) — switching to scraping…`);
    }
  }

  if (!title) {
    const meta = await fetchMetaViaScraping(productUrl, onProgress);
    title = meta.title;
    imageUrls = meta.imageUrls;
    videoUrls = meta.videoUrls;
    source = 'scraping';
  }

  onProgress(`Downloading ${imageUrls.length} image(s), ${videoUrls.length} video(s)…`);

  const dlResult = await downloadProductMedia({
    productIndex,
    title,
    imageUrls,
    videoUrls,
    mediaBaseDir,
    onProgress,
  });

  return {
    title,
    images: dlResult.images,
    videos: dlResult.videos,
    productDir: dlResult.productDir,
    stats: dlResult.stats,
    source,
  };
}

module.exports = { fetchProductData, extractAsin };
