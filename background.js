const MAX_LOGS = 5000;
const RULE_ID_START = 1000;
const RULE_ID_END = 10000;

let writeQueue = Promise.resolve();

function normalizeDomain(input) {
  let domain = String(input)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split(/[/?#:]/)[0]
    .replace(/^\*\./, "")
    .replace(/\.$/, "");

  if (
    !domain ||
    domain.length > 253 ||
    !domain.includes(".") ||
    !/^[a-z0-9.-]+$/.test(domain) ||
    domain.split(".").some(
      part => !part || part.length > 63 ||
        part.startsWith("-") || part.endsWith("-")
    )
  ) {
    return null;
  }

  return domain;
}

async function applyBlockedDomains() {
  try {
    const result = await chrome.storage.local.get("blockedDomains");
    const domains = [
      ...new Set(
        (result.blockedDomains || [])
          .map(normalizeDomain)
          .filter(Boolean)
      )
    ];

    const existingRules =
      await chrome.declarativeNetRequest.getDynamicRules();

    const removeRuleIds = existingRules
      .filter(rule =>
        rule.id >= RULE_ID_START && rule.id < RULE_ID_END
      )
      .map(rule => rule.id);

    const addRules = domains.map((domain, index) => ({
      id: RULE_ID_START + index,
      priority: 1,
      action: { type: "block" },
      condition: {
        urlFilter: `||${domain}^`,
        resourceTypes: ["main_frame"]
      }
    }));

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds,
      addRules
    });

    console.log("AntiRedirect: активные блокировки", domains);
  } catch (error) {
    console.error("AntiRedirect: ошибка блокировок", error);
  }
}

chrome.runtime.onInstalled.addListener(applyBlockedDomains);
chrome.runtime.onStartup.addListener(applyBlockedDomains);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.blockedDomains) {
    applyBlockedDomains();
  }
});

// На случай запуска service worker без переустановки расширения.
applyBlockedDomains();

chrome.webNavigation.onCommitted.addListener(details => {
  if (details.frameId !== 0) return;

  let parsed;

  try {
    parsed = new URL(details.url);
  } catch {
    return;
  }

  if (!["http:", "https:"].includes(parsed.protocol)) return;

  const entry = {
    time: new Date().toISOString(),
    tabId: details.tabId,
    url: details.url,
    domain: parsed.hostname.toLowerCase(),
    transitionType: details.transitionType,
    qualifiers: details.transitionQualifiers || []
  };

  writeQueue = writeQueue
    .then(async () => {
      const result = await chrome.storage.local.get("navigationLog");
      const logs = result.navigationLog || [];

      logs.push(entry);

      if (logs.length > MAX_LOGS) {
        logs.splice(0, logs.length - MAX_LOGS);
      }

      await chrome.storage.local.set({ navigationLog: logs });
    })
    .catch(error => {
      console.error("AntiRedirect: ошибка журнала", error);
    });
});




chrome.webNavigation.onBeforeNavigate.addListener(async details => {
  if (details.frameId !== 0 || details.tabId < 0) return;

  let url;
  try {
    url = new URL(details.url);
  } catch {
    return;
  }

  if (!["http:", "https:"].includes(url.protocol)) return;

  const result = await chrome.storage.local.get("blockedDomains");
  const domains = result.blockedDomains || [];
  const hostname = url.hostname.toLowerCase();

  const isBlocked = domains.some(domain => {
    domain = domain.toLowerCase();
    return hostname === domain || hostname.endsWith("." + domain);
  });

  if (isBlocked) {
    try {
      await chrome.tabs.remove(details.tabId);
    } catch (error) {
      // Вкладка могла закрыться самостоятельно.
    }
  }
});