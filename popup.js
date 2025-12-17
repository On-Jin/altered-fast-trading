document.addEventListener('DOMContentLoaded', async () => {
  // Tab elements
  const tabBtns = document.querySelectorAll('.tab-btn');
  const transferTab = document.getElementById('transferTab');
  const resultsTab = document.getElementById('resultsTab');

  // Transfer tab elements
  const friendSelect = document.getElementById('friendSelect');
  const cardListInput = document.getElementById('cardList');
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const progressContainer = document.getElementById('progressContainer');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  const statusDiv = document.getElementById('status');
  const refreshDictBtn = document.getElementById('refreshDictBtn');
  const dictInfo = document.getElementById('dictInfo');
  const dictWarning = document.getElementById('dictWarning');
  const dictSetup = document.getElementById('dictSetup');

  // Results tab elements
  const noResults = document.getElementById('noResults');
  const resultsContent = document.getElementById('resultsContent');
  const successCountEl = document.getElementById('successCount');
  const failureCountEl = document.getElementById('failureCount');
  const resultsTimeEl = document.getElementById('resultsTime');
  const resultCardListEl = document.getElementById('resultCardList');
  const copyListBtn = document.getElementById('copyListBtn');
  const errorsSection = document.getElementById('errorsSection');
  const errorsList = document.getElementById('errorsList');
  const downloadReportBtn = document.getElementById('downloadReportBtn');
  const resultsBadge = document.getElementById('resultsBadge');

  // Store last results for download
  let lastResults = null;

  // Tab switching
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.tab;
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      if (tabName === 'transfer') {
        transferTab.classList.add('active');
        resultsTab.classList.remove('active');
      } else {
        transferTab.classList.remove('active');
        resultsTab.classList.add('active');
        // Mark results as seen
        resultsBadge.classList.add('hidden');
        chrome.storage.local.set({ resultsUnseen: false });
      }
    });
  });

  // Load saved data
  const saved = await chrome.storage.local.get(['cardList', 'selectedFriendId', 'hashDictionaryCount', 'hashDictionaryUpdated', 'hashDictionaryLocale', 'localeWarning', 'transferHistory', 'resultsUnseen', 'lastTransferResults']);
  if (saved.cardList) cardListInput.value = saved.cardList;

  // Transfer history - migrate old lastTransferResults if needed
  let transferHistory = saved.transferHistory || [];
  if (transferHistory.length === 0 && saved.lastTransferResults) {
    transferHistory = [saved.lastTransferResults];
    chrome.storage.local.set({ transferHistory });
    console.log('Migrated lastTransferResults to transferHistory');
  }

  console.log('Loaded transferHistory:', transferHistory.length, 'items');

  // Show badge if there are unseen results
  if (saved.resultsUnseen && transferHistory.length > 0) {
    resultsBadge.classList.remove('hidden');
  }

  // Display results in Results tab
  function displayResults(results) {
    if (!results) {
      noResults.classList.remove('hidden');
      resultsContent.classList.add('hidden');
      return;
    }

    noResults.classList.add('hidden');
    resultsContent.classList.remove('hidden');

    // Update counts
    const successCount = results.successes?.length || 0;
    const failureCount = results.failures?.length || 0;
    successCountEl.textContent = successCount;
    failureCountEl.textContent = failureCount;

    // Update time
    if (results.startTime && results.endTime) {
      const start = new Date(results.startTime);
      const end = new Date(results.endTime);
      const duration = Math.round((end - start) / 1000);
      resultsTimeEl.textContent = `${start.toLocaleString()} (${duration}s)`;
    } else {
      resultsTimeEl.textContent = '';
    }

    // Build card list text
    const allCards = [
      ...(results.successes || []).map(s => `${s.card.quantity} ${s.card.reference}`),
      ...(results.failures || []).map(f => `${f.card.quantity} ${f.card.reference}`)
    ];
    resultCardListEl.value = allCards.join('\n');

    // Display errors
    if (failureCount > 0) {
      errorsSection.classList.remove('hidden');
      errorsList.innerHTML = '';
      for (const item of results.failures) {
        const div = document.createElement('div');
        div.className = 'error-item';
        div.innerHTML = `
          <span class="error-card">${item.card.quantity}x ${item.card.reference}</span>
          <span class="error-msg">${item.error}</span>
        `;
        errorsList.appendChild(div);
      }
    } else {
      errorsSection.classList.add('hidden');
    }
  }

  // Render history list
  function renderHistoryList() {
    const historyList = document.getElementById('historyList');
    const historySection = document.getElementById('historySection');

    console.log('renderHistoryList called, transferHistory.length:', transferHistory.length);

    if (transferHistory.length === 0) {
      historySection.classList.add('hidden');
      noResults.classList.remove('hidden');
      return;
    }

    historySection.classList.remove('hidden');
    noResults.classList.add('hidden');
    historyList.innerHTML = '';

    transferHistory.forEach((result, index) => {
      const successCount = result.successes?.length || 0;
      const failureCount = result.failures?.length || 0;
      const date = new Date(result.startTime);
      const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      const item = document.createElement('div');
      item.className = 'history-item' + (index === 0 && lastResults === result ? ' active' : '');
      item.innerHTML = `
        <span class="history-date">${dateStr}</span>
        <span class="history-stats">
          <span class="history-success">${successCount}</span> /
          <span class="history-fail">${failureCount}</span>
        </span>
      `;
      item.addEventListener('click', () => {
        lastResults = result;
        displayResults(result);
        document.querySelectorAll('.history-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
      });
      historyList.appendChild(item);
    });
  }

  // Load and display history
  renderHistoryList();
  if (transferHistory.length > 0) {
    lastResults = transferHistory[0];
    displayResults(transferHistory[0]);
  }

  // Display locale warning if any
  if (saved.localeWarning) {
    dictWarning.textContent = saved.localeWarning + '. Rebuild dictionary!';
    dictWarning.classList.remove('hidden');
  } else {
    dictWarning.classList.add('hidden');
  }

  // Display dictionary status
  function updateDictInfo(count, updated, locale) {
    if (count && updated) {
      const date = new Date(updated);
      const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
      const localeStr = locale ? ` [${locale}]` : '';
      dictInfo.textContent = `Dictionary: ${count} cards${localeStr} (${dateStr})`;
      // Hide setup message, show normal button
      dictSetup.classList.add('hidden');
      refreshDictBtn.classList.remove('btn-setup', 'btn-primary');
      refreshDictBtn.classList.add('btn-secondary');
    } else {
      dictInfo.textContent = 'Dictionary: Not loaded';
      // Show setup message and bigger button
      dictSetup.classList.remove('hidden');
      refreshDictBtn.classList.add('btn-setup', 'btn-primary');
      refreshDictBtn.classList.remove('btn-secondary');
    }
  }
  updateDictInfo(saved.hashDictionaryCount, saved.hashDictionaryUpdated, saved.hashDictionaryLocale);

  // Fetch friends on popup open
  friendSelect.innerHTML = '<option value="">Loading friends...</option>';
  chrome.runtime.sendMessage({ type: 'fetchFriends' });

  // Save card list on change
  cardListInput.addEventListener('input', () => {
    chrome.storage.local.set({ cardList: cardListInput.value });
  });

  // Save selected friend on change
  friendSelect.addEventListener('change', () => {
    chrome.storage.local.set({ selectedFriendId: friendSelect.value });
  });

  // Populate friends dropdown
  function populateFriends(friends, selectedId = null) {
    friendSelect.innerHTML = '<option value="">-- Select a friend --</option>';
    for (const friend of friends) {
      const option = document.createElement('option');
      option.value = friend.id;
      option.textContent = `${friend.nickName} (${friend.uniqueId})`;
      if (selectedId === friend.id) {
        option.selected = true;
      }
      friendSelect.appendChild(option);
    }
  }

  // Parse card list
  function parseCardList(text) {
    const lines = text.trim().split('\n');
    const cards = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const match = trimmed.match(/^(\d+)\s+(.+)$/);
      if (match) {
        cards.push({
          quantity: parseInt(match[1], 10),
          reference: match[2].trim()
        });
      }
    }

    return cards;
  }

  // Show status message
  function showStatus(message, type = 'info') {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
  }

  // Clear status
  function clearStatus() {
    statusDiv.className = 'status';
    statusDiv.textContent = '';
  }

  // Update progress UI
  function updateProgress(current, total) {
    const percent = total > 0 ? (current / total) * 100 : 0;
    progressFill.style.width = `${percent}%`;
    progressText.textContent = `${current} / ${total}`;
  }

  // Generate report text
  function generateReport(results) {
    let report = `=== Altered Fast Trading Report ===\n`;
    report += `Start: ${results.startTime}\n`;
    report += `End: ${results.endTime}\n`;
    report += `\n`;
    report += `Total: ${results.successes.length + results.failures.length}\n`;
    report += `Success: ${results.successes.length}\n`;
    report += `Failed: ${results.failures.length}\n`;
    report += `\n`;

    if (results.successes.length > 0) {
      report += `=== SUCCESS (${results.successes.length}) ===\n`;
      for (const item of results.successes) {
        report += `[OK] ${item.card.quantity}x ${item.card.reference}\n`;
      }
      report += `\n`;
    }

    if (results.failures.length > 0) {
      report += `=== FAILED (${results.failures.length}) ===\n`;
      for (const item of results.failures) {
        report += `[FAIL] ${item.card.quantity}x ${item.card.reference}\n`;
        report += `       Error: ${item.error}\n`;
      }
    }

    return report;
  }

  // Download report file
  function downloadReport(results) {
    const report = generateReport(results);
    const blob = new Blob([report], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `altered-trading-report-${timestamp}.txt`;

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Check job status on popup open
  const jobStatus = await chrome.storage.local.get(['jobRunning', 'jobProgress', 'jobTotal']);
  if (jobStatus.jobRunning) {
    startBtn.disabled = true;
    stopBtn.disabled = false;
    progressContainer.classList.add('active');
    updateProgress(jobStatus.jobProgress || 0, jobStatus.jobTotal || 0);
    showStatus('Job in progress...', 'info');
  }

  // Listen for messages from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'progress') {
      updateProgress(message.current, message.total);
    } else if (message.type === 'status') {
      showStatus(message.message, message.status);
    } else if (message.type === 'jobComplete') {
      startBtn.disabled = false;
      stopBtn.disabled = true;

      // Store results and display in Results tab
      if (message.results) {
        lastResults = message.results;

        // Reload history from storage (background.js already added it)
        chrome.storage.local.get(['transferHistory']).then(stored => {
          console.log('Reloaded transferHistory after job complete:', stored.transferHistory?.length || 0);
          transferHistory = stored.transferHistory || [];
          renderHistoryList();
        });
        chrome.storage.local.set({ resultsUnseen: false });

        // Display results and switch to Results tab
        displayResults(message.results);
        tabBtns.forEach(b => b.classList.remove('active'));
        document.querySelector('[data-tab="results"]').classList.add('active');
        transferTab.classList.remove('active');
        resultsTab.classList.add('active');
        resultsBadge.classList.add('hidden');
      }

      // Show status with colors based on failures
      const hasFailures = message.results?.failures?.length > 0;
      showStatus(message.message, hasFailures ? 'error' : 'success');
    } else if (message.type === 'friendsLoaded') {
      if (message.success) {
        populateFriends(message.friends, saved.selectedFriendId);
        clearStatus();
      } else {
        friendSelect.innerHTML = '<option value="">-- Error loading friends --</option>';
        showStatus(message.message, 'error');
      }
    } else if (message.type === 'dictionaryStatus') {
      showStatus(message.message, message.status);
      refreshDictBtn.disabled = message.status === 'info';

      // Refresh dictionary info display on success
      if (message.status === 'success') {
        chrome.storage.local.get(['hashDictionaryCount', 'hashDictionaryUpdated', 'hashDictionaryLocale']).then(data => {
          updateDictInfo(data.hashDictionaryCount, data.hashDictionaryUpdated, data.hashDictionaryLocale);
        });

        // Clear locale warning (will be re-evaluated when page refreshes)
        dictWarning.classList.add('hidden');
        chrome.storage.local.set({ localeWarning: null });

        // Show green check for 2 seconds
        const originalText = refreshDictBtn.textContent;
        refreshDictBtn.textContent = '✓ Done!';
        refreshDictBtn.classList.add('btn-success-check');
        refreshDictBtn.disabled = true;

        setTimeout(() => {
          refreshDictBtn.textContent = originalText;
          refreshDictBtn.classList.remove('btn-success-check');
          refreshDictBtn.disabled = false;
        }, 2000);
      }

      // Re-enable on error
      if (message.status === 'error') {
        refreshDictBtn.disabled = false;
      }
    }
  });

  // Start button
  startBtn.addEventListener('click', async () => {
    const userId = friendSelect.value;
    const cardListText = cardListInput.value;

    if (!userId) {
      showStatus('Please select a friend', 'error');
      return;
    }

    const cards = parseCardList(cardListText);
    if (cards.length === 0) {
      showStatus('Please enter at least one card', 'error');
      return;
    }

    // Disable start, enable stop
    startBtn.disabled = true;
    stopBtn.disabled = false;
    progressContainer.classList.add('active');
    updateProgress(0, cards.length);
    showStatus('Starting job...', 'info');

    // Send to background script
    chrome.runtime.sendMessage({
      type: 'startJob',
      userId: userId,
      cards: cards
    });
  });

  // Stop button
  stopBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'stopJob' });
    startBtn.disabled = false;
    stopBtn.disabled = true;
    showStatus('Job stopped by user', 'error');
  });

  // Copy to clipboard button
  copyListBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(resultCardListEl.value);
      const originalText = copyListBtn.textContent;
      copyListBtn.textContent = 'Copied!';
      copyListBtn.classList.add('btn-success-check');
      setTimeout(() => {
        copyListBtn.textContent = originalText;
        copyListBtn.classList.remove('btn-success-check');
      }, 1500);
    } catch (err) {
      showStatus('Failed to copy: ' + err.message, 'error');
    }
  });

  // Download report button (in Results tab)
  downloadReportBtn.addEventListener('click', () => {
    if (lastResults) {
      downloadReport(lastResults);
    }
  });

  // Clear history button
  const clearHistoryBtn = document.getElementById('clearHistoryBtn');
  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', () => {
      transferHistory = [];
      chrome.storage.local.set({ transferHistory: [] });
      lastResults = null;
      displayResults(null);
      renderHistoryList();
      showStatus('History cleared', 'info');
    });
  }

  // Clear button
  const clearBtn = document.getElementById('clearBtn');
  console.log('clearBtn element:', clearBtn);
  clearBtn.addEventListener('click', () => {
    console.log('Clear button clicked');
    cardListInput.value = '';
    chrome.storage.local.set({ cardList: '' });
    showStatus('List cleared', 'info');
  });

  // Recap button
  const recapBtn = document.getElementById('recapBtn');
  recapBtn.addEventListener('click', () => {
    const cardListText = cardListInput.value.trim();

    if (!cardListText) {
      showStatus('Please enter a card list first', 'error');
      return;
    }

    try {
      const encoded = deckfmt.encodeList(cardListText);
      const recapUrl = `https://altered-snap.ntoniolo.com/fr-fr/recap/${encoded}`;
      chrome.tabs.create({ url: recapUrl });
    } catch (err) {
      showStatus('Error encoding list: ' + err.message, 'error');
    }
  });

  // Refresh dictionary button
  refreshDictBtn.addEventListener('click', () => {
    refreshDictBtn.disabled = true;
    showStatus('Building dictionary...', 'info');
    chrome.runtime.sendMessage({ type: 'buildDictionary' });
  });
});
