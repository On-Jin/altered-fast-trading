let jobRunning = false;
let stopRequested = false;

// Get Bearer token by injecting script into an altered.gg tab
async function getBearerToken() {
  try {
    // Find an altered.gg tab (prefer /cards or main pages, avoid special pages)
    const tabs = await chrome.tabs.query({ url: '*://*.altered.gg/*' });
    console.log('Found altered.gg tabs:', tabs.length);

    if (tabs.length === 0) {
      console.error('No altered.gg tab found');
      return null;
    }

    // Prefer tabs on regular pages (cards, collection, etc.)
    let targetTab = tabs.find(t =>
      t.url.includes('/cards') ||
      t.url.includes('/collection') ||
      t.url.includes('/profile') ||
      t.url.includes('/trade')
    ) || tabs.find(t =>
      !t.url.includes('/developers') &&
      !t.url.includes('/api/')
    ) || tabs[0];

    console.log('Using tab:', targetTab.id, targetTab.url);

    // Inject script to fetch session from the tab's context
    const results = await chrome.scripting.executeScript({
      target: { tabId: targetTab.id },
      func: async () => {
        try {
          const response = await fetch('/api/auth/session?_t=' + Date.now(), {
            method: 'GET',
            credentials: 'include',
            headers: {
              'accept': '*/*',
              'content-type': 'application/json'
            }
          });
          if (!response.ok) {
            return { error: 'Session API failed: ' + response.status };
          }
          const data = await response.json();
          return {
            accessToken: data.accessToken,
            email: data.user?.email,
            userId: data.userId
          };
        } catch (err) {
          return { error: err.message };
        }
      }
    });

    const result = results[0]?.result;
    console.log('Session result:', result ? { email: result.email, hasToken: !!result.accessToken, error: result.error } : 'null');

    if (result?.error) {
      console.error('Session fetch error:', result.error);
      return null;
    }

    if (result?.accessToken) {
      console.log('Token obtained for:', result.email);
      return result.accessToken;
    }

    console.log('No accessToken in session response - user may not be logged in');
    return null;
  } catch (err) {
    console.error('Failed to get token:', err);
    // Check for permission error
    if (err.message && err.message.includes('Cannot access contents')) {
      console.error('Permission error - try reloading the extension at chrome://extensions');
    }
    return null;
  }
}

// Fetch friends list from API (via tab context to avoid CORS)
async function fetchFriends() {
  try {
    // Find an altered.gg tab
    const tabs = await chrome.tabs.query({ url: '*://*.altered.gg/*' });
    if (tabs.length === 0) {
      sendToPopup({
        type: 'friendsLoaded',
        success: false,
        message: 'No altered.gg tab found. Please open altered.gg in another tab.'
      });
      return;
    }

    // Prefer tabs on regular pages
    let targetTab = tabs.find(t =>
      t.url.includes('/cards') ||
      t.url.includes('/collection') ||
      t.url.includes('/profile')
    ) || tabs.find(t =>
      !t.url.includes('/developers') &&
      !t.url.includes('/api/')
    ) || tabs[0];

    console.log('Fetching friends via tab:', targetTab.id, targetTab.url);

    // Inject script to fetch session AND friends from the tab's context
    const results = await chrome.scripting.executeScript({
      target: { tabId: targetTab.id },
      func: async () => {
        try {
          // First get the session/token
          const sessionRes = await fetch('/api/auth/session?_t=' + Date.now(), {
            method: 'GET',
            credentials: 'include',
            headers: { 'accept': '*/*', 'content-type': 'application/json' }
          });

          if (!sessionRes.ok) {
            return { error: 'Session failed: ' + sessionRes.status };
          }

          const session = await sessionRes.json();
          if (!session.accessToken) {
            return { error: 'Not logged in. Please log in to altered.gg.' };
          }

          // Now fetch friends with the token
          const friendsRes = await fetch('https://api.altered.gg/user_friendships?itemsPerPage=1000&page=1', {
            headers: {
              'accept': '*/*',
              'authorization': `Bearer ${session.accessToken}`,
              'Referer': 'https://www.altered.gg/'
            }
          });

          if (!friendsRes.ok) {
            return { error: 'Friends API failed: ' + friendsRes.status };
          }

          const data = await friendsRes.json();
          const friends = (data['hydra:member'] || [])
            .filter(f => f.userFriend?.friendStatus === 'ACCEPTED')
            .map(f => ({
              id: f.userFriend.id,
              nickName: f.userFriend.nickName,
              uniqueId: f.userFriend.uniqueId,
              avatarPath: f.userFriend.avatarPath
            }));

          return { friends, email: session.user?.email };
        } catch (err) {
          return { error: err.message };
        }
      }
    });

    const result = results[0]?.result;
    console.log('Friends fetch result:', result?.error || `${result?.friends?.length} friends for ${result?.email}`);

    if (result?.error) {
      sendToPopup({
        type: 'friendsLoaded',
        success: false,
        message: result.error
      });
      return;
    }

    sendToPopup({
      type: 'friendsLoaded',
      success: true,
      friends: result.friends || []
    });

  } catch (err) {
    console.error('Fetch friends error:', err);
    let message = err.message;
    if (message.includes('Cannot access contents')) {
      message = 'Permission error. Reload extension at chrome://extensions';
    }
    sendToPopup({
      type: 'friendsLoaded',
      success: false,
      message: message
    });
  }
}

// Send a give request for a single card
async function giveCard(userId, card, token) {
  const response = await fetch('https://api.altered.gg/owners/give', {
    method: 'POST',
    headers: {
      'accept': '*/*',
      'authorization': `Bearer ${token}`,
      'content-type': 'application/json',
      'Referer': 'https://www.altered.gg/'
    },
    body: JSON.stringify({
      user: `/users/${userId}`,
      quantity: card.quantity,
      cards: [{
        reference: card.reference,
        quantity: card.quantity
      }]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Give failed for ${card.reference}: ${response.status} - ${text}`);
  }

  return await response.json();
}

// Delay helper
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Send message to popup
function sendToPopup(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // Popup might be closed, ignore error
  });
}

// Run the job
async function runJob(userId, cards) {
  jobRunning = true;
  stopRequested = false;

  const results = {
    successes: [],
    failures: [],
    startTime: new Date().toISOString()
  };

  await chrome.storage.local.set({
    jobRunning: true,
    jobProgress: 0,
    jobTotal: cards.length
  });

  try {
    // Get token
    sendToPopup({ type: 'status', message: 'Getting authentication token...', status: 'info' });
    const token = await getBearerToken();

    if (!token) {
      throw new Error('Could not find Bearer token. Please make sure you are logged in to altered.gg in another tab.');
    }

    // Process each card
    for (let i = 0; i < cards.length; i++) {
      if (stopRequested) {
        // Mark remaining cards as skipped
        for (let j = i; j < cards.length; j++) {
          results.failures.push({
            card: cards[j],
            error: 'Job stopped by user'
          });
        }
        break;
      }

      const card = cards[i];
      sendToPopup({
        type: 'status',
        message: `Sending ${card.quantity}x ${card.reference}...`,
        status: 'info'
      });

      try {
        await giveCard(userId, card, token);
        results.successes.push({ card });
      } catch (err) {
        console.error('Card give error:', err);
        results.failures.push({
          card,
          error: err.message
        });
        sendToPopup({
          type: 'status',
          message: `Error: ${err.message}`,
          status: 'error'
        });
      }

      // Update progress
      const progress = i + 1;
      sendToPopup({ type: 'progress', current: progress, total: cards.length });
      await chrome.storage.local.set({ jobProgress: progress });

      // Wait 2 seconds before next request (except for last one)
      if (i < cards.length - 1 && !stopRequested) {
        await delay(2000);
      }
    }

    results.endTime = new Date().toISOString();

    // Save results to history (in case popup is closed)
    const stored = await chrome.storage.local.get(['transferHistory']);
    let transferHistory = stored.transferHistory || [];
    console.log('Before save - transferHistory length:', transferHistory.length);
    transferHistory.unshift(results);
    if (transferHistory.length > 20) transferHistory.pop(); // Keep last 20
    await chrome.storage.local.set({
      transferHistory,
      resultsUnseen: true
    });
    console.log('Saved transferHistory - new length:', transferHistory.length);

    // Send recap with results
    const successCount = results.successes.length;
    const failCount = results.failures.length;
    const allSuccess = failCount === 0;

    sendToPopup({
      type: 'jobComplete',
      message: `Completed: ${successCount} success, ${failCount} failed`,
      success: allSuccess,
      results: results
    });

    // Reload altered.gg tabs to reflect changes
    const tabs = await chrome.tabs.query({ url: '*://*.altered.gg/*' });
    for (const tab of tabs) {
      chrome.tabs.reload(tab.id);
    }

  } catch (err) {
    console.error('Job error:', err);
    results.endTime = new Date().toISOString();
    sendToPopup({
      type: 'jobComplete',
      message: err.message,
      success: false,
      results: results
    });
  } finally {
    jobRunning = false;
    await chrome.storage.local.set({ jobRunning: false });
  }
}

// Detect locale from altered.gg tab
async function detectLocale() {
  try {
    const tabs = await chrome.tabs.query({ url: '*://*.altered.gg/*' });
    if (tabs.length > 0) {
      const url = tabs[0].url;
      // URL format: https://www.altered.gg/fr-fr/cards or https://altered.gg/en-us/...
      const match = url.match(/altered\.gg\/([a-z]{2}-[a-z]{2})\//i);
      if (match) {
        return match[1].toLowerCase();
      }
    }
  } catch (err) {
    console.error('Error detecting locale:', err);
  }
  return 'fr-fr'; // Default fallback
}

// Build hash to reference dictionary from API
let dictionaryBuildRunning = false;

async function buildHashDictionary(locale = null) {
  // Auto-detect locale if not provided
  if (!locale) {
    locale = await detectLocale();
    console.log('Auto-detected locale:', locale);
  }
  if (dictionaryBuildRunning) {
    sendToPopup({ type: 'dictionaryStatus', status: 'error', message: 'Build already in progress' });
    return;
  }

  dictionaryBuildRunning = true;
  const hashToReference = {};
  let totalCards = 0;

  // List of sets to fetch
  const cardSets = ['CORE', 'COREKS', 'ALIZE', 'BISE', 'CYCLONE'];

  sendToPopup({ type: 'dictionaryStatus', status: 'info', message: `Starting dictionary build (${locale})...` });

  try {
    for (const cardSet of cardSets) {
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        sendToPopup({
          type: 'dictionaryStatus',
          status: 'info',
          message: `Fetching ${cardSet} page ${page}... (${totalCards} cards so far)`
        });

        const url = `https://api.altered.gg/cards?page=${page}&rarity%5B%5D=RARE&rarity%5B%5D=COMMON&itemsPerPage=100&locale=${locale}&cardSet%5B%5D=${cardSet}`;
        const response = await fetch(url, {
          headers: {
            'accept': 'application/json',
            'Referer': 'https://www.altered.gg/'
          }
        });

        if (!response.ok) {
          console.log(`AFT DICT: API error for ${cardSet}: ${response.status}`);
          break;
        }

        const data = await response.json();
        const cards = data['hydra:member'] || data.member || data;

        if (!Array.isArray(cards) || cards.length === 0) {
          console.log(`AFT DICT: ${cardSet} - no more cards at page ${page}`);
          hasMore = false;
          break;
        }

        // Extract hash → reference mapping
        let matched = 0;
        for (const card of cards) {
          if (card.reference && card.imagePath) {
            if (card.reference.match(/_[CR][12]?$/)) {
              const hashMatch = card.imagePath.match(/([a-f0-9]{32})\.(jpg|webp|png)/i);
              if (hashMatch) {
                hashToReference[hashMatch[1].toLowerCase()] = card.reference;
                totalCards++;
                matched++;
              }
            }
          }
        }
        console.log(`AFT DICT: ${cardSet} page ${page} - matched ${matched} cards`);

        if (cards.length < 100) {
          hasMore = false;
        } else if (page >= 50) {
          hasMore = false;
          console.log(`AFT DICT: ${cardSet} - reached page limit`);
        } else {
          page++;
          await delay(500);
        }
      }

      // Small delay between sets
      await delay(300);
    }

    // Save to storage
    await chrome.storage.local.set({
      hashDictionary: hashToReference,
      hashDictionaryUpdated: new Date().toISOString(),
      hashDictionaryCount: totalCards,
      hashDictionaryLocale: locale
    });

    sendToPopup({
      type: 'dictionaryStatus',
      status: 'success',
      message: `Dictionary built: ${totalCards} cards (${locale})`
    });

    console.log('Hash dictionary built:', totalCards, 'mappings');

  } catch (err) {
    console.error('Dictionary build error:', err);
    sendToPopup({
      type: 'dictionaryStatus',
      status: 'error',
      message: `Error: ${err.message}`
    });
  } finally {
    dictionaryBuildRunning = false;
  }
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'fetchFriends') {
    fetchFriends();
  } else if (message.type === 'startJob') {
    if (!jobRunning) {
      runJob(message.userId, message.cards);
    }
  } else if (message.type === 'stopJob') {
    stopRequested = true;
  } else if (message.type === 'buildDictionary') {
    buildHashDictionary();
  }
});
