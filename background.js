// background.js

import { getSettings, addToPermanentWhitelist, addToTemporaryPass, addToTodayPass } from './modules/storage.js';
import { isContentAllowedByAI } from './modules/ai.js';
import { isHardcoreBlocked } from './modules/utils.js';

/**
 * 这是执行所有拦截检查的核心函数。
 * @param {number} tabId
 * @param {string} url
 * @param {string} title
 */
async function performChecks(tabId, url, title) {
    // 检查一次性通行证
    const oneTimePassKey = `oneTimePass_tab_${tabId}`;
    const sessionData = await chrome.storage.session.get(oneTimePassKey);
    const passUrl = sessionData[oneTimePassKey];

    if (passUrl && url === passUrl) {
        await chrome.storage.session.remove(oneTimePassKey);
        return;
    }

    const settings = await getSettings();
    const mode = settings.current_mode || 'hybrid';

    console.log(`[Path Blocker] Performing checks for: "${title}" (${url}) in ${mode} mode.`);

    if (mode === 'hardcore') {
        if (isHardcoreBlocked(url, settings.groups)) {
            redirectToInterception(tabId, url, 'hardcore');
        }
        return;
    }

    if (mode === 'ai' || mode === 'hybrid') {
        const domain = new URL(url).hostname;
        if (settings.ai_permanent_whitelist?.includes(domain) || (settings.ai_temporary_pass?.[url] && Date.now() < settings.ai_temporary_pass[url])) {
            console.log(`[Path Blocker] Pass/Whitelist granted.`);
            await updateFocusScore(100);
            return;
        }

        if (mode === 'hybrid' && isHardcoreBlocked(url, settings.groups)) {
            console.log(`[Path Blocker] Hardcore rule matched.`);
            await updateFocusScore(0);
            redirectToInterception(tabId, url, 'hardcore');
            return;
        }

        if (!settings.ai_intent) {
            console.log(`[Path Blocker] AI scene not set, skipping analysis.`);
            await updateFocusScore(75);
            return;
        }

        const aiResult = await isContentAllowedByAI(title, settings);
        
        if (aiResult.score !== -1) {
            await updateFocusScore(aiResult.score);
        }

        if (!aiResult.isAllowed) {
            console.log(`[Path Blocker] AI blocked.`);
            const reason = `ai&intent=${encodeURIComponent(settings.ai_intent || '')}&title=${encodeURIComponent(title || 'Unknown Title')}`;
            redirectToInterception(tabId, url, reason);
        } else {
            console.log(`[Path Blocker] AI allowed.`);
        }
    }
}


/**
 * 这是一个处理程序，它会被临时注册到 tabs.onUpdated 事件。
 * 它等待标题更新作为页面加载完成的最终信号。
 * @param {string} expectedUrl - 我们期望页面导航到的URL。
 * @param {number} tabId
 * @param {object} changeInfo
 * @param {object} tab
 */
const onTitleUpdated = (expectedUrl, tabId, changeInfo, tab) => {
    // 我们只关心标题更新，并且URL必须是我们期望的那个
    if (changeInfo.title && tab.url === expectedUrl) {
        console.log(`[Path Blocker] Title updated for ${expectedUrl}. Finalizing check.`);
        
        // 执行检查
        performChecks(tabId, tab.url, changeInfo.title);

        // **关键**: 检查执行后，立即移除此临时监听器
        chrome.tabs.onUpdated.removeListener(titleUpdateListeners[tabId]);
        delete titleUpdateListeners[tabId];
    }
};

// 用于存储每个tab的临时监听器
const titleUpdateListeners = {};

/**
 * 主导航事件监听器。
 * 当检测到SPA导航时，它会注册一个临时的onTitleUpdated监听器。
 * @param {object} details
 */
const handleNavigation = (details) => {
    // 仅处理顶级框架的导航，并排除拦截页本身
    if (details.frameId !== 0 || details.url.includes('interception.html')) {
        return;
    }

    const tabId = details.tabId;
    const expectedUrl = details.url;
    
    console.log(`[Path Blocker] Navigation detected for Tab ${tabId} to ${expectedUrl}. Setting up title listener.`);

    // 如果这个tab已经有一个旧的监听器在等待，先移除它
    if (titleUpdateListeners[tabId]) {
        chrome.tabs.onUpdated.removeListener(titleUpdateListeners[tabId]);
    }

    // 创建一个新的、绑定了正确URL的监听器函数
    const newListener = (updatedTabId, changeInfo, tab) => {
        // 确保事件来自正确的标签页
        if (updatedTabId === tabId) {
            onTitleUpdated(expectedUrl, updatedTabId, changeInfo, tab);
        }
    };
    
    // 存储并注册这个新的临时监听器
    titleUpdateListeners[tabId] = newListener;
    chrome.tabs.onUpdated.addListener(newListener);
};

// --- 绑定主事件监听器 ---
// onCommitted 用于新页面加载和刷新
chrome.webNavigation.onCommitted.addListener(handleNavigation);
// onHistoryStateUpdated 用于SPA内部导航
chrome.webNavigation.onHistoryStateUpdated.addListener(handleNavigation);

// --- 清理工作 ---
// 当标签页关闭时，清除所有相关的监听器和数据
chrome.tabs.onRemoved.addListener((tabId) => {
    if (titleUpdateListeners[tabId]) {
        chrome.tabs.onUpdated.removeListener(titleUpdateListeners[tabId]);
        delete titleUpdateListeners[tabId];
    }
});


// ... (其余辅助函数: updateFocusScore, onMessage, redirectToInterception 保持不变) ...
async function updateFocusScore(score) {
    const data = await chrome.storage.local.get('focus_scores_history');
    let scores = data.focus_scores_history || [];
    scores.push(score);
    if (scores.length > 100) scores.shift(); 
    await chrome.storage.local.set({ 'focus_scores_history': scores });
}

chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    if (request.action === 'go_back' && request.tabId) {
        chrome.tabs.goBack(request.tabId, () => {
            if (chrome.runtime.lastError) {
                chrome.tabs.remove(request.tabId);
            }
        });
        return;
    }

    if (request.action === 'grant_pass') {
        const { url, tabId, duration } = request;
        if (!url) return;
        const targetTabId = tabId || sender.tab.id;
        
        switch (duration) {
            case 'once':
                await chrome.storage.session.set({ [`oneTimePass_tab_${targetTabId}`]: url });
                break;
            case 'hour': await addToTemporaryPass(url); break;
            case 'today': await addToTodayPass(url); break;
            case 'permanent': await addToPermanentWhitelist(new URL(url).hostname); break;
        }
        chrome.tabs.update(targetTabId, { url: url });
    }
});

function redirectToInterception(tabId, originalUrl, reason) {
    const interceptionUrl = chrome.runtime.getURL('interception.html');
    const targetUrl = `${interceptionUrl}?url=${encodeURIComponent(originalUrl)}&reason=${reason}&tabId=${tabId}`;
    chrome.tabs.update(tabId, { url: targetUrl });
}