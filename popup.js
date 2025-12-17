document.addEventListener('DOMContentLoaded', async () => {
  const transferSection = document.getElementById('transferSection');
  const friendSelect = document.getElementById('friendSelect');
  const cardListInput = document.getElementById('cardList');
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const progressContainer = document.getElementById('progressContainer');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  const statusDiv = document.getElementById('status');
  const downloadBtn = document.getElementById('downloadBtn');
  const refreshDictBtn = document.getElementById('refreshDictBtn');
  const dictInfo = document.getElementById('dictInfo');
  const dictWarning = document.getElementById('dictWarning');
  const dictSetup = document.getElementById('dictSetup');

  // Load saved data
  const saved = await chrome.storage.local.get(['cardList', 'selectedFriendId', 'hashDictionaryCount', 'hashDictionaryUpdated', 'hashDictionaryLocale', 'localeWarning']);
  if (saved.cardList) cardListInput.value = saved.cardList;

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

  // Store last results for download
  let lastResults = null;

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

      // Store results and show download button
      if (message.results) {
        lastResults = message.results;
        downloadBtn.classList.remove('hidden');

        // Auto-download the report
        downloadReport(message.results);
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

  // Download button
  downloadBtn.addEventListener('click', () => {
    if (lastResults) {
      downloadReport(lastResults);
    }
  });

  // Clear button
  const clearBtn = document.getElementById('clearBtn');
  clearBtn.addEventListener('click', () => {
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
