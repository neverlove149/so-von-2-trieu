const currencyFormatter = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0,
});

const dateFormatter = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const state = {
  data: null,
  filter: "all",
  chart: null,
};

const elements = {
  balance: document.querySelector("#balance"),
  chart: document.querySelector("#balance-chart"),
  dataPolicy: document.querySelector("#data-policy"),
  emptyState: document.querySelector("#empty-state"),
  experimentCount: document.querySelector("#experiment-count"),
  experimentList: document.querySelector("#experiment-list"),
  initialCapital: document.querySelector("#initial-capital"),
  ledgerBody: document.querySelector("#ledger-body"),
  netProfit: document.querySelector("#net-profit"),
  profitCard: document.querySelector("#profit-card"),
  refreshButton: document.querySelector("#refresh-button"),
  syncLabel: document.querySelector("#sync-label"),
  syncState: document.querySelector("#sync-state"),
  totalCost: document.querySelector("#total-cost"),
  totalRevenue: document.querySelector("#total-revenue"),
  updatedAt: document.querySelector("#updated-at"),
};

function money(value) {
  return currencyFormatter.format(Number(value) || 0).replace("₫", "đ");
}

function shortMoney(value) {
  const number = Number(value) || 0;
  if (Math.abs(number) >= 1000000) {
    return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(number / 1000000)} tr`;
  }
  if (Math.abs(number) >= 1000) {
    return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(number / 1000)}k`;
  }
  return new Intl.NumberFormat("vi-VN").format(number);
}

function formatDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return dateFormatter.format(new Date(year, month - 1, day));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function calculateSummary(data) {
  return data.entries.reduce(
    (summary, entry) => {
      summary.cost += Number(entry.cost) || 0;
      summary.revenue += Number(entry.revenue) || 0;
      return summary;
    },
    { cost: 0, revenue: 0 },
  );
}

function entriesWithBalance(data) {
  let runningBalance = Number(data.meta.initialCapital) || 0;
  return [...data.entries]
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
    .map((entry) => {
      const profit = (Number(entry.revenue) || 0) - (Number(entry.cost) || 0);
      runningBalance += profit;
      return { ...entry, profit, balance: runningBalance };
    });
}

function renderMetrics(data) {
  const summary = calculateSummary(data);
  const profit = summary.revenue - summary.cost;
  const balance = data.meta.initialCapital + profit;

  elements.initialCapital.textContent = money(data.meta.initialCapital);
  elements.totalCost.textContent = money(summary.cost);
  elements.totalRevenue.textContent = money(summary.revenue);
  elements.netProfit.textContent = money(profit);
  elements.balance.textContent = money(balance);
  elements.updatedAt.textContent = formatDate(data.meta.updatedAt);
  elements.dataPolicy.textContent = data.meta.dataPolicy;

  elements.profitCard.classList.toggle("is-positive", profit > 0);
  elements.profitCard.classList.toggle("is-negative", profit < 0);
}

function renderExperiments(data) {
  elements.experimentCount.textContent = data.experiments.length;
  elements.experimentList.innerHTML = data.experiments
    .map(
      (experiment) => `
        <article class="experiment">
          <div class="experiment__top">
            <h3>${escapeHtml(experiment.name)}</h3>
            <span class="status-badge">${escapeHtml(experiment.status)}</span>
          </div>
          <div class="experiment__numbers">
            <div><span>Đã chi</span><strong>${money(experiment.spent)}</strong></div>
            <div><span>Đã thu</span><strong>${money(experiment.revenue)}</strong></div>
          </div>
          <p class="experiment__next"><strong>Bước tiếp:</strong> ${escapeHtml(experiment.nextAction)}</p>
        </article>
      `,
    )
    .join("");
}

function filteredEntries(entries) {
  if (state.filter === "income") return entries.filter((entry) => entry.revenue > 0);
  if (state.filter === "expense") return entries.filter((entry) => entry.cost > 0);
  return entries;
}

function renderLedger(data) {
  const entries = filteredEntries(entriesWithBalance(data)).reverse();
  elements.emptyState.hidden = entries.length > 0;
  elements.ledgerBody.hidden = entries.length === 0;
  elements.ledgerBody.innerHTML = entries
    .map((entry) => {
      const statusClass = entry.status === "Hoàn tất" ? " is-complete" : "";
      const profitClass = entry.profit > 0 ? "money-positive" : entry.profit < 0 ? "money-negative" : "";
      return `
        <tr>
          <td data-label="Ngày">${formatDate(entry.date)}</td>
          <td data-label="Việc đã làm">
            <span class="cell-main">${escapeHtml(entry.activity)}</span>
            <span class="cell-note">${escapeHtml(entry.note)}</span>
          </td>
          <td data-label="Kênh">${escapeHtml(entry.channel)}</td>
          <td data-label="Trạng thái"><span class="row-status${statusClass}">${escapeHtml(entry.status)}</span></td>
          <td data-label="Chi phí" class="number">${money(entry.cost)}</td>
          <td data-label="Doanh thu" class="number">${money(entry.revenue)}</td>
          <td data-label="Lãi/lỗ" class="number ${profitClass}">${money(entry.profit)}</td>
          <td data-label="Số dư" class="number"><strong>${money(entry.balance)}</strong></td>
          <td data-label="Bằng chứng">${escapeHtml(entry.evidence)}</td>
        </tr>
      `;
    })
    .join("");
}

function dailyBalances(data) {
  const groups = new Map();
  entriesWithBalance(data).forEach((entry) => {
    groups.set(entry.date, entry.balance);
  });
  return [...groups.entries()].map(([date, balance]) => ({ date, balance }));
}

function renderChart(data) {
  if (!window.Chart) return;
  const points = dailyBalances(data);
  const labels = points.map((point) => formatDate(point.date));
  const values = points.map((point) => point.balance);

  if (state.chart) state.chart.destroy();
  state.chart = new Chart(elements.chart, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Số dư",
          data: values,
          borderColor: "#116c4f",
          backgroundColor: "rgba(17, 108, 79, 0.08)",
          borderWidth: 2,
          pointBackgroundColor: "#ffffff",
          pointBorderColor: "#116c4f",
          pointBorderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6,
          fill: true,
          tension: 0.25,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? false : { duration: 250 },
      interaction: { intersect: false, mode: "index" },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          callbacks: { label: (context) => `Số dư: ${money(context.parsed.y)}` },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: "#65726c", font: { family: "IBM Plex Sans", size: 11 } },
          border: { color: "#d5ded9" },
        },
        y: {
          beginAtZero: false,
          grid: { color: "#e5ebe8" },
          ticks: {
            color: "#65726c",
            callback: (value) => shortMoney(value),
            font: { family: "IBM Plex Sans", size: 11 },
          },
          border: { display: false },
        },
      },
    },
  });
}

function render(data) {
  renderMetrics(data);
  renderExperiments(data);
  renderLedger(data);
  renderChart(data);
  window.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } });
}

function setSyncState(mode, label) {
  elements.syncState.classList.toggle("is-live", mode === "live");
  elements.syncState.classList.toggle("is-error", mode === "error");
  elements.syncLabel.textContent = label;
}

async function loadData({ manual = false } = {}) {
  if (manual) elements.refreshButton.classList.add("is-loading");
  setSyncState("loading", "Đang cập nhật");

  try {
    let response = await fetch(`/api/ledger?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) {
      response = await fetch(`data/ledger.json?t=${Date.now()}`, { cache: "no-store" });
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.data = await response.json();
    render(state.data);
    setSyncState("live", "Đang trực tuyến");
  } catch (error) {
    console.error(error);
    setSyncState("error", "Mất kết nối");
  } finally {
    elements.refreshButton.classList.remove("is-loading");
  }
}

elements.refreshButton.addEventListener("click", () => loadData({ manual: true }));

document.querySelectorAll("[data-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    state.filter = button.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach((item) => {
      const active = item === button;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    if (state.data) renderLedger(state.data);
  });
});

loadData();
window.setInterval(loadData, 20000);
