const stats = document.getElementById("stats");
const domainList = document.getElementById("domainList");
const search = document.getElementById("search");
const message = document.getElementById("message");

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

async function getData() {
  const result = await chrome.storage.local.get([
    "navigationLog",
    "blockedDomains"
  ]);

  return {
    logs: result.navigationLog || [],
    blocked: new Set(result.blockedDomains || [])
  };
}

async function saveBlocked(domains) {
  await chrome.storage.local.set({
    blockedDomains: [...new Set(domains)]
  });
}

async function toggleBlock(domain, shouldBlock) {
  const data = await getData();
  const blocked = new Set(data.blocked);

  if (shouldBlock) {
    blocked.add(domain);
  } else {
    blocked.delete(domain);
  }

  await saveBlocked([...blocked]);
  message.textContent = shouldBlock
    ? `Добавлен в блокировку: ${domain}`
    : `Разблокирован: ${domain}`;

  await render();
}

async function render() {
  const { logs, blocked } = await getData();
  const counts = new Map();

  for (const entry of logs) {
    if (entry.domain) {
      const domain = entry.domain.toLowerCase();
      counts.set(domain, (counts.get(domain) || 0) + 1);
    }
  }

  stats.textContent =
    `Записей: ${logs.length} · Доменов: ${counts.size} · ` +
    `Заблокировано: ${blocked.size}`;

  domainList.replaceChildren();

  const query = search.value.trim().toLowerCase();

  const domains = [...new Set([
    ...counts.keys(),
    ...blocked
  ])]
    .filter(domain => domain.includes(query))
    .sort((a, b) =>
      (counts.get(b) || 0) - (counts.get(a) || 0) ||
      a.localeCompare(b)
    );

  if (domains.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = query
      ? "Ничего не найдено."
      : "Пока нет записанных доменов. Открой несколько страниц и обнови список.";
    domainList.append(empty);
    return;
  }

  for (const domain of domains) {
    const isBlocked = blocked.has(domain);

    const row = document.createElement("div");
    row.className = "domain";
    if (isBlocked) row.classList.add("blocked");

    const info = document.createElement("div");
    info.className = "info";

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = domain;

    const count = document.createElement("div");
    count.className = "count";
    count.textContent =
      `Переходов: ${counts.get(domain) || 0}` +
      (isBlocked ? " · В блокировке" : "");

    const button = document.createElement("button");
    button.textContent = isBlocked ? "Разблокировать" : "Заблокировать";
    button.addEventListener("click", () => {
      toggleBlock(domain, !isBlocked).catch(showError);
    });

    info.append(name, count);
    row.append(info, button);
    domainList.append(row);
  }
}

function showError(error) {
  console.error(error);
  message.textContent = `Ошибка: ${error.message || error}`;
}

document.getElementById("addDomain").addEventListener("click", async () => {
  const input = prompt("Введи домен, например clickadu.net");
  if (input === null) return;

  const domain = normalizeDomain(input);

  if (!domain) {
    message.textContent = "Некорректный домен. Пример: clickadu.net";
    return;
  }

  try {
    await toggleBlock(domain, true);
  } catch (error) {
    showError(error);
  }
});

document.getElementById("refresh").addEventListener("click", () => {
  render().catch(showError);
});

search.addEventListener("input", () => {
  render().catch(showError);
});

document.getElementById("clear").addEventListener("click", async () => {
  if (!confirm("Точно очистить весь журнал переходов?")) return;

  try {
    await chrome.storage.local.set({ navigationLog: [] });
    message.textContent = "Журнал очищен. Список блокировок сохранён.";
    await render();
  } catch (error) {
    showError(error);
  }
});

document.getElementById("export").addEventListener("click", async () => {
  try {
    const { logs, blocked } = await getData();

    const text = [
      "ANTIREDIRECT — ЖУРНАЛ ПЕРЕХОДОВ",
      `Всего записей: ${logs.length}`,
      "",
      "ЗАБЛОКИРОВАННЫЕ ДОМЕНЫ:",
      ...[...blocked].sort(),
      "",
      "ИСТОРИЯ:",
      ...logs.map(entry => [
        `Время: ${entry.time}`,
        `Домен: ${entry.domain}`,
        `URL: ${entry.url}`,
        `Tab ID: ${entry.tabId}`,
        `Переход: ${entry.transitionType}`,
        `Метки: ${(entry.qualifiers || []).join(", ")}`,
        "----------------------------------------"
      ].join("\n"))
    ].join("\n");

    const blob = new Blob([text], {
      type: "text/plain;charset=utf-8"
    });

    const url = URL.createObjectURL(blob);

    try {
      await chrome.downloads.download({
        url,
        filename: "AntiRedirect-log.txt",
        saveAs: true
      });
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  } catch (error) {
    showError(error);
  }
});

render().catch(showError);