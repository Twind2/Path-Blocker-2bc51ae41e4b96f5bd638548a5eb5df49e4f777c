// background.js

import { getSettings, addToPermanentWhitelist, addToTemporaryPass, addToTodayPass } from './modules/storage.js';
import { isContentAllowedByAI } from './modules/ai.js';
import { isHardcoreBlocked } from './modules/utils.js';

// --- 全局变量 ---
const checkDebouncers = {}; // 存储每个tab的计时器
const DEBOUNCE_DELAY = 750; // 750毫秒的延迟，确保标题已稳定
const MAX_SCORE_HISTORY = 100; // 存储最近100条评分

// --- 核心逻辑 ---

/**
 * 这是一个将被“防抖”处理的函数。
 * 它会在延迟后执行，以获取最新的页面信息并进行检查。
 * @param {number} tabId
 */
const debouncedCheck = async (tabId) => {
    try {
        const tab = await chrome.tabs.get(tabId);
        // 如果标签页已关闭，或URL/标题无效，则中止
        if (!tab || !tab.url || !tab.url.startsWith('http') || !tab.title) {
            return;
        }
        console.log(`[Path Blocker] 开始分析: "${tab.title}"`);
        await performChecks(tab.id, tab.url, tab.title);
    } catch (error) {
        // 这通常在标签页被关闭时发生
        console.log(`[Path Blocker] 无法获取标签页 ${tabId} 的信息，可能已被关闭。`);
    }
};

/**
 * 触发检查的入口函数。
 * 任何需要进行AI分析的事件都应该调用这个函数。
 * @param {number} tabId
 */
const triggerCheck = (tabId) => {
    // 如果该标签页已有计时器在运行，则清除它
    if (checkDebouncers[tabId]) {
        clearTimeout(checkDebouncers[tabId]);
    }
    // 设置一个新的计时器
    checkDebouncers[tabId] = setTimeout(() => debouncedCheck(tabId), DEBOUNCE_DELAY);
};


// --- 事件监听器 ---

// 监听器 1: 用于传统页面加载和标题变化（作为备用）
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // 仅在页面加载完成或标题发生变化时触发
    if (changeInfo.status === 'complete' || changeInfo.title) {
        // 避免在拦截页面上触发循环
        if (tab.url && !tab.url.includes('interception.html')) {
            triggerCheck(tabId);
        }
    }
});

// 监听器 2: 用于单页应用（SPA）的导航，这是更可靠的方式
chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
    // 我们只关心顶级框架的导航事件
    if (details.frameId === 0) {
        if (details.url && !details.url.includes('interception.html')) {
            triggerCheck(details.tabId);
        }
    }
});

// 监听器 3: 清理工作，当标签页关闭时，清除对应的计时器
chrome.tabs.onRemoved.addListener((tabId) => {
    if (checkDebouncers[tabId]) {
        clearTimeout(checkDebouncers[tabId]);
        delete checkDebouncers[tabId];
    }
});


/**
 * 执行所有拦截检查的核心函数
 * @param {number} tabId
 * @param {string} url
 * @param {string} title
 */
async function performChecks(tabId, url, title) {
    const oneTimePassKey = `oneTimePass_tab_${tabId}`;
    const sessionData = await chrome.storage.session.get(oneTimePassKey);
    const passUrl = sessionData[oneTimePassKey];

    if (passUrl && url === passUrl) {
        await chrome.storage.session.remove(oneTimePassKey);
        return; 
    }

    const settings = await getSettings();
    const mode = settings.current_mode || 'hybrid';

    // 在“规则”模式下，不进行任何评分
    if (mode === 'hardcore') {
        if (isHardcoreBlocked(url, settings.groups)) {
            redirectToInterception(tabId, url, 'hardcore');
        }
        return; // 直接返回，不执行AI或评分逻辑
    }

    // AI 和 混合 模式
    if (mode === 'ai' || mode === 'hybrid') {
        const domain = new URL(url).hostname;
        // 检查白名单或通行证
        if (settings.ai_permanent_whitelist?.includes(domain) || (settings.ai_temporary_pass?.[url] && Date.now() < settings.ai_temporary_pass[url])) {
            console.log(`[Path Blocker] 通行证/白名单放行: ${url}`);
            await updateFocusScore(100); // 对于白名单和通行证，给予满分
            return;
        }

        // 在混合模式下，优先检查规则列表
        if (mode === 'hybrid' && isHardcoreBlocked(url, settings.groups)) {
            redirectToInterception(tabId, url, 'hardcore');
            return;
        }

        // 如果意图为空，则不进行AI检查，直接放行并给予一个中性分数
        if (!settings.ai_intent) {
            console.log(`[Path Blocker] 场景/意图未设置，AI分析跳过: ${title}`);
            await updateFocusScore(75); // 给予一个较高的默认分
            return;
        }

        const aiResult = await isContentAllowedByAI(title, settings);
        
        // 只有在AI成功返回有效分数时才更新
        if (aiResult.score !== -1) {
            await updateFocusScore(aiResult.score);
        }

        if (!aiResult.isAllowed) {
            console.log(`[Path Blocker] AI 拦截: ${title}`);
            const reason = `ai&intent=${encodeURIComponent(settings.ai_intent || '')}&title=${encodeURIComponent(title || '未知标题')}`;
            redirectToInterception(tabId, url, reason);
        } else {
            console.log(`[Path Blocker] AI 放行: ${title}`);
        }
    }
}

/**
 * 更新全局专注度分数
 * @param {number} score 
 */
async function updateFocusScore(score) {
    const data = await chrome.storage.local.get('focus_scores_history');
    let scores = data.focus_scores_history || [];
    scores.push(score);
    if (scores.length > MAX_SCORE_HISTORY) scores.shift();
    await chrome.storage.local.set({ 'focus_scores_history': scores });
}

// 消息监听器: 处理来自拦截页面或弹出窗口的通信
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    if (request.action === 'go_back' && request.tabId) {
        chrome.tabs.goBack(request.tabId, () => {
            if (chrome.runtime.lastError) chrome.tabs.remove(request.tabId);
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

/**
 * 重定向到拦截页面的辅助函数
 * @param {number} tabId
 * @param {string} originalUrl
 * @param {string} reason
 */
function redirectToInterception(tabId, originalUrl, reason) {
    const interceptionUrl = chrome.runtime.getURL('interception.html');
    const targetUrl = `${interceptionUrl}?url=${encodeURIComponent(originalUrl)}&reason=${reason}&tabId=${tabId}`;
    chrome.tabs.update(tabId, { url: targetUrl });
}