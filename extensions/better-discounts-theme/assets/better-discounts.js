(function () {
  const CARD_SELECTOR = ".card-gallery";
  const CARD_SCOPE_SELECTOR = ".product-card__content";
  const IMAGE_SELECTOR = ".product-media";
  const PRICE_HOST_SELECTOR = "product-price";
  const COMPARE_PRICE_SELECTOR = ".price-item--regular.compare-at-price";
  const APP_COMPARE_PRICE_SELECTOR = ".bd-price-compare";
  const CURRENT_PRICE_FALLBACK_SELECTORS = [
    ".price-item--sale.price",
    ".price__sale .price",
    ".price__regular .price",
    ".price",
  ];
  const NATIVE_BADGE_SELECTOR = ".product-badges";
  const PRODUCT_BLOCK_SELECTOR = ".bd-badge--product[data-bd-product-handle]";

  function log(config, message, payload) {
    if (!config?.debug) return;
    if (payload !== undefined) {
      console.debug("[Discounto]", message, payload);
    } else {
      console.debug("[Discounto]", message);
    }
  }

  function parsePrice(text) {
    if (!text) return null;

    const normalized = text
      .replace(/\s/g, "")
      .replace(/[^\d,.-]/g, "")
      .replace(/\.(?=\d{3}(?:\D|$))/g, "")
      .replace(",", ".");

    const value = Number(normalized);
    return Number.isFinite(value) ? value : null;
  }

  function parseHandleFromHref(href) {
    if (!href) return null;

    try {
      const url = new URL(href, window.location.origin);
      const match = url.pathname.match(/\/products\/([^/?#]+)/i);
      return match ? decodeURIComponent(match[1]) : null;
    } catch (_error) {
      return null;
    }
  }

  function formatMoney(amount, currency, locale) {
    try {
      return new Intl.NumberFormat(locale || undefined, {
        style: "currency",
        currency: currency || "USD",
        maximumFractionDigits: 2,
      }).format(amount);
    } catch (_error) {
      return String(amount);
    }
  }

  function resolveCurrency(config, explicitCurrency) {
    return (
      explicitCurrency ||
      config?.storeCurrency ||
      document.documentElement.getAttribute("data-shop-currency") ||
      "USD"
    );
  }

  function computeDiscountAmounts(basePrice, campaign) {
    if (!campaign || !basePrice || basePrice <= 0) return null;

    if (campaign.discountKind === "FIXED_AMOUNT") {
      const savingsAmount = Math.min(basePrice, campaign.discountValue);
      const discountedPrice = Math.max(0, basePrice - savingsAmount);
      const savingsPercent = basePrice > 0 ? Math.round((savingsAmount / basePrice) * 100) : 0;

      return { savingsAmount, discountedPrice, savingsPercent };
    }

    const savingsAmount = basePrice * (campaign.discountValue / 100);
    const discountedPrice = Math.max(0, basePrice - savingsAmount);
    const savingsPercent = Math.round(campaign.discountValue);

    return { savingsAmount, discountedPrice, savingsPercent };
  }

  function renderLabel(template, percent, amountText) {
    return String(template || "Save {{ percent }}%")
      .replace(/\{\{\s*percent\s*\}\}/g, String(percent))
      .replace(/\{\{\s*amount\s*\}\}/g, amountText);
  }

  function resolveCardLabelTemplate(config, campaign) {
    if (config?.hasCustomBadgeTemplate) {
      return config.badgeTemplate;
    }

    return campaign?.badgeText || config?.badgeTemplate;
  }

  function applyCustomProperties(el, config) {
    el.style.setProperty("--bd-accent", config.accentColor);
    el.style.setProperty("--bd-badge-text", config.badgeTextColor);
    el.style.setProperty("--bd-savings-color", config.savingsColor);
  }

  function createImageChip(label, config) {
    const wrap = document.createElement("div");
    wrap.className = `bd-chip-wrap bd-chip-wrap--${config.badgePosition}`;
    applyCustomProperties(wrap, config);

    const chip = document.createElement("span");
    chip.className = `bd-chip bd-chip--image bd-style-${config.cardStyle}`;
    chip.textContent = label;
    applyCustomProperties(chip, config);
    wrap.appendChild(chip);

    return wrap;
  }

  function createSavingsRow(label, savingsText, config) {
    const row = document.createElement("div");
    row.className = `bd-card-savings bd-style-${config.cardStyle}`;
    applyCustomProperties(row, config);

    if (config.showInlineBadge) {
      const chip = document.createElement("span");
      chip.className = `bd-chip bd-chip--inline bd-style-${config.cardStyle}`;
      chip.textContent = label;
      applyCustomProperties(chip, config);
      row.appendChild(chip);
    }

    if (config.showSavingsLine) {
      const text = document.createElement("p");
      text.className = "bd-card-savings__text";
      text.textContent = savingsText;
      row.appendChild(text);
    }

    return row;
  }

  function hideNativeBadge(nativeBadge) {
    if (!nativeBadge || nativeBadge.dataset.bdNativeHidden === "true") return;
    nativeBadge.style.display = "none";
    nativeBadge.dataset.bdNativeHidden = "true";
  }

  function findCardScope(card) {
    return card.closest(CARD_SCOPE_SELECTOR) || card.parentElement;
  }

  function findFirstMatchingElement(root, selectors) {
    for (const selector of selectors) {
      const element = root?.querySelector(selector);
      if (element) {
        return element;
      }
    }

    return null;
  }

  function findCurrentPriceElement(priceHost) {
    return findFirstMatchingElement(priceHost, CURRENT_PRICE_FALLBACK_SELECTORS);
  }

  function findComparePriceElement(priceHost) {
    return priceHost?.querySelector(COMPARE_PRICE_SELECTOR) || null;
  }

  function getPriceHostNodes(priceHost) {
    return {
      saleContainer: priceHost?.querySelector(".price__sale") || null,
      regularContainer: priceHost?.querySelector(".price__regular") || null,
      salePriceElement: priceHost?.querySelector(".price-item--sale.price") || null,
      regularPriceElement: priceHost?.querySelector(".price__regular .price") || null,
      compareElement: findComparePriceElement(priceHost),
      appCompareElement: priceHost?.querySelector(APP_COMPARE_PRICE_SELECTOR) || null,
      currentElement: findCurrentPriceElement(priceHost),
    };
  }

  function findCurrentCardPrice(priceHost) {
    return parsePrice(findCurrentPriceElement(priceHost)?.textContent);
  }

  function findNearestProductPriceHost(block) {
    const nearbyScopes = [
      block.parentElement,
      block.closest(".shopify-section"),
      block.closest("section"),
      block.closest("main"),
      document,
    ].filter(Boolean);

    for (const scope of nearbyScopes) {
      const siblingCandidates = [
        block.previousElementSibling,
        block.nextElementSibling,
        scope.querySelector?.(PRICE_HOST_SELECTOR),
      ].filter(Boolean);

      for (const candidate of siblingCandidates) {
        if (candidate?.matches?.(PRICE_HOST_SELECTOR)) {
          return candidate;
        }

        const nestedPriceHost = candidate?.querySelector?.(PRICE_HOST_SELECTOR);
        if (nestedPriceHost) {
          return nestedPriceHost;
        }
      }
    }

    return null;
  }

  function findStickyProductPriceHosts() {
    const stickySelectors = [
      '[class*="sticky"]',
      '[id*="sticky"]',
      '[data-sticky]',
      '[data-sticky-bar]',
      '[data-product-sticky]',
    ];
    const hosts = [];

    for (const selector of stickySelectors) {
      document.querySelectorAll(selector).forEach((container) => {
        if (!(container instanceof Element)) return;

        if (container.matches(PRICE_HOST_SELECTOR)) {
          hosts.push(container);
        }

        container.querySelectorAll?.(PRICE_HOST_SELECTOR).forEach((host) => {
          hosts.push(host);
        });
      });
    }

    return [...new Set(hosts)];
  }

  function findRelevantProductPriceHosts(block) {
    const hosts = [];
    const nearestHost = findNearestProductPriceHost(block);

    if (nearestHost) {
      hosts.push(nearestHost);
    }

    hosts.push(...findStickyProductPriceHosts());

    return [...new Set(hosts)].filter(Boolean);
  }

  function buildCampaignLookup(campaigns) {
    const byHandle = new Map();

    campaigns.forEach((campaign) => {
      campaign.products.forEach((product) => {
        if (product.productHandle) {
          byHandle.set(product.productHandle, campaign);
        }
      });
    });

    return { byHandle };
  }

  function findCampaignForCard(card, campaignLookup) {
    const href = card.querySelector("a[href*=\"/products/\"]")?.getAttribute("href");
    const handle = parseHandleFromHref(href);

    if (!handle) return null;
    return campaignLookup.byHandle.get(handle) ?? null;
  }

  function preserveOriginalPriceHostState(priceHost) {
    if (!priceHost || priceHost.dataset.bdOriginalCaptured === "true") return;

    const nodes = getPriceHostNodes(priceHost);
    const currentElement = nodes.currentElement;
    const compareElement = nodes.compareElement;

    if (currentElement) {
      priceHost.dataset.bdOriginalCurrentText = currentElement.textContent || "";
    }

    if (nodes.salePriceElement) {
      priceHost.dataset.bdOriginalSaleText = nodes.salePriceElement.textContent || "";
    }

    if (nodes.regularPriceElement) {
      priceHost.dataset.bdOriginalRegularText = nodes.regularPriceElement.textContent || "";
    }

    if (compareElement) {
      priceHost.dataset.bdOriginalCompareText = compareElement.textContent || "";
    } else {
      priceHost.dataset.bdOriginalCompareText = "";
    }

    if (nodes.saleContainer) {
      priceHost.dataset.bdOriginalSaleDisplay = nodes.saleContainer.style.display || "";
    }

    if (nodes.regularContainer) {
      priceHost.dataset.bdOriginalRegularDisplay = nodes.regularContainer.style.display || "";
    }

    priceHost.dataset.bdOriginalCaptured = "true";
  }

  function ensureAppComparePriceElement(priceHost) {
    const nodes = getPriceHostNodes(priceHost);
    let compareElement = nodes.appCompareElement;
    if (compareElement) return compareElement;

    const anchorElement =
      nodes.regularPriceElement ||
      nodes.salePriceElement ||
      nodes.currentElement;
    const visibleLine =
      anchorElement?.parentElement ||
      nodes.regularContainer ||
      nodes.saleContainer ||
      priceHost;

    if (!visibleLine) {
      return null;
    }

    compareElement = document.createElement("span");
    compareElement.className = "bd-price-compare";
    compareElement.dataset.bdCreated = "true";
    compareElement.setAttribute("aria-label", "Original price");

    if (anchorElement?.insertAdjacentElement) {
      anchorElement.insertAdjacentElement("afterend", compareElement);
    } else {
      visibleLine.appendChild(compareElement);
    }

    return compareElement;
  }

  function restorePriceHost(priceHost) {
    if (!priceHost || priceHost.dataset.bdPriceOverridden !== "true") return;

    const nodes = getPriceHostNodes(priceHost);
    const currentElement = nodes.currentElement;
    const compareElement = nodes.compareElement;
    const appCompareElement = nodes.appCompareElement;
    const originalCurrentText = priceHost.dataset.bdOriginalCurrentText || "";
    const originalCompareText = priceHost.dataset.bdOriginalCompareText || "";
    const originalSaleText = priceHost.dataset.bdOriginalSaleText || "";
    const originalRegularText = priceHost.dataset.bdOriginalRegularText || "";

    if (currentElement && originalCurrentText) {
      currentElement.textContent = originalCurrentText;
    }

    if (nodes.salePriceElement && originalSaleText) {
      nodes.salePriceElement.textContent = originalSaleText;
    }

    if (nodes.regularPriceElement && originalRegularText) {
      nodes.regularPriceElement.textContent = originalRegularText;
    }

    if (compareElement) {
      if (originalCompareText) {
        compareElement.textContent = originalCompareText;
        compareElement.style.display = "";
        compareElement.hidden = false;
      } else {
        compareElement.textContent = "";
        compareElement.style.display = "none";
        compareElement.hidden = true;
      }
    }

    if (appCompareElement) {
      appCompareElement.remove();
    }

    if (nodes.saleContainer) {
      nodes.saleContainer.style.display = priceHost.dataset.bdOriginalSaleDisplay || "";
      nodes.saleContainer.hidden = false;
    }

    if (nodes.regularContainer) {
      nodes.regularContainer.style.display = priceHost.dataset.bdOriginalRegularDisplay || "";
      nodes.regularContainer.hidden = false;
    }

    priceHost.classList.remove("bd-price-host--override");
    delete priceHost.dataset.bdAppliedCampaignId;
    priceHost.dataset.bdPriceOverridden = "false";
  }

  function overridePriceHost(priceHost, campaignId, discountedText, compareText) {
    if (!priceHost) return;

    preserveOriginalPriceHostState(priceHost);

    const nodes = getPriceHostNodes(priceHost);
    const currentElement = nodes.currentElement;
    const compareElement = ensureAppComparePriceElement(priceHost);

    if (currentElement) {
      currentElement.textContent = discountedText;
    }

    if (nodes.salePriceElement) {
      nodes.salePriceElement.textContent = discountedText;
    }

    if (nodes.regularPriceElement) {
      nodes.regularPriceElement.textContent = discountedText;
    }

    if (compareElement) {
      compareElement.textContent = compareText;
      compareElement.style.display = "";
      compareElement.hidden = false;
    }

    if (nodes.saleContainer) {
      nodes.saleContainer.style.display = "";
      nodes.saleContainer.hidden = false;
    }

    if (nodes.regularContainer) {
      nodes.regularContainer.style.display = "";
      nodes.regularContainer.hidden = false;
    }

    priceHost.classList.add("bd-price-host--override");
    priceHost.dataset.bdAppliedCampaignId = campaignId;
    priceHost.dataset.bdPriceOverridden = "true";
  }

  function findCompareAtFallbackData(card, config) {
    const scope = findCardScope(card);
    if (!scope) return null;

    const imageTarget = card.querySelector(IMAGE_SELECTOR);
    const priceHost = scope.querySelector(PRICE_HOST_SELECTOR);
    const comparePriceElement = findComparePriceElement(priceHost);
    const nativeBadge = card.querySelector(NATIVE_BADGE_SELECTOR);
    const currentPrice = findCurrentCardPrice(priceHost);
    const compareAtPrice = parsePrice(comparePriceElement?.textContent);

    if (!imageTarget || !priceHost || !comparePriceElement || !currentPrice || !compareAtPrice) {
      return null;
    }

    if (compareAtPrice <= currentPrice) {
      return null;
    }

    return {
      imageTarget,
      priceHost,
      nativeBadge,
      basePrice: compareAtPrice,
      currentPrice,
      compareAtPrice,
      currency: resolveCurrency(config),
    };
  }

  function applyCampaignToCard(card, config, campaignLookup) {
    const scope = findCardScope(card);
    if (!scope) return;

    const imageTarget = card.querySelector(IMAGE_SELECTOR);
    const priceHost = scope.querySelector(PRICE_HOST_SELECTOR);
    const nativeBadge = card.querySelector(NATIVE_BADGE_SELECTOR);
    const campaign = findCampaignForCard(card, campaignLookup);

    if (campaign && imageTarget && priceHost) {
      const basePrice =
        Number(priceHost.dataset.bdOriginalBasePrice) ||
        findCurrentCardPrice(priceHost);
      const amounts = computeDiscountAmounts(basePrice, campaign);

      if (basePrice && !priceHost.dataset.bdOriginalBasePrice) {
        priceHost.dataset.bdOriginalBasePrice = String(basePrice);
      }

      if (amounts) {
        const amountText = formatMoney(
          amounts.savingsAmount,
          resolveCurrency(config),
          document.documentElement.lang || undefined,
        );
        const discountedText = formatMoney(
          amounts.discountedPrice,
          resolveCurrency(config),
          document.documentElement.lang || undefined,
        );
        const compareText = formatMoney(
          basePrice,
          resolveCurrency(config),
          document.documentElement.lang || undefined,
        );
        const label = renderLabel(
          resolveCardLabelTemplate(config, campaign),
          amounts.savingsPercent,
          amountText,
        );
        const prefix = String(config.savingsPrefix || "").trim();
        const savingsText = prefix ? `${prefix} ${amountText}` : amountText;

        overridePriceHost(priceHost, campaign.id, discountedText, compareText);

        if (config.showImageBadge && !imageTarget.querySelector(".bd-chip-wrap")) {
          imageTarget.classList.add("bd-sale-target");
          imageTarget.appendChild(createImageChip(label, config));
          hideNativeBadge(nativeBadge);
        }

        if (
          (config.showInlineBadge || config.showSavingsLine) &&
          !priceHost.querySelector(".bd-card-savings") &&
          !priceHost.nextElementSibling?.matches?.(".bd-card-savings")
        ) {
          const savingsRow = createSavingsRow(label, savingsText, config);
          try {
            priceHost.appendChild(savingsRow);
          } catch (_error) {
            priceHost.insertAdjacentElement("afterend", savingsRow);
          }
        }

        card.dataset.bdProcessed = "true";
        return;
      }
    }

    if (priceHost) {
      restorePriceHost(priceHost);
    }

    const fallbackData = findCompareAtFallbackData(card, config);
    if (!fallbackData) return;

    const percent = Math.round(
      ((fallbackData.compareAtPrice - fallbackData.currentPrice) / fallbackData.compareAtPrice) *
        100,
    );
    const amountText = formatMoney(
      fallbackData.compareAtPrice - fallbackData.currentPrice,
      fallbackData.currency,
      document.documentElement.lang || undefined,
    );
    const label = renderLabel(config.badgeTemplate, percent, amountText);
    const prefix = String(config.savingsPrefix || "").trim();
    const savingsText = prefix ? `${prefix} ${amountText}` : amountText;

    if (config.showImageBadge && !fallbackData.imageTarget.querySelector(".bd-chip-wrap")) {
      fallbackData.imageTarget.classList.add("bd-sale-target");
      fallbackData.imageTarget.appendChild(createImageChip(label, config));
      hideNativeBadge(fallbackData.nativeBadge);
    }

    if (
      (config.showInlineBadge || config.showSavingsLine) &&
      !fallbackData.priceHost.querySelector(".bd-card-savings") &&
      !fallbackData.priceHost.nextElementSibling?.matches?.(".bd-card-savings")
    ) {
      const savingsRow = createSavingsRow(label, savingsText, config);
      try {
        fallbackData.priceHost.appendChild(savingsRow);
      } catch (_error) {
        fallbackData.priceHost.insertAdjacentElement("afterend", savingsRow);
      }
    }

    card.dataset.bdProcessed = "true";
  }

  function applyCampaignToProductBlocks(config, campaignLookup) {
    document.querySelectorAll(PRODUCT_BLOCK_SELECTOR).forEach((block) => {
      const handle = block.getAttribute("data-bd-product-handle");
      if (!handle) return;

      const campaign = campaignLookup.byHandle.get(handle);
      const livePriceHosts = findRelevantProductPriceHosts(block);
      const livePriceHost = livePriceHosts[0] || null;

      if (!campaign) {
        livePriceHosts.forEach((host) => restorePriceHost(host));
        return;
      }

      const fallbackPriceCents = Number(block.getAttribute("data-bd-price-cents") || 0);
      const currentBasePrice = findCurrentCardPrice(livePriceHost);
      const basePrice =
        Number(livePriceHost?.dataset.bdOriginalBasePrice) ||
        currentBasePrice ||
        fallbackPriceCents / 100;
      const amounts = computeDiscountAmounts(basePrice, campaign);

      if (!amounts) return;

      const currency = block.getAttribute("data-bd-currency") || resolveCurrency(config);
      const labelMode = block.getAttribute("data-bd-label-mode") || "save";
      const customLabel = block.getAttribute("data-bd-custom-label") || "";
      const savingsPrefix = block.getAttribute("data-bd-savings-prefix") || "";
      const showBadge = block.getAttribute("data-bd-show-badge") === "true";
      const showSavingsLine = block.getAttribute("data-bd-show-savings-line") === "true";
      const showPriceRow = block.getAttribute("data-bd-show-price-row") === "true";

      livePriceHosts.forEach((host) => {
        if (host && !host.dataset.bdOriginalBasePrice) {
          host.dataset.bdOriginalBasePrice = String(basePrice);
        }
      });

      let labelTemplate = customLabel;
      if (!labelTemplate) {
        if (labelMode === "sale") {
          labelTemplate = "Sale {{ percent }}%";
        } else if (labelMode === "percent_only") {
          labelTemplate = "-{{ percent }}%";
        } else if (labelMode === "amount") {
          labelTemplate = "Save {{ amount }}";
        } else {
          labelTemplate = "Save {{ percent }}%";
        }
      }

      const amountText = formatMoney(
        amounts.savingsAmount,
        currency,
        document.documentElement.lang || undefined,
      );
      const currentPriceText = formatMoney(
        amounts.discountedPrice,
        currency,
        document.documentElement.lang || undefined,
      );
      const comparePriceText = formatMoney(
        basePrice,
        currency,
        document.documentElement.lang || undefined,
      );
      const label = renderLabel(
        customLabel || campaign.badgeText || labelTemplate,
        amounts.savingsPercent,
        amountText,
      );
      const prefix = String(savingsPrefix || "").trim();
      const savingsText = prefix ? `${prefix} ${amountText}` : amountText;

      livePriceHosts.forEach((host) => {
        overridePriceHost(host, campaign.id, currentPriceText, comparePriceText);
      });

      const fragments = [];

      if (showBadge) {
        fragments.push(`<span class="bd-badge__pill">${label}</span>`);
      }

      if (showSavingsLine) {
        fragments.push(`<span class="bd-badge__savings">${savingsText}</span>`);
      }

      if (showPriceRow) {
        fragments.push(
          `<div class="bd-badge__prices" aria-label="Sale pricing"><span class="bd-badge__sale-price">${currentPriceText}</span><span class="bd-badge__compare-price">${comparePriceText}</span></div>`,
        );
      }

      block.innerHTML = fragments.join("");
    });
  }

  function scanCards(config, campaignLookup, root) {
    const cards = Array.from((root || document).querySelectorAll(CARD_SELECTOR));
    cards.forEach((card) => applyCampaignToCard(card, config, campaignLookup));
  }

  async function loadCampaignLookup(config) {
    if (!config?.proxyUrl) {
      return buildCampaignLookup([]);
    }

    try {
      const response = await fetch(config.proxyUrl, {
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Proxy request failed with ${response.status}`);
      }

      const payload = await response.json();
      return buildCampaignLookup(Array.isArray(payload.campaigns) ? payload.campaigns : []);
    } catch (error) {
      log(config, "Falling back to compare-at storefront logic", error);
      return buildCampaignLookup([]);
    }
  }

  async function boot() {
    const config = window.BetterDiscountsThemeConfig;
    if (!config) return;

    const campaignLookup = await loadCampaignLookup(config);
    log(config, "Loaded campaign lookup", campaignLookup);

    scanCards(config, campaignLookup, document);
    applyCampaignToProductBlocks(config, campaignLookup);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;

          if (node.matches?.(CARD_SELECTOR)) {
            applyCampaignToCard(node, config, campaignLookup);
            return;
          }

          if (node.querySelector?.(CARD_SELECTOR) || node.matches?.(PRODUCT_BLOCK_SELECTOR)) {
            scanCards(config, campaignLookup, node);
            applyCampaignToProductBlocks(config, campaignLookup);
          }
        });
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
