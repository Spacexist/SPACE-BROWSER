// Set to store domains loaded in the canvas
const activeDomains = new Set();

// Helper to extract base domain (e.g., bilibili.com from passport.bilibili.com)
function getBaseDomain(urlStr) {
  try {
    const url = new URL(urlStr);
    const parts = url.hostname.split('.');
    if (parts.length >= 2) {
      // Check if it's a double extension like .com.cn or .co.jp
      const lastTwo = parts.slice(-2).join('.');
      if (['com.cn', 'net.cn', 'org.cn', 'co.jp', 'org.uk'].includes(lastTwo) && parts.length >= 3) {
        return parts.slice(-3).join('.');
      }
      return lastTwo;
    }
    return url.hostname;
  } catch (e) {
    return "";
  }
}

// Convert a single cookie to SameSite=None; Secure
function convertCookieToSameSiteNone(cookie) {
  if (cookie.sameSite !== 'no_restriction' || !cookie.secure) {
    const domain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
    const url = `https://${domain}${cookie.path}`;
    
    const newCookie = {
      url: url,
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      secure: true,
      sameSite: 'no_restriction',
      httpOnly: cookie.httpOnly,
      storeId: cookie.storeId
    };
    
    if (cookie.expirationDate) {
      newCookie.expirationDate = cookie.expirationDate;
    }
    
    chrome.cookies.set(newCookie, (result) => {
      if (chrome.runtime.lastError) {
        console.warn(`[Free Canvas] Failed to convert cookie for ${url}:`, chrome.runtime.lastError.message);
      } else {
        console.log(`[Free Canvas] Successfully converted cookie: ${cookie.name} -> SameSite=None; Secure`);
      }
    });
  }
}

// Convert all cookies for a specific base domain
function convertCookiesForDomain(baseDomain) {
  if (!baseDomain) return;
  
  // Query cookies for both .domain and domain
  chrome.cookies.getAll({ domain: baseDomain }, (cookies) => {
    if (cookies) {
      cookies.forEach(cookie => convertCookieToSameSiteNone(cookie));
    }
  });
}

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "register_domain" && message.url) {
    const baseDomain = getBaseDomain(message.url);
    if (baseDomain && !activeDomains.has(baseDomain)) {
      console.log(`[Free Canvas] Registering active domain for SameSite bypass: ${baseDomain}`);
      activeDomains.add(baseDomain);
      // Immediately convert existing cookies for this domain
      convertCookiesForDomain(baseDomain);
    }
  }
});

// Listen for cookie changes globally, and convert them if they belong to active domains
chrome.cookies.onChanged.addListener((changeInfo) => {
  if (changeInfo.removed) return;
  
  const { cookie } = changeInfo;
  const cookieBaseDomain = getBaseDomain(`https://${cookie.domain.replace(/^\./, '')}`);
  
  if (cookieBaseDomain && activeDomains.has(cookieBaseDomain)) {
    convertCookieToSameSiteNone(cookie);
  }
});
