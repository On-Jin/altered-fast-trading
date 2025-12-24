// Content script for Altered Fast Trading
// Injects ADD buttons on card collection pages

(function() {
  'use strict';

  // Check if we're on a cards page
  if (!window.location.href.includes('/cards')) {
    return;
  }

  // Track added counts per card reference
  const addedCounts = {};

  // Hash dictionary (loaded from storage)
  let hashDictionary = {};

  // CSS for the buttons
  const style = document.createElement('style');
  style.textContent = `
    .aft-button-container {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-top: 8px;
      padding: 4px;
      background: rgba(0, 0, 0, 0.05);
      border-radius: 8px;
    }
    .aft-row {
      display: flex;
      gap: 4px;
      justify-content: center;
      align-items: center;
    }
    .aft-tracker {
      font-size: 13px;
      font-weight: bold;
      color: #999;
      margin-right: 4px;
      font-family: monospace;
    }
    .aft-tracker.has-cards {
      color: #48bb78;
    }
    .aft-separator {
      font-size: 11px;
      color: #999;
      margin-right: 4px;
    }
    .aft-label {
      font-size: 11px;
      font-weight: bold;
      color: #BD8049;
      margin-right: 2px;
    }
    .aft-btn {
      padding: 4px 8px;
      font-size: 11px;
      font-weight: bold;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      background: #BD8049;
      color: white;
      transition: all 0.15s ease-out;
      min-width: 28px;
    }
    .aft-btn:hover:not(:disabled) {
      background: #9A6838;
      transform: translateY(-1px);
    }
    .aft-btn:active:not(:disabled) {
      transform: translateY(0);
    }
    .aft-btn:disabled {
      opacity: 0.3;
      cursor: not-allowed;
      background: #666;
    }
    .aft-btn.added {
      background: #48bb78;
    }
    .aft-btn-reset {
      padding: 2px 6px;
      font-size: 10px;
      font-weight: bold;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      background: #e53e3e;
      color: white;
      transition: all 0.15s ease-out;
    }
    .aft-btn-reset:hover:not(:disabled) {
      background: #c53030;
    }
    .aft-btn-reset:disabled {
      opacity: 0.3;
      cursor: not-allowed;
      background: #666;
    }
  `;
  document.head.appendChild(style);

  // Add card to the extension's list
  async function addCardToList(reference, quantity) {
    try {
      const saved = await chrome.storage.local.get(['cardList']);
      let cardList = saved.cardList || '';

      // Check if card already in list
      const lines = cardList.split('\n');
      let found = false;

      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].trim().match(/^(\d+)\s+(.+)$/);
        if (match && match[2].trim() === reference) {
          // Update quantity
          const newQty = parseInt(match[1], 10) + quantity;
          lines[i] = `${newQty} ${reference}`;
          found = true;
          break;
        }
      }

      if (!found) {
        // Add new line
        if (cardList.trim()) {
          cardList = cardList.trim() + '\n';
        }
        cardList += `${quantity} ${reference}`;
      } else {
        cardList = lines.join('\n');
      }

      await chrome.storage.local.set({ cardList: cardList });
      return true;
    } catch (err) {
      console.error('Altered Fast Trading: Error adding card', err);
      return false;
    }
  }

  // Remove card from the extension's list (set to 0)
  async function removeCardFromList(reference) {
    try {
      const saved = await chrome.storage.local.get(['cardList']);
      let cardList = saved.cardList || '';

      const lines = cardList.split('\n');
      const newLines = lines.filter(line => {
        const match = line.trim().match(/^(\d+)\s+(.+)$/);
        return !(match && match[2].trim() === reference);
      });

      await chrome.storage.local.set({ cardList: newLines.join('\n') });
      return true;
    } catch (err) {
      console.error('Altered Fast Trading: Error removing card', err);
      return false;
    }
  }

  // Show feedback on button
  function showFeedback(button, success) {
    const originalText = button.textContent;
    button.textContent = success ? '✓' : '✗';
    button.classList.add('added');
    setTimeout(() => {
      button.textContent = originalText;
      button.classList.remove('added');
    }, 1000);
  }

  // Note: addedCounts is defined at top level for fetch interceptor access

  // Get current added count for a reference from storage
  async function getAddedCount(reference) {
    const saved = await chrome.storage.local.get(['cardList']);
    const cardList = saved.cardList || '';
    const lines = cardList.split('\n');

    for (const line of lines) {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      if (match && match[2].trim() === reference) {
        return parseInt(match[1], 10);
      }
    }
    return 0;
  }

  // Update button states based on remaining count
  function updateButtonStates(container, reference, totalAvailable) {
    const added = addedCounts[reference] || 0;
    const remaining = totalAvailable - added;
    const canSell = container.dataset.canSell === 'true';

    const buttons = container.querySelectorAll('.aft-btn');
    const quantities = [1, 2, 3, 1]; // ALL just needs 1+ remaining

    buttons.forEach((btn, index) => {
      const qty = quantities[index];
      btn.disabled = !canSell || remaining < qty || remaining === 0;
    });

    // Update the tracker count
    const tracker = container.querySelector('.aft-tracker');
    if (tracker) {
      tracker.textContent = `Give [${added}]`;
      tracker.classList.toggle('has-cards', added > 0);
    }

    // Update reset button state
    const resetBtn = container.querySelector('.aft-btn-reset');
    if (resetBtn) {
      resetBtn.disabled = added === 0;
    }
  }

  // Create ADD buttons for a card
  function createButtons(reference, availableCount, canSell) {
    const container = document.createElement('div');
    container.className = 'aft-button-container';
    container.dataset.aftProcessed = 'true';
    container.dataset.reference = reference;
    container.dataset.totalAvailable = availableCount;
    container.dataset.canSell = canSell;

    // Initialize added count
    if (!addedCounts[reference]) {
      addedCounts[reference] = 0;
    }

    // === ROW 1: [0] | Reset to 0 ===
    const row1 = document.createElement('div');
    row1.className = 'aft-row';

    // Add tracker count [0]
    const tracker = document.createElement('span');
    tracker.className = 'aft-tracker';
    tracker.textContent = '[0]';
    row1.appendChild(tracker);

    // Add separator
    const separator1 = document.createElement('span');
    separator1.className = 'aft-separator';
    separator1.textContent = '|';
    row1.appendChild(separator1);

    // Add Reset button
    const resetBtn = document.createElement('button');
    resetBtn.className = 'aft-btn-reset';
    resetBtn.textContent = 'Reset to 0';
    resetBtn.disabled = true; // Initially disabled since count is 0

    resetBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const success = await removeCardFromList(reference);
      if (success) {
        addedCounts[reference] = 0;
        updateButtonStates(container, reference, availableCount);
      }
    });

    row1.appendChild(resetBtn);
    container.appendChild(row1);

    // === ROW 2: ADD 1 2 3 ALL ===
    const row2 = document.createElement('div');
    row2.className = 'aft-row';

    // Add "ADD" label
    const label = document.createElement('span');
    label.className = 'aft-label';
    label.textContent = 'ADD';
    row2.appendChild(label);

    const quantities = [1, 2, 3, 'ALL'];

    for (const qty of quantities) {
      const btn = document.createElement('button');
      btn.className = 'aft-btn';
      btn.textContent = qty === 'ALL' ? 'ALL' : qty;

      const actualQty = qty === 'ALL' ? availableCount : qty;

      // Disable if not enough cards or can't sell
      if (!canSell || availableCount < actualQty || availableCount === 0) {
        btn.disabled = true;
      }

      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        // Read current availableCount from container dataset (may have been updated)
        const currentAvailable = parseInt(container.dataset.totalAvailable, 10) || 0;

        console.log('AFT: Button clicked for', reference, 'qty:', qty, 'available:', currentAvailable);

        // Calculate remaining
        const added = addedCounts[reference] || 0;
        const remaining = currentAvailable - added;
        const qtyToAdd = qty === 'ALL' ? remaining : Math.min(actualQty, remaining);

        console.log('AFT: added:', added, 'remaining:', remaining, 'qtyToAdd:', qtyToAdd);

        if (qtyToAdd <= 0) {
          btn.disabled = true;
          return;
        }

        const success = await addCardToList(reference, qtyToAdd);
        console.log('AFT: addCardToList result:', success);
        showFeedback(btn, success);

        if (success) {
          // Update tracked count
          addedCounts[reference] = (addedCounts[reference] || 0) + qtyToAdd;
          // Update all buttons for this card
          updateButtonStates(container, reference, currentAvailable);
        }
      });

      row2.appendChild(btn);
    }

    container.appendChild(row2);

    // Load existing count from storage and update buttons
    getAddedCount(reference).then(count => {
      addedCounts[reference] = count;
      updateButtonStates(container, reference, availableCount);
    });

    return container;
  }

  // Deep search for ALT_ reference in any object
  function findReferenceInObject(obj, depth = 0) {
    if (depth > 5 || !obj || typeof obj !== 'object') return null;

    // Check common property names
    const propNames = ['cardRef', 'reference', 'cardReference', 'ref', 'id'];
    for (const prop of propNames) {
      if (obj[prop] && typeof obj[prop] === 'string' && obj[prop].startsWith('ALT_')) {
        return obj[prop];
      }
    }

    // Check nested objects
    if (obj.card && obj.card.reference) return obj.card.reference;
    if (obj.data && obj.data.reference) return obj.data.reference;
    if (obj.item && obj.item.reference) return obj.item.reference;

    // Search in all properties
    for (const key of Object.keys(obj)) {
      try {
        const val = obj[key];
        if (typeof val === 'string' && val.startsWith('ALT_') && val.includes('_B_')) {
          return val;
        }
        if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
          const found = findReferenceInObject(val, depth + 1);
          if (found) return found;
        }
      } catch (e) {}
    }

    return null;
  }

  // Extract card reference from React fiber properties
  function getCardReferenceFromReact(element) {
    try {
      // Find React fiber or props property
      const reactKey = Object.keys(element).find(key =>
        key.startsWith('__reactFiber$') ||
        key.startsWith('__reactInternalInstance$') ||
        key.startsWith('__reactProps$')
      );

      if (!reactKey) return null;

      // If it's a props key, search directly
      if (reactKey.startsWith('__reactProps$')) {
        const props = element[reactKey];
        const found = findReferenceInObject(props);
        if (found) return found;
      }

      // Traverse the fiber tree (both up and down)
      let fiber = element[reactKey];
      const visited = new Set();
      const queue = [fiber];

      while (queue.length > 0) {
        fiber = queue.shift();
        if (!fiber || visited.has(fiber)) continue;
        visited.add(fiber);

        if (visited.size > 50) break; // Limit search

        // Check memoizedProps
        const props = fiber.memoizedProps || fiber.pendingProps;
        if (props) {
          const found = findReferenceInObject(props);
          if (found) return found;
        }

        // Check memoizedState
        if (fiber.memoizedState) {
          const found = findReferenceInObject(fiber.memoizedState);
          if (found) return found;
        }

        // Add parent and child to queue
        if (fiber.return) queue.push(fiber.return);
        if (fiber.child) queue.push(fiber.child);
        if (fiber.sibling) queue.push(fiber.sibling);
      }

      return null;
    } catch (err) {
      console.error('Altered Fast Trading: Error accessing React fiber', err);
      return null;
    }
  }

  // Try to find card reference from various sources
  function findCardReference(cardElement) {
    // Try on the card element itself
    let ref = getCardReferenceFromReact(cardElement);
    if (ref) return ref;

    // Try all interactive elements that might have the data
    const selectors = [
      'button',
      'a',
      'img',
      '[class*="card"]',
      '.relative.rounded-lg',
      'div[tabindex]'
    ];

    for (const selector of selectors) {
      const elements = cardElement.querySelectorAll(selector);
      for (const el of elements) {
        ref = getCardReferenceFromReact(el);
        if (ref) return ref;
      }
    }

    // Fallback: use image hash + dictionary lookup
    const img = cardElement.querySelector('img');
    if (img) {
      const srcset = img.getAttribute('srcset') || '';
      const src = img.src || '';
      const combined = srcset + ' ' + src;

      // Skip UNIQUE cards (they have /UNIQUE/ in the URL path, may be URL-encoded)
      if (combined.includes('/UNIQUE/') || combined.includes('%2FUNIQUE%2F')) {
        return 'SKIP_UNIQUE';
      }

      // Extract image hash
      const hashMatch = combined.match(/([a-f0-9]{32})\.(jpg|webp|png)/i);
      if (hashMatch) {
        const hash = hashMatch[1].toLowerCase();
        console.log('AFT DEBUG: Found hash:', hash, 'in dict:', !!hashDictionary[hash]);

        // Look up in dictionary
        if (hashDictionary[hash]) {
          return hashDictionary[hash];
        }
      } else {
        console.log('AFT DEBUG: No hash found in:', combined.substring(0, 200));
      }

      // No dictionary match - card is likely promo or not loaded yet
    }

    return null;
  }

  // Extract card info from a card element
  function extractCardInfo(cardElement) {
    let reference = null;
    let availableCount = 0;
    let canSell = false;

    // Find reference using React fiber or visual detection
    reference = findCardReference(cardElement);

    // Find the collection count - look for the badge with fa-book-sparkles icon
    const collectionBadge = cardElement.querySelector('.fa-book-sparkles');
    if (collectionBadge) {
      // The count is in a sibling div with class "text-sm"
      const badgeContainer = collectionBadge.closest('div');
      if (badgeContainer) {
        const countDiv = badgeContainer.querySelector('.text-sm');
        if (countDiv) {
          const countText = countDiv.textContent.trim();
          // Only parse if it's a valid number (not special characters)
          const parsed = parseInt(countText, 10);
          if (!isNaN(parsed) && parsed > 0) {
            availableCount = parsed;
            canSell = true;
          }
        }
      }
    }

    // Alternative: check if Sell/Buy buttons are disabled
    // If the "Buy" button is disabled and we have a count, it might mean we can't sell
    const buyButton = cardElement.querySelector('button:disabled');
    if (buyButton && buyButton.textContent.includes('Buy')) {
      // Buy is disabled, check if sell is also disabled
      const allButtons = cardElement.querySelectorAll('button');
      for (const btn of allButtons) {
        if (btn.textContent.includes('Sell') && !btn.disabled) {
          canSell = true;
          break;
        }
      }
    }

    // If we have a count > 0 from the badge, we can sell
    if (availableCount > 0) {
      canSell = true;
    }

    return { reference, availableCount, canSell };
  }

  // Re-check and update button states for existing containers
  function refreshButtonStates() {
    const containers = document.querySelectorAll('.aft-button-container');

    for (const container of containers) {
      const reference = container.dataset.reference;
      const card = container.closest('.flex.flex-col');
      if (!card) continue;

      // Re-extract count info
      const collectionBadge = card.querySelector('.fa-book-sparkles');
      if (collectionBadge) {
        const badgeContainer = collectionBadge.closest('div');
        if (badgeContainer) {
          const countDiv = badgeContainer.querySelector('.text-sm');
          if (countDiv) {
            const countText = countDiv.textContent.trim();
            const parsed = parseInt(countText, 10);
            if (!isNaN(parsed) && parsed > 0) {
              // Update container data and button states
              container.dataset.totalAvailable = parsed;
              container.dataset.canSell = 'true';
              updateButtonStates(container, reference, parsed);
            }
          }
        }
      }
    }
  }

  // Find and process all cards on the page
  function processCards() {
    // The altered.gg collection page uses a grid layout
    // Each card is in: div.grid-12 > div.flex.flex-col (with col-span classes)
    const gridContainer = document.querySelector('.grid-12');
    if (!gridContainer) {
      console.log('AFT: No grid container found');
      return;
    }

    // Select all card containers within the grid
    // They have classes like: flex flex-col gap-2 md:col-span-3 sm:col-span-4 col-span-6
    const cards = gridContainer.querySelectorAll(':scope > div.flex.flex-col');
    if (cards.length === 0) {
      console.log('AFT: No cards in grid');
      return;
    }

    const dictSize = Object.keys(hashDictionary).length;
    if (dictSize === 0) {
      console.warn('AFT: Dictionary is empty! Click "Refresh Card Dictionary" in extension popup.');
    }

    let processed = 0;
    let noRef = 0;

    for (const card of cards) {
      // Skip if already processed or marked as skipped (unique)
      if (card.querySelector('.aft-button-container') || card.dataset.aftSkipped) {
        continue;
      }

      const { reference, availableCount, canSell } = extractCardInfo(card);

      if (reference === 'SKIP_UNIQUE') {
        // Mark as processed so we don't keep retrying
        card.dataset.aftSkipped = 'unique';
        continue;
      }

      if (reference) {
        // Find the bottom section where we'll add buttons
        // Try multiple selectors for the bottom action area
        const bottomSection = card.querySelector('[class*="px-1"]') ||
                              card.querySelector('.flex.gap-2.items-center') ||
                              card;

        const buttons = createButtons(reference, availableCount, canSell);
        bottomSection.appendChild(buttons);
        processed++;
      } else {
        noRef++;
      }
    }

    if (processed > 0 || noRef > 0) {
      console.log(`AFT: Processed ${processed} cards, ${noRef} skipped (no ref/not in dict)`);
    }

    // Schedule a re-check to update button states after badges load
    if (processed > 0) {
      setTimeout(refreshButtonStates, 1500);
    }
  }

  // Sync addedCounts with storage and update all buttons
  async function syncCountsFromStorage() {
    const saved = await chrome.storage.local.get(['cardList']);
    const cardList = saved.cardList || '';

    // Reset all counts
    for (const ref in addedCounts) {
      addedCounts[ref] = 0;
    }

    // Parse card list and update counts
    const lines = cardList.split('\n');
    for (const line of lines) {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      if (match) {
        const qty = parseInt(match[1], 10);
        const ref = match[2].trim();
        addedCounts[ref] = qty;
      }
    }

    // Update all button containers
    const containers = document.querySelectorAll('.aft-button-container');
    for (const container of containers) {
      const reference = container.dataset.reference;
      const totalAvailable = parseInt(container.dataset.totalAvailable, 10) || 0;
      updateButtonStates(container, reference, totalAvailable);
    }
  }

  // Detect page locale from URL
  function detectPageLocale() {
    const match = window.location.pathname.match(/^\/([a-z]{2}-[a-z]{2})\//i);
    return match ? match[1].toLowerCase() : null;
  }

  // Retry processing until cards are found
  let retryCount = 0;
  const maxRetries = 60; // 60 retries x 5 seconds = 300 seconds max

  function retryProcessCards() {
    const gridContainer = document.querySelector('.grid-12');
    const cards = gridContainer?.querySelectorAll(':scope > div.flex.flex-col') || [];
    // Only count cards that don't have buttons AND aren't skipped (unique)
    const unprocessed = Array.from(cards).filter(c =>
      !c.querySelector('.aft-button-container') && !c.dataset.aftSkipped
    );

    if (unprocessed.length > 0 && Object.keys(hashDictionary).length > 0) {
      processCards();
      // Check if we actually processed any (not just marked as skipped)
      const stillUnprocessed = Array.from(cards).filter(c =>
        !c.querySelector('.aft-button-container') && !c.dataset.aftSkipped
      );
      if (stillUnprocessed.length === 0) {
        retryCount = 0; // All done
      }
    }

    if (retryCount < maxRetries) {
      retryCount++;
      setTimeout(retryProcessCards, 5000); // Retry every 5 seconds
    }
  }

  // Initialize: load dictionary then process cards
  async function initialize() {
    try {
      // Load hash dictionary from storage
      const stored = await chrome.storage.local.get(['hashDictionary', 'hashDictionaryLocale']);
      if (stored.hashDictionary) {
        hashDictionary = stored.hashDictionary;
        const keys = Object.keys(hashDictionary);
        console.log('Altered Fast Trading: Dictionary loaded with', keys.length, 'entries');
        if (keys.length > 0) {
          console.log('AFT DEBUG: First 3 dict keys:', keys.slice(0, 3));
        }

        // Check locale mismatch
        const pageLocale = detectPageLocale();
        const dictLocale = stored.hashDictionaryLocale;
        if (pageLocale && dictLocale && pageLocale !== dictLocale) {
          console.warn(`Altered Fast Trading: Locale mismatch! Page is ${pageLocale}, dictionary is ${dictLocale}. Rebuild dictionary or change page language.`);
          // Store mismatch info for popup to display
          await chrome.storage.local.set({ localeWarning: `Page locale (${pageLocale}) ≠ Dictionary (${dictLocale})` });
        } else {
          await chrome.storage.local.set({ localeWarning: null });
        }
      } else {
        console.log('Altered Fast Trading: No dictionary found. Click "Refresh Card Dictionary" in the extension popup to build one.');
      }

      // Listen for storage changes (e.g., list cleared from popup)
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.cardList) {
          syncCountsFromStorage();
        }
      });

      // Start retry loop to process cards (handles slow page loads)
      setTimeout(retryProcessCards, 1000);

      // Watch for dynamic content loading
      const observer = new MutationObserver((mutations) => {
        let shouldProcess = false;

        for (const mutation of mutations) {
          if (mutation.addedNodes.length > 0) {
            shouldProcess = true;
            break;
          }
        }

        if (shouldProcess) {
          setTimeout(processCards, 500);
          // Also refresh existing button states in case badges just loaded
          setTimeout(refreshButtonStates, 800);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
    } catch (err) {
      console.error('Altered Fast Trading: Initialization error', err);
    }
  }

  // Only run on /[lang]/cards pages
  const cardsPagePattern = /^\/[a-z]{2}-[a-z]{2}\/cards/;
  if (cardsPagePattern.test(window.location.pathname)) {
    initialize();
    console.log('Altered Fast Trading: Content script loaded on cards page');
  } else {
    console.log('Altered Fast Trading: Not a cards page, skipping');
  }
})();
